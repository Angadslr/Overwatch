import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {JournalIndex} from '../../src/transport/journalIndex';
import {envelopeDigest} from '../../src/transport/retention';
import type {SourceEnvelopeV1} from '../../src/transport/sourceContracts';

test('compact journal identities preserve exact digests and numeric metadata across chunk boundaries and reused slots', () => {
 const index = new JournalIndex(1030);
 const event = ():SourceEnvelopeV1 => ({transportVersion:1,eventId:randomUUID(),collectorId:'collector',environmentId:'local',workspaceId:'workspace',receivedAt:'2026-10-26T00:00:00.123Z',result:{counters:{unknownFields:0,sensitiveFields:0,invalidFields:0,gap:'invalid-json'}}});
 const events = Array.from({length:1030},event);
 const slots = events.map((envelope,i) => index.add(envelope,i+1));
 assert.equal(index.size,1030);
 const cutoff = Date.parse(events[0]!.receivedAt);
 assert.equal(index.countReceivedAtOrAfter(cutoff),1030);assert.equal(index.countReceivedAtOrAfter(cutoff+1),0);
 assert.throws(()=>index.countReceivedAtOrAfter(NaN),/invalid-journal-cutoff/);
 assert.equal(index.find(events[0]!.eventId),0);
 for (const i of [0,1023,1024,1029]) {
  const envelope=events[i]!,slot=slots[i]!;
  assert.equal(index.matches(slot,envelope),true);
  assert.equal(index.sequence(slot),i+1);
  assert.equal(index.receivedAt(slot),Date.parse(envelope.receivedAt));
  assert.deepEqual(index.retired(slot),{id:envelope.eventId,digest:envelopeDigest(envelope),sequence:i+1,receivedAt:envelope.receivedAt});
  assert.equal(index.matches(slot,{...envelope,workspaceId:'other-workspace'}),false);
 }
 assert.throws(()=>index.add(event(),1031),/journal-index-limit/);
 for (let i=0;i<events.length;i+=2) index.remove(slots[i]!);
 assert.equal(index.countReceivedAtOrAfter(cutoff),515);
 for (let i=0;i<events.length;i+=2) {
  assert.equal(index.find(events[i]!.eventId),undefined);
  const envelope=event(),slot=index.add(envelope,2000+i);
  assert.equal(index.sequence(slot),2000+i);
  assert.equal(index.matches(slot,envelope),true);
 }
 assert.equal(index.size,1030);
});

const source = (eventId: string=randomUUID()):SourceEnvelopeV1 => ({transportVersion:1,eventId,collectorId:'collector',environmentId:'local',workspaceId:'workspace',receivedAt:'2026-10-26T00:00:00.123Z',result:{counters:{unknownFields:0,sensitiveFields:0,invalidFields:0,gap:'invalid-json'}}});

test('binary index rejects invalid bounds and identities without consuming capacity or changing a live record',()=>{
 for(const capacity of [0,-1,1.5,100001,NaN])assert.throws(()=>new JournalIndex(capacity),/invalid-journal-index/);
 assert.throws(()=>new JournalIndex(1,-1),/invalid-journal-index/);
 const index=new JournalIndex(1,0),event=source();
 for(const id of ['invalid','00000000-0000-0000-8000-000000000001','AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA']){
  assert.equal(index.find(id),undefined);assert.throws(()=>index.add(source(id),1),/invalid-journal-identity/);assert.equal(index.size,0);
 }
 const slot=index.add(event,1);assert.throws(()=>index.add({...event,workspaceId:'conflict'},2),/journal-index-limit/);
 assert.equal(index.sequence(slot),1);assert.equal(index.matches(slot,event),true);index.remove(slot);
 for(const read of [()=>index.sequence(slot),()=>index.receivedAt(slot),()=>index.retired(slot),()=>index.matches(slot,event),()=>index.remove(slot)])assert.throws(read,/journal-index-missing/);
 const replacement=source();assert.equal(index.add(replacement,2),slot);assert.equal(index.find(event.eventId),undefined);assert.equal(index.find(replacement.eventId),slot);
});

test('colliding UUID chains preserve lookup after head, middle and tail removal and slot reuse',()=>{
 // These UUIDs share a bucket with seed zero in an eight-bucket index.
 const ids=['00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-00000000000d','00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-00000000001d','00000000-0000-4000-8000-000000000025'];
 for(const victim of [0,2,4]){
  const index=new JournalIndex(8,0),events=ids.map(id=>source(id)),slots=events.map((event,i)=>index.add(event,i+1));
  index.remove(slots[victim]!);assert.equal(index.find(ids[victim]!),undefined);
  for(let i=0;i<ids.length;i++)if(i!==victim){assert.equal(index.find(ids[i]!),slots[i]);assert.equal(index.matches(slots[i]!,events[i]!),true);}
  const replacement=source(),slot=index.add(replacement,100);assert.equal(slot,slots[victim]);assert.equal(index.retired(slot).id,replacement.eventId);
  for(let i=0;i<ids.length;i++)if(i!==victim)index.remove(slots[i]!);
  assert.equal(index.size,1);assert.equal(index.find(replacement.eventId),slot);index.remove(slot);assert.equal(index.size,0);
 }
});

test('binary index agrees with a reference map through seeded collision, capacity, deletion and reuse churn',()=>{
 const pool=Array.from({length:384},(_,i)=>source('00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')));
 for(const seed of [0,1,0xffffffff]){
  const index=new JournalIndex(128,seed),reference=new Map<string,{slot:number;sequence:number;event:SourceEnvelopeV1}>();let state=20261026;
  const random=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
  for(let step=1;step<=10000;step++){
   const event=pool[(random()>>>16)%pool.length]!,known=reference.get(event.eventId);
   if((random()>>>30)===0&&known){index.remove(known.slot);reference.delete(event.eventId);}
   else if(!known&&reference.size<128){const slot=index.add(event,step);reference.set(event.eventId,{slot,sequence:step,event});}
   else if(known)assert.equal(index.find(event.eventId),known.slot);
   else assert.throws(()=>index.add(event,step),/journal-index-limit/);
   assert.equal(index.size,reference.size);
   if(step%100===0)for(const candidate of pool){const expected=reference.get(candidate.eventId);assert.equal(index.find(candidate.eventId),expected?.slot);if(expected){assert.equal(index.sequence(expected.slot),expected.sequence);assert.equal(index.matches(expected.slot,candidate),true);assert.equal(index.retired(expected.slot).digest,envelopeDigest(candidate));}}
  }
 }
});
