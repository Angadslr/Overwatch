import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { initializeSpool, SpoolIngester } = require('../dist/transport.cjs');
const { normalizeJournalRecord } = require('../dist/cursor-projection.cjs');
const { FileActivityStore } = require('../dist/file-activity.cjs');
const count = 2000, path = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-replay-')));
let owner;
try {
  const now = Date.now(), config = await initializeSpool(path, {collectorId:'measurement',environmentId:'local',workspaceId:'synthetic'}, path);
  owner = await SpoolIngester.open(path, config);
  for (let offset = 0; offset < count; offset += 64) {
    await Promise.all(Array.from({length:Math.min(64,count-offset)},async()=>{
      const eventId=randomUUID(), receivedAt=new Date(now).toISOString();
      const envelope={transportVersion:1,eventId,receivedAt,collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,
        result:{metadata:{metadataVersion:1,eventId,receivedAt,sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',tool:'read',workspaceRootHashes:[config.sourceRootHash]},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};
      await writeFile(join(path,'inbox',eventId+'.json'),JSON.stringify(envelope),{mode:0o600});
    }));
    await owner.scan();
  }
  assert.equal(owner.journal.records.length,count);
  const retainedBytes=owner.journal.status().bytes;
  await owner.close(); owner=undefined;
  let started=performance.now(); owner=await SpoolIngester.open(path,config);
  const sourceValidationMs=performance.now()-started;
  started=performance.now();const cold=new FileActivityStore(()=>now);
  for(const record of owner.journal.records)cold.apply(normalizeJournalRecord(record),'replay');
  const coldProjectionMs=performance.now()-started;
  assert.equal(await owner.checkpoints.save(owner.journal.records,config.policyId,normalizeJournalRecord),true);
  started=performance.now();const cache=await owner.checkpoints.load(owner.journal.records,config.policyId);assert.ok(cache);
  const warm=new FileActivityStore(()=>now);for(const record of owner.journal.records)warm.apply(cache.get(record.ingestSequence),'replay');
  const checkpointValidationAndProjectionMs=performance.now()-started;
  assert.deepEqual(warm.snapshot(),cold.snapshot());
  const result={measuredAt:new Date().toISOString(),nativeDelivery:false,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,node:process.version,records:count,retainedBytes,
    sourceValidationMs,coldProjectionMs,checkpointValidationAndProjectionMs,identicalProjection:true,
    limitations:'One synthetic local sample; source journal validation remains mandatory. Checkpoint timings include checksum and schema validation. This does not measure native hook latency or establish a speedup.'};
  await writeFile(new URL('../docs/t19-replay-measurement.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{await owner?.close();await rm(path,{recursive:true,force:true});}
