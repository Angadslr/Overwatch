import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, chmod, writeFile, readFile, readdir, rm, symlink, mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeSpool, SpoolIngester, type PublisherConfig } from '../../src/transport/spoolIngester';
import { parseSource } from '../../src/transport/sourceValidation';
import type { SourceEnvelopeV1 } from '../../src/transport/sourceContracts';

async function setup(t: {after: (fn:()=>Promise<void>)=>void}) {
  const path = await realpath(await mkdtemp(join(tmpdir(),'overwatch-spool-'))); await chmod(path,0o700);
  t.after(()=>rm(path,{recursive:true,force:true}));
  const config = await initializeSpool(path,{collectorId:'collector',environmentId:'local',workspaceId:'workspace'},path);
  return {path,config};
}
function envelope(config: PublisherConfig, eventId=randomUUID()): SourceEnvelopeV1 {
  return {transportVersion:1,eventId,receivedAt:'2026-10-22T12:00:00.000Z',collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,result:{metadata:{metadataVersion:1,eventId,receivedAt:'2026-10-22T12:00:00.000Z',sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',workspaceRootHashes:[config.sourceRootHash],tool:'read'},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};
}
async function publish(path:string,e:SourceEnvelopeV1) { await writeFile(join(path,'inbox',e.eventId+'.json'),JSON.stringify(e),{mode:0o600}); }

test('source envelopes reject extras, unsupported versions, invalid bytes, identity mismatches and large records',async t=>{
  const {config}=await setup(t), e=envelope(config);
  assert.ok(parseSource(Buffer.from(JSON.stringify(e))));
  for(const value of [{...e,transportVersion:2},{...e,prompt:'FAKE_SECRET_MARKER'},{...e,result:{...e.result,metadata:{...e.result.metadata,eventId:randomUUID()}}}]) assert.equal(parseSource(Buffer.from(JSON.stringify(value))),undefined);
  assert.equal(parseSource(Buffer.from([255])),undefined);assert.equal(parseSource(Buffer.alloc(16385)),undefined);
});

test('exclusive collector syncs before acknowledgment and replay deduplicates a committed retry',async t=>{
  const {path,config}=await setup(t), e=envelope(config);
  let owner=await SpoolIngester.open(path,config);
  await assert.rejects(SpoolIngester.open(path,config));
  const lease=JSON.parse(await readFile(join(path,'collector.lock'),'utf8')) as {token:string};
  await assert.rejects(SpoolIngester.open(path,config,lease.token));
  await publish(path,e);
  await owner.scan(async()=>{
    assert.equal((await readdir(join(path,'inbox'))).length,1);
    const persisted=await readFile(join(path,'journal','journal-000000.ndjson'),'utf8');
    assert.equal(JSON.parse(persisted).ingestSequence,1);
    throw new Error('simulated-ack-failure');
  });
  assert.equal(owner.journal.records.length,1);assert.equal((await readdir(join(path,'inbox'))).length,1);
  await owner.close();owner=await SpoolIngester.open(path,config);
  try { assert.equal(owner.journal.records.length,1);assert.equal((await owner.scan()).length,0);assert.equal(owner.counters.duplicates,1);assert.deepEqual(await readdir(join(path,'inbox')),[]); }
  finally {await owner.close();}
});

test('bounded rescans progress without watcher notifications and reject unsafe entries without reading their targets',async t=>{
  const {path,config}=await setup(t),owner=await SpoolIngester.open(path,config);
  try {
    const outside=join(path,'secret');await writeFile(outside,'FAKE_SECRET_MARKER',{mode:0o600});
    await symlink(outside,join(path,'inbox',randomUUID()+'.json'));
    await mkdir(join(path,'inbox',randomUUID()+'.json'),{mode:0o700});
    await writeFile(join(path,'inbox',randomUUID()+'.json'),Buffer.alloc(16385),{mode:0o600});
    await writeFile(join(path,'inbox','malformed.json'),'FAKE_SECRET_MARKER',{mode:0o600});
    const unsupported=envelope(config);unsupported.result.metadata!.sourceVersion='9.9.9';await publish(path,unsupported);
    const wrongRoot=envelope(config);wrongRoot.result.metadata!.workspaceRootHashes=['a'.repeat(64)];await publish(path,wrongRoot);
    for(let i=0;i<270;i++)await publish(path,envelope(config));
    assert.ok((await owner.scan()).length<=256);
    for(let i=0;i<4;i++)await owner.scan();
    assert.equal(owner.journal.records.length,270);assert.ok(owner.counters.rejected>=6);
    assert.equal(await readFile(outside,'utf8'),'FAKE_SECRET_MARKER');
    assert.equal(JSON.stringify(owner.journal.records).includes('FAKE_SECRET_MARKER'),false);
  } finally {await owner.close();}
});

test('journal repairs only an unterminated final tail; complete corruption and missing segments fail closed',async t=>{
  const {path,config}=await setup(t);let owner=await SpoolIngester.open(path,config);
  await publish(path,envelope(config));await owner.scan();await owner.close();
  const file=join(path,'journal','journal-000000.ndjson');
  await appendFile(file,'{"torn":');
  owner=await SpoolIngester.open(path,config);assert.equal(owner.journal.recoveredTail,true);assert.equal(owner.journal.records.length,1);await owner.close();
  await appendFile(file,'BROKEN\n');await assert.rejects(SpoolIngester.open(path,config),/journal/);
  await rm(file);await writeFile(join(path,'journal','journal-000001.ndjson'),' ',{mode:0o600});
  await assert.rejects(SpoolIngester.open(path,config),/journal-segment-missing/);
});

test('periodic scans collect without any watcher and stop cleanly',async t=>{
  const {path,config}=await setup(t),owner=await SpoolIngester.open(path,config);
  try {
    owner.start(50,false);await publish(path,envelope(config));
    const deadline=Date.now()+3000;
    while(owner.counters.accepted!==1 && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(owner.counters.accepted,1);assert.deepEqual(await readdir(join(path,'inbox')),[]);
  }finally{const closing=owner.close();assert.equal(owner.close(),closing);await closing;}
  await assert.rejects(owner.scan(),/collector-closed/);
});

test('inbox replacement and lease replacement stop acknowledgment and preserve unrelated storage',async t=>{
  const {path,config}=await setup(t),owner=await SpoolIngester.open(path,config);
  const e=envelope(config);await publish(path,e);
  await owner.scan(async()=>{
    await rm(join(path,'collector.lock'));
    await writeFile(join(path,'collector.lock'),'replacement',{mode:0o600});
  });
  assert.equal((await readdir(join(path,'inbox'))).length,1);
  await owner.close();assert.equal(await readFile(join(path,'collector.lock'),'utf8'),'replacement');
  const other=await setup(t);const owner2=await SpoolIngester.open(other.path,other.config);
  await rm(join(other.path,'inbox'),{recursive:true});await symlink(join(path,'inbox'),join(other.path,'inbox'));
  await assert.rejects(owner2.scan(),/storage-directory-changed/);await owner2.close();
});
