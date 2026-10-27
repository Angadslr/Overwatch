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
 for (let i=0;i<events.length;i+=2) {
  assert.equal(index.find(events[i]!.eventId),undefined);
  const envelope=event(),slot=index.add(envelope,2000+i);
  assert.equal(index.sequence(slot),2000+i);
  assert.equal(index.matches(slot,envelope),true);
 }
 assert.equal(index.size,1030);
});
