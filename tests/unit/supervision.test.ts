import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,rm,mkdir,symlink,readdir,stat,rename,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {SourceEnvelopeV1} from '../../src/transport/sourceContracts';
import type {PublisherConfig} from '../../src/transport/spoolIngester';
import {PluginManager,type ManagerOptions} from '../../src/integration/pluginManager';
import {FixtureTargets} from '../../src/integration/fixtureTargets';
import {observationCoverage} from '../../src/adapters/fileObservations';
import type {LocalObservation} from '../../src/core/reducers';
import {HistoryReset} from '../../src/privacy/historyReset';

async function setup(t:{after:(fn:()=>Promise<void>)=>void},now?:()=>number,observeLocal?:ManagerOptions['observeLocal']){
 const root=await realpath(await mkdtemp(join(tmpdir(),'overwatch-ui-')));let manager:PluginManager|undefined;
 t.after(async()=>{try{await manager?.disable();}finally{await rm(root,{recursive:true,force:true});}});
 await writeFile(join(root,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');await writeFile(join(root,'read.txt'),'Invented fixture.\n');
 const helper=join(root,"helper's $(literal).sh");await writeFile(helper,"#!/bin/sh\nprintf '{}\\n'\n",{mode:0o700});
 let reason:string|undefined;
 manager=new PluginManager({root,storage:join(root,'.local','supervision-storage'),helper,collectorId:'fixture-owner',eligibility:()=>reason,changed:()=>{},...(now?{now}: {}),...(observeLocal?{observeLocal}: {})});
 return {root,helper,manager,eligibility:(next:string|undefined)=>{reason=next;}};
}
test('owned fixture hooks use the Go launcher, omit unqualified sessionEnd and disable the publisher before removal',async t=>{
 const {root,helper,manager}=await setup(t);await manager.enable();
 const hooks=JSON.parse(await readFile(join(root,'.cursor','hooks.json'),'utf8')) as {hooks:Record<string,Array<{command:string}>>};
 assert.equal(Object.keys(hooks.hooks).length,13);assert.equal(hooks.hooks.sessionEnd,undefined);
 assert.ok(hooks.hooks.beforeReadFile?.[0]?.command.includes("'"));assert.ok(hooks.hooks.beforeReadFile?.[0]?.command.includes('literal'));
 assert.equal((await stat(join(root,'.cursor','hooks.json'))).mode&0o777,0o600);assert.equal(manager.enabled,true);
 assert.equal(await manager.disable(),'removed');assert.equal(manager.enabled,false);
 const storage=join(root,'.local','supervision-storage');assert.equal(JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).enabled,false);
 await assert.rejects(readFile(join(root,'.cursor','hooks.json')));
 await manager.enable();assert.equal(manager.enabled,true);assert.equal(await manager.disable(),'removed');
 assert.ok(helper.startsWith(root));
});
test('existing/modified hook configurations and active collector ownership are preserved',async t=>{
 const {root,manager,helper}=await setup(t);await mkdir(join(root,'.cursor'),{mode:0o755});
 const config=join(root,'.cursor','hooks.json'),existing='{"version":1,"hooks":{}}\n';await writeFile(config,existing,{mode:0o600});
 await assert.rejects(manager.enable());assert.equal(await readFile(config,'utf8'),existing);await rm(config);
 await manager.enable();const other=new PluginManager({root,storage:join(root,'.local','supervision-storage'),helper,collectorId:'fixture-owner',eligibility:()=>undefined,changed:()=>{}});
 await assert.rejects(other.enable());assert.equal(manager.enabled,true);await other.disable();
 const modified=(await readFile(config,'utf8'))+'\n';await writeFile(config,modified,{mode:0o600});
 assert.equal(await manager.disable(),'modified-preserved');assert.equal(await readFile(config,'utf8'),modified);
 assert.equal(JSON.parse(await readFile(join(root,'.local','supervision-storage','publisher.json'),'utf8')).enabled,false);
});
test('trust is checked before collection and loss of eligibility stops the owned publisher',async t=>{
 const {root,manager,eligibility}=await setup(t);eligibility('workspace-not-trusted');await assert.rejects(manager.enable(),/workspace-not-trusted/);
 assert.deepEqual((await readdir(root)).sort(),['.overwatch-probe-fixture',"helper's $(literal).sh",'read.txt'].sort());
 eligibility(undefined);await manager.enable();eligibility('workspace-not-trusted');manager.refresh();await manager.disable();
 assert.equal(manager.enabled,false);assert.equal(JSON.parse(await readFile(join(root,'.local','supervision-storage','publisher.json'),'utf8')).enabled,false);
});
test('fixture targets expose only known relative names and refuse missing, symlink or marker-substituted files',async t=>{
 const {root}=await setup(t),targets=new FixtureTargets(root);
 const hash=(p:string)=>createHash('sha256').update('path-hint\0'+p).digest('hex');
 const hint=hash(join(root,'read.txt'));assert.equal(targets.relativePath(hint),'read.txt');
 assert.deepEqual(await targets.resolve(hint),{ok:true,path:join(root,'read.txt'),relativePath:'read.txt'});
 assert.deepEqual(await targets.resolve(hash(join(root,'missing.txt'))),{ok:false,reason:'missing'});
 assert.deepEqual(await targets.resolve(hash(join(root,'private.env'))),{ok:false,reason:'unresolved'});
 await rm(join(root,'read.txt'));await symlink(join(root,'.overwatch-probe-fixture'),join(root,'read.txt'));
 assert.deepEqual(await targets.resolve(hint),{ok:false,reason:'unsafe'});
 await writeFile(join(root,'.overwatch-probe-fixture'),'different');assert.deepEqual(await targets.resolve(hash(join(root,'missing.txt'))),{ok:false,reason:'unsafe'});
});
test('symlinked fixture integration directories never publish to an unrelated location',async t=>{
 const {root,manager}=await setup(t);const outside=await realpath(await mkdtemp(join(tmpdir(),'overwatch-unrelated-')));t.after(()=>rm(outside,{recursive:true,force:true}));
 await symlink(outside,join(root,'.cursor'));await assert.rejects(manager.enable());assert.deepEqual(await readdir(outside),[]);
});

test('delayed pre-enable spool input and replayed requests stay historical while fresh source delivery updates health',async t=>{
 let now=Date.parse('2026-10-24T12:00:00.000Z');const {root,manager}=await setup(t,()=>now);
 await manager.enable();const storage=join(root,'.local','supervision-storage');
 const config=JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')) as PublisherConfig;await manager.disable();
 async function publish(receipt:number,call:string):Promise<string>{
  const eventId=randomUUID(),receivedAt=new Date(receipt).toISOString();
  const source:SourceEnvelopeV1={transportVersion:1,eventId,receivedAt,collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,
   result:{metadata:{metadataVersion:1,eventId,receivedAt,sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',tool:'read',policyId:config.policyId!,workspaceRootHashes:[config.sourceRootHash],conversationId:'a'.repeat(64),generationId:'b'.repeat(64),callId:call.repeat(64),pathHash:createHash('sha256').update('path-hint\0'+join(root,'read.txt')).digest('hex')},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};
  const temporary=join(storage,eventId+'.tmp');await writeFile(temporary,JSON.stringify(source),{mode:0o600});await rename(temporary,join(storage,'inbox',...(config.requireCollectorEpoch?[config.collectorId]:[]),eventId+'.json'));return eventId;
 }
 const historical=await publish(now-1000,'c');await manager.enable();
 async function delivered(id:string):Promise<void>{const deadline=Date.now()+3000;while(!manager.evidence.has(id)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,20));manager.refresh();}assert.ok(manager.evidence.has(id));}
 await delivered(historical);assert.equal(manager.health.snapshot().nativeDelivery,'awaiting-first-event');assert.equal(manager.health.snapshot().historyEvents,1);
 assert.equal(manager.store.snapshot().operations[0]?.liveState,'unknown-after-reload');
 now++;const fresh=await publish(now,'d');await delivered(fresh);
 assert.equal(manager.health.snapshot().nativeDelivery,'source-event-observed');assert.equal(manager.store.snapshot().operations[1]?.liveState,'recent-request');
 await manager.disable();now+=1000;await manager.enable();
 assert.equal(manager.health.snapshot().nativeDelivery,'awaiting-first-event');assert.ok(manager.store.snapshot().operations.every(o=>o.liveState==='unknown-after-reload'));
});

test('failed disable never reports collection off or ready when ownership/config cleanup is uncertain',async t=>{
 const {root,manager}=await setup(t);await manager.enable();const publisher=join(root,'.local','supervision-storage','publisher.json');
 const original=await readFile(publisher,'utf8');
 try{await writeFile(publisher,'{}');await assert.rejects(manager.disable());assert.equal(manager.health.snapshot().transport,'disconnected');assert.ok(manager.status.includes('live state unknown'));await assert.rejects(manager.enable(),/collector-disconnected/);}
 finally{await writeFile(publisher,original);await manager.disable();}
 assert.equal(manager.health.snapshot().transport,'disabled');
});

test('owned observation handles are disposed on disable and stale callbacks cannot cross re-enable',async t=>{
 const sinks:Array<(observation:LocalObservation)=>void>=[];let disposals=0,idles=0;
 const {manager}=await setup(t,undefined,async deliver=>{
  sinks.push(deliver);let off=false;return{dispose:()=>{if(!off){off=true;disposals++;}},whenIdle:async()=>{idles++;},snapshot:()=>observationCoverage(off?'off':'watching')};
 });
 const record=():LocalObservation=>{const eventId=randomUUID();return{kind:'disk-change-notification',currentPresence:'file',event:{schemaVersion:1,eventId,collectorId:'fixture-owner',environmentId:'local-darwin-arm64',workspaceId:'root',source:'filesystem',sourceEvent:'fileChanged',receivedAt:new Date().toISOString(),actorScope:'unknown',operationId:eventId,operation:'unknown',phase:'observed',outcome:'unknown',targets:[{pathScope:'workspace',pathKind:'file',relativePath:'read.txt',fileKey:'file'}],evidence:{activity:'filesystem-observed',attribution:'unknown',completion:'not-observed',diskPersistence:'unknown',correlation:'unpaired',limitations:['source-coverage-partial']}}};};
 await manager.enable();sinks[0]!(record());assert.equal(manager.observations.snapshot().records.length,1);assert.equal(manager.health.snapshot().nativeDelivery,'awaiting-first-event');
 await manager.disable();assert.equal(disposals,1);assert.equal(idles,1);sinks[0]!(record());assert.equal(manager.observations.snapshot().records.length,1);
 await manager.enable();sinks[0]!(record());assert.equal(manager.observations.snapshot().records.length,1);sinks[1]!(record());assert.equal(manager.observations.snapshot().records.length,2);
 await manager.disable();assert.equal(disposals,2);assert.equal(manager.observationStatus().state,'off');
});

test('an unavailable local watcher is disclosed without manufacturing native-delivery failure',async t=>{
 const {manager}=await setup(t,undefined,async()=>{throw new Error('watcher-unavailable');});await manager.enable();
 assert.equal(manager.enabled,true);assert.equal(manager.observationStatus().state,'unavailable');assert.equal(manager.observationStatus().failures,1);
 assert.equal(manager.health.snapshot().nativeDelivery,'awaiting-first-event');await manager.disable();assert.equal(manager.observationStatus().state,'off');
});

test('first export after a different window resets history clears stale in-memory projections', async t => {
 const {root, manager} = await setup(t);
 await manager.enable();
 const eventId = randomUUID();
 manager.observations.apply({kind:'disk-change-notification', currentPresence:'file', event:{schemaVersion:1,eventId,collectorId:'fixture-owner',environmentId:'local-darwin-arm64',workspaceId:'root',source:'filesystem',sourceEvent:'fileChanged',receivedAt:new Date().toISOString(),actorScope:'unknown',operationId:eventId,operation:'unknown',phase:'observed',outcome:'unknown',targets:[{pathScope:'workspace',pathKind:'file',relativePath:'read.txt',fileKey:'file'}],evidence:{activity:'filesystem-observed',attribution:'unknown',completion:'not-observed',diskPersistence:'unknown',correlation:'unpaired',limitations:['source-coverage-partial']}}});
 await manager.disable();
 assert.equal(manager.observations.snapshot().records.length, 1);
 const reset = new HistoryReset(root, join(root, '.local', 'supervision-storage'));
 t.after(() => reset.cancel());
 const review = await reset.prepare();
 await reset.commit(review.token);
 await manager.withStorageLease(async () => {
  assert.equal(manager.observations.snapshot().records.length, 0);
  assert.equal(manager.evidence.size, 0);
  assert.equal(manager.readiness().queue, undefined);
  assert.equal(manager.readiness().replayDurationMs, undefined);
 });
});

test('a rolling recent journal tail replays as unknown and continues projecting fresh records at the same array length', async t => {
 const {root, manager} = await setup(t);
 await manager.enable(); await manager.disable();
 const storage=join(root,'.local','supervision-storage');
 const config=JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')) as PublisherConfig;
 const source=(sequence:number):SourceEnvelopeV1=>{const eventId=randomUUID(),receivedAt=new Date().toISOString();return{transportVersion:1,eventId,receivedAt,collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,result:{metadata:{metadataVersion:1,eventId,receivedAt,sourceEvent:'beforeReadFile',sourceVersion:'3.26.16',tool:'read',policyId:config.policyId!,workspaceRootHashes:[config.sourceRootHash],conversationId:'a'.repeat(64),generationId:'b'.repeat(64),callId:createHash('sha256').update(String(sequence)).digest('hex')},counters:{unknownFields:0,sensitiveFields:0,invalidFields:0}}};};
 const lines=Array.from({length:5001},(_,i)=>JSON.stringify({journalVersion:1,ingestSequence:i+1,envelope:source(i)}));
 await writeFile(join(storage,'journal','journal-000000.ndjson'),lines.join('\n')+'\n',{mode:0o600});
 await manager.enable();
 for(let i=0;i<30;i++) manager.refresh();
 assert.equal(manager.readiness().history?.retainedRecords,5001);
 assert.equal(manager.readiness().history?.bufferedRecords,5000);
 assert.equal(manager.evidence.size,5000);
 assert.equal(manager.health.snapshot().nativeDelivery,'awaiting-first-event');
 const fresh=source(5002);
 await writeFile(join(storage,'inbox',config.collectorId,fresh.eventId+'.json'),JSON.stringify(fresh),{mode:0o600});
 const deadline=Date.now()+5000;
 while(!manager.evidence.has(fresh.eventId)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,25));manager.refresh();}
 assert.ok(manager.evidence.has(fresh.eventId));
 assert.equal(manager.evidence.size,5000);
 assert.equal(manager.readiness().history?.retainedRecords,5002);
 assert.equal(manager.health.snapshot().nativeDelivery,'source-event-observed');
});

