import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile, readFile, readdir, appendFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { initializeSpool, SpoolIngester, type PublisherConfig } from '../../src/transport/spoolIngester';
import {RECENT_JOURNAL_RECORDS} from '../../src/transport/journal';
import type { SourceEnvelopeV1 } from '../../src/transport/sourceContracts';
import { normalizeJournalRecord } from '../../src/adapters/cursorHooks';
import { FileActivityStore } from '../../src/core/reducers';
const start=Date.parse('2026-10-26T00:00:00.000Z');
async function setup(t:{after:(fn:()=>Promise<void>)=>void}){const path=await realpath(await mkdtemp(join(tmpdir(),'retention-')));t.after(()=>rm(path,{recursive:true,force:true}));const config=await initializeSpool(path,{collectorId:'collector',environmentId:'local',workspaceId:'workspace'},path);return{path,config};}
function envelope(config:PublisherConfig,at=start):SourceEnvelopeV1{const eventId=randomUUID(),receivedAt=new Date(at).toISOString();return{transportVersion:1,eventId,receivedAt,collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,result:{metadata:{metadataVersion:1,eventId,receivedAt,sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',tool:'read',workspaceRootHashes:[config.sourceRootHash]},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};}
const publish=async(path:string,e:SourceEnvelopeV1)=>writeFile(join(path,'inbox',e.eventId+'.json'),JSON.stringify(e),{mode:0o600});
const options={policy:{segmentBytes:2048,historyBytes:4096,records:6,ageMs:86400000},now:()=>start};
test('size/count retention prunes whole segments, keeps monotonic sequences and deduplicates a committed retired retry after restart',async t=>{
 const {path,config}=await setup(t);let owner=await SpoolIngester.open(path,config,undefined,options);const events=Array.from({length:16},()=>envelope(config));
 for(const e of events){await publish(path,e);await owner.scan();}
 const status=owner.journal.status();assert.ok(status.firstSequence>1);assert.equal(status.nextSequence,17);assert.ok(status.retainedRecords<=6);assert.ok(status.bytes<=4096);assert.ok(status.retiredIdentities>0);
 await owner.close();owner=await SpoolIngester.open(path,config,undefined,options);
 try{await publish(path,events[0]!);await owner.scan();assert.equal(owner.counters.duplicates,1);assert.equal(owner.journal.status().nextSequence,17);assert.equal(owner.journal.records.some(r=>r.envelope.eventId===events[0]!.eventId),false);
 const next=envelope(config);await publish(path,next);await owner.scan();assert.equal(owner.journal.records.at(-1)?.ingestSequence,17);
 const manifest=await readFile(join(path,'journal/retention.json'),'utf8');assert.equal(manifest.includes('sourceEvent'),false);assert.equal(manifest.includes('pathHash'),false);assert.equal(manifest.includes('FAKE_SECRET'),false);
 }finally{await owner.close();}
});
test('age retention rotates even an idle active segment and rejects expired ready records without resurrection',async t=>{
 const {path,config}=await setup(t);let now=start;const settings={policy:options.policy,now:()=>now};let owner=await SpoolIngester.open(path,config,undefined,settings);const old=envelope(config);await publish(path,old);await owner.scan();
 now+=86400001;await owner.scan();assert.equal(owner.journal.records.length,0);assert.equal(owner.journal.status().nextSequence,2);assert.equal(owner.journal.status().retiredIdentities,0);await owner.close();
 owner=await SpoolIngester.open(path,config,undefined,settings);try{await publish(path,old);await owner.scan();assert.equal(owner.counters.expired,1);assert.equal(owner.journal.records.length,0);
 const fresh=envelope(config,now);await publish(path,fresh);await owner.scan();assert.equal(owner.journal.records[0]?.ingestSequence,2);
 }finally{await owner.close();}
});
test('committed manifest survives interruption before old-file removal and source retries remain idempotent',async t=>{
 const {path,config}=await setup(t);const owner=await SpoolIngester.open(path,config,undefined,{...options,policy:{...options.policy,records:2},afterRetentionCommit:async()=>{throw new Error('simulated-crash-after-retention-commit');}});
 const events=[envelope(config),envelope(config),envelope(config)];for(const e of events){await publish(path,e);await owner.scan().catch(()=>{});}await owner.close();
 const recovered=await SpoolIngester.open(path,config,undefined,{...options,policy:{...options.policy,records:2}});
 try{await recovered.scan();assert.ok(recovered.journal.records.length<=2);assert.equal(recovered.journal.status().nextSequence,4);await publish(path,events[0]!);await recovered.scan();assert.equal(recovered.counters.duplicates,1);
 const names=(await readdir(join(path,'journal'))).filter(n=>n.endsWith('.ndjson'));const first=JSON.parse(await readFile(join(path,'journal/retention.json'),'utf8')).firstSegment;assert.ok(names.every(n=>Number(n.slice(8,14))>=first));
 }finally{await recovered.close();}
});
test('projection checkpoints bind schema, policy, sequence and source digests; corrupt caches fall back to authoritative replay',async t=>{
 const {path,config}=await setup(t);const owner=await SpoolIngester.open(path,config,undefined,options);try{
 for(let i=0;i<3;i++){await publish(path,envelope(config));await owner.scan();}
 const coldStart=performance.now(),cold=new FileActivityStore(()=>start);for(const r of owner.journal.records)cold.apply(normalizeJournalRecord(r)!,'replay');const coldMs=performance.now()-coldStart;
 assert.equal(await owner.checkpoints.save(owner.journal.records,config.policyId!,normalizeJournalRecord),true);
 const warmStart=performance.now(),cache=await owner.checkpoints.load(owner.journal.records,config.policyId!);assert.ok(cache);const warm=new FileActivityStore(()=>start);for(const r of owner.journal.records)warm.apply(cache.get(r.ingestSequence)!,'replay');const warmMs=performance.now()-warmStart;assert.deepEqual(warm.snapshot(),cold.snapshot());
 t.diagnostic(`3-record measured cold replay ${coldMs.toFixed(2)} ms; validated checkpoint load/replay ${warmMs.toFixed(2)} ms. This is a smoke sample, not a performance claim.`);
 assert.equal(await owner.checkpoints.load(owner.journal.records,'a'.repeat(64)),undefined);await appendFile(join(path,'projection-checkpoint.json'),'BROKEN');assert.equal(await owner.checkpoints.load(owner.journal.records,config.policyId!),undefined);
 }finally{await owner.close();}
});
test('retention invalidates old projection/checkpoint staging before deleting source segments',async t=>{
 const {path,config}=await setup(t);let now=start;const owner=await SpoolIngester.open(path,config,undefined,{...options,now:()=>now});try{
 await publish(path,envelope(config));await owner.scan();await owner.checkpoints.save(owner.journal.records,config.policyId!,normalizeJournalRecord);
 const temporary=join(path,'history-'+randomUUID()+'.tmp');await writeFile(temporary,'FAKE_SECRET_STALE_DERIVED_DATA',{mode:0o600});now+=86400001;await owner.scan();
 await assert.rejects(access(join(path,'projection-checkpoint.json')));await assert.rejects(access(temporary));assert.equal(owner.journal.records.length,0);
 }finally{await owner.close();}
});
test('middle/complete corruption fails closed while a torn final suffix has a distinct disclosed recovery',async t=>{
 const {path,config}=await setup(t);let owner=await SpoolIngester.open(path,config,undefined,options);await publish(path,envelope(config));await owner.scan();await owner.close();
 const file=join(path,'journal/journal-000000.ndjson');await appendFile(file,'{"torn":');owner=await SpoolIngester.open(path,config,undefined,options);assert.equal(owner.journal.recoveredTail,true);await owner.close();
 await appendFile(file,'BROKEN\n');await assert.rejects(SpoolIngester.open(path,config,undefined,options),/journal-corrupt/);
});

test('journal keeps a bounded recent tail while older retained records remain queryable and deduplicated', async t => {
 const {path, config} = await setup(t);
 const count = RECENT_JOURNAL_RECORDS + 200;
 const events = Array.from({length:count}, () => envelope(config));
 const lines = events.map((value,index) => JSON.stringify({journalVersion:1,ingestSequence:index+1,envelope:value}));
 const file = join(path,'journal','journal-000000.ndjson');
 await writeFile(file,lines.join('\n')+'\n',{mode:0o600});
 let owner = await SpoolIngester.open(path,config,undefined,{now:()=>start});
 try {
  assert.equal(owner.journal.status().retainedRecords,count);
  assert.equal(owner.journal.records.length,RECENT_JOURNAL_RECORDS);
  assert.equal(owner.journal.records[0]?.ingestSequence,201);
  const older = await owner.journal.readHistory(0,200);
  assert.equal(older.length,200);
  assert.equal(older[0]?.envelope.eventId,events[0]?.eventId);
  assert.equal(older.at(-1)?.ingestSequence,200);
  await publish(path,events[0]!); await owner.scan();
  assert.equal(owner.counters.duplicates,1);
  assert.equal(owner.journal.status().nextSequence,count+1);
  const conflict = structuredClone(events[0]!); conflict.result.counters.unknownFields++;
  await assert.rejects(owner.journal.append(conflict),/event-id-conflict/);
  await publish(path,envelope(config)); await owner.scan();
  assert.equal(owner.journal.records.length,RECENT_JOURNAL_RECORDS);
  assert.equal(owner.journal.records[0]?.ingestSequence,202);
  assert.equal(owner.journal.records.at(-1)?.ingestSequence,count+1);
  await assert.rejects(owner.journal.readHistory(0,RECENT_JOURNAL_RECORDS+1),/invalid-history-page/);
 } finally { await owner.close(); }
 owner = await SpoolIngester.open(path,config,undefined,{now:()=>start});
 try {
  assert.equal(owner.journal.status().retainedRecords,count+1);
  assert.equal(owner.journal.records.length,RECENT_JOURNAL_RECORDS);
  assert.equal((await owner.journal.readHistory(0,1))[0]?.envelope.eventId,events[0]?.eventId);
 } finally { await owner.close(); }
 const damaged = JSON.parse(lines[0]!); damaged.envelope.result.counters.invalidFields = 'FAKE_SECRET_INVALID_OLD_RECORD';
 await writeFile(file,[JSON.stringify(damaged),...lines.slice(1)].join('\n')+'\n',{mode:0o600});
 await assert.rejects(SpoolIngester.open(path,config,undefined,{now:()=>start}),/journal-corrupt/);
});

test('durable batches serialize with single appends and deduplicate repeated identities before assigning sequences',async t=>{
 const {path,config}=await setup(t),owner=await SpoolIngester.open(path,config,undefined,{now:()=>start});
 try{
  const first=envelope(config),second=envelope(config);
  const initial=await owner.journal.appendBatch([first,first,second]);
  assert.deepEqual(initial.map(result=>result.added),[true,false,true]);
  assert.deepEqual(initial.map(result=>result.record?.ingestSequence),[1,1,2]);
  const groups=Array.from({length:3},()=>Array.from({length:8},()=>envelope(config)));
  await Promise.all([owner.journal.appendBatch(groups[0]!),owner.journal.append(envelope(config)),owner.journal.appendBatch(groups[1]!),owner.journal.appendBatch(groups[2]!)]);
  assert.deepEqual(owner.journal.records.map(record=>record.ingestSequence),Array.from({length:27},(_,i)=>i+1));
  const persisted=(await readFile(join(path,'journal','journal-000000.ndjson'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(persisted.length,27);assert.equal(new Set(persisted.map(record=>record.envelope.eventId)).size,27);
 }finally{await owner.close();}
 const replay=await SpoolIngester.open(path,config,undefined,{now:()=>start});try{assert.equal(replay.journal.status().retainedRecords,27);assert.equal(replay.journal.status().nextSequence,28);}finally{await replay.close();}
});

test('batch admission refuses conflicts and invalid records before writing; grouped rotation preserves bounded retention and retired retries',async t=>{
 const {path,config}=await setup(t),owner=await SpoolIngester.open(path,config,undefined,options);
 try{
  const first=envelope(config),conflict=structuredClone(first);conflict.result.counters.invalidFields++;
  await assert.rejects(owner.journal.appendBatch([first,conflict]),/event-id-conflict/);
  await assert.rejects(owner.journal.appendBatch([first,{...envelope(config),prompt:'FAKE_SECRET_INVALID'} as SourceEnvelopeV1]),/invalid-source-envelope/);
  await assert.rejects(owner.journal.appendBatch([first],()=>false),/invalid-source-envelope/);
  assert.equal(owner.journal.status().retainedRecords,0);assert.deepEqual(await readdir(join(path,'journal')),[]);
  const events=Array.from({length:24},()=>envelope(config));
  const results=await owner.journal.appendBatch(events);assert.equal(results.filter(result=>result.added).length,24);
  assert.equal(owner.journal.status().nextSequence,25);assert.ok(owner.journal.status().retainedRecords<=6);assert.ok(owner.journal.status().bytes<=4096);
  assert.equal((await owner.journal.appendBatch([events[0]!]))[0]?.added,false);
  assert.equal(owner.journal.status().nextSequence,25);
 }finally{await owner.close();}
});