test('self-check is trust/collection gated and a response without spool delivery is diagnosed separately',async t=>{
 const {manager,eligibility}=await setup(t);assert.equal((await manager.runSelfCheck()).state,'collector-off');eligibility('workspace-not-trusted');assert.equal((await manager.runSelfCheck()).state,'unsupported');eligibility(undefined);
 await manager.enable();assert.equal((await manager.runSelfCheck()).state,'delivery-timeout');assert.equal(manager.health.snapshot().nativeDelivery,'awaiting-first-event');assert.equal(manager.store.snapshot().operations.length,0);assert.equal(manager.readiness().registered,true);await manager.disable();
});

test('opted-in valid existing hooks keep unknown keys and permission commands and restore the exact original bytes',async t=>{
 const {root,helper}=await setup(t);await mkdir(join(root,'.cursor'),{mode:0o700});const file=join(root,'.cursor','hooks.json');
 const original='{\n  "version": 1, "custom": {"value": "retain"},\n  "hooks": {"beforeReadFile": [{"command": "original-permission-policy", "matcher": "Read", "timeout": 2}], "futureHook": {"unknown": true}}\n}\n\n';await writeFile(file,original,{mode:0o600});
 const storage=join(root,'.local','supervision-storage'),manager=new PluginManager({root,storage,helper,collectorId:'fixture-owner',eligibility:()=>undefined,changed:()=>{},allowExistingHooks:()=>true});
 try{await manager.enable();const installed=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(installed.hooks.beforeReadFile[0],JSON.parse(original).hooks.beforeReadFile[0]);assert.equal(installed.hooks.beforeReadFile.length,2);assert.deepEqual(installed.custom,{value:'retain'});assert.deepEqual(installed.hooks.futureHook,{unknown:true});
 const backup=JSON.parse(await readFile(join(storage,'hook-ownership.json'),'utf8'));assert.equal(backup.original,original);assert.equal((await stat(join(storage,'hook-ownership.json'))).mode&0o777,0o600);
 assert.equal(await manager.disable(),'removed');assert.equal(await readFile(file,'utf8'),original);await assert.rejects(access(join(storage,'hook-ownership.json')));
 await manager.enable();assert.equal(await manager.disable(),'removed');assert.equal(await readFile(file,'utf8'),original);
 }finally{await manager.disable();}
});
test('post-install config edits preserve the modified file and private original backup instead of restoring over them',async t=>{
 const {root,helper}=await setup(t);await mkdir(join(root,'.cursor'),{mode:0o700});const file=join(root,'.cursor','hooks.json'),original='{"version":1,"hooks":{"customHook":[{"command":"custom-policy"}]}}\n';await writeFile(file,original,{mode:0o600});
 const storage=join(root,'.local','supervision-storage'),manager=new PluginManager({root,storage,helper,collectorId:'fixture-owner',eligibility:()=>undefined,changed:()=>{},allowExistingHooks:()=>true});
 try{await manager.enable();const changed=(await readFile(file,'utf8'))+'\n';await writeFile(file,changed);assert.equal(await manager.disable(),'modified-preserved');assert.equal(await readFile(file,'utf8'),changed);assert.equal(JSON.parse(await readFile(join(storage,'hook-ownership.json'),'utf8')).original,original);await assert.rejects(manager.enable(),/foreign-or-modified-hooks/);assert.equal(await readFile(file,'utf8'),changed);assert.equal(JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')).enabled,false);
 }finally{await manager.disable();}
});
test('opted-in malformed, duplicate, unsupported and invalid hook documents are byte-identical on refusal',async t=>{
 const {root,helper}=await setup(t);await mkdir(join(root,'.cursor'),{mode:0o700});const file=join(root,'.cursor','hooks.json');
 for(const original of ['BROKEN','{"version":1,"version":1,"hooks":{}}','{"version":2,"hooks":{}}','{"version":1,"hooks":{"beforeReadFile":{}}}','{"version":1,"hooks":{"beforeReadFile":[{"command":"cursor-supervision-hook old"}]}}']){
  await writeFile(file,original,{mode:0o600});const manager=new PluginManager({root,storage:join(root,'.local','supervision-storage'),helper,collectorId:'fixture-owner',eligibility:()=>undefined,changed:()=>{},allowExistingHooks:()=>true});try{await assert.rejects(manager.enable());assert.equal(await readFile(file,'utf8'),original);}finally{await manager.disable();}
 }
});
