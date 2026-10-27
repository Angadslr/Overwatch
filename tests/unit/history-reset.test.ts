import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,readdir,access,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {HistoryReset} from '../../src/privacy/historyReset';
import {initializeSpool,SpoolIngester,type PublisherConfig} from '../../src/transport/spoolIngester';
async function setup(t:{after:(fn:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'history-reset-'))),storage=join(root,'.local','supervision-storage'),reset=new HistoryReset(root,storage);t.after(async()=>{await reset.cancel();await rm(root,{recursive:true,force:true});});await writeFile(join(root,'.overwatch-probe-fixture'),'overwatch-invented-fixture-v1\n');await mkdir(join(root,'.local'),{mode:0o700});await mkdir(storage,{mode:0o700});
 let config=await initializeSpool(storage,{collectorId:randomUUID(),environmentId:'local-darwin-arm64',workspaceId:createHash('sha256').update('workspace\0'+root).digest('hex')},root,false);const owner=await SpoolIngester.open(storage,config);await owner.requireCollectorEpoch();config=owner.publisherConfig();
 await owner.journal.append({transportVersion:1,eventId:randomUUID(),receivedAt:new Date().toISOString(),collectorId:config.collectorId,environmentId:config.environmentId,workspaceId:config.workspaceId,result:{counters:{unknownFields:0,sensitiveFields:0,invalidFields:0,gap:'invalid-json'}}});await owner.close();
 const reread=async()=>JSON.parse(await readFile(join(storage,'publisher.json'),'utf8')) as PublisherConfig;
 const reopen=async()=>{const next=await reread();const actual=await initializeSpool(storage,{collectorId:next.collectorId,environmentId:next.environmentId,workspaceId:next.workspaceId},root,false);return SpoolIngester.open(storage,actual);};return{root,storage,reset,config,reread,reopen};
}
test('review cancellation preserves history and releases ownership while collection remains off',async t=>{
 const {storage,reset,config,reopen}=await setup(t),path=join(storage,'journal','journal-000000.ndjson'),before=await readFile(path,'utf8');const review=await reset.prepare();assert.ok(review.files>0);assert.equal(review.includeExports,false);assert.ok(review.notes.some(n=>n.includes('Collection remains off')));await reset.cancel();assert.equal(await readFile(path,'utf8'),before);await assert.rejects(reset.commit(review.token),/reset-review-expired/);const owner=await reopen();try{assert.equal(owner.journal.records.length,1);assert.equal(owner.publisherConfig().collectorId,config.collectorId);assert.equal(owner.publisherConfig().enabled,false);}finally{await owner.close();}
});
test('scoped reset clears corrupt history, pending data and staging while preserving user files, hook backup and unselected exports',async t=>{
 const {root,storage,reset,config,reread,reopen}=await setup(t),journal=join(storage,'journal','journal-000000.ndjson');await writeFile(journal,'FAKE_SECRET_CORRUPT_RECORD\n');await writeFile(join(root,'user.txt'),'keep user');await writeFile(join(storage,'hook-ownership.json'),'keep original hook backup',{mode:0o600});await mkdir(join(storage,'exports'),{mode:0o700});const saved=join(storage,'exports','export-'+randomUUID()+'.json'),stage=join(storage,'exports','export-'+randomUUID()+'.tmp');await writeFile(saved,'keep reviewed export',{mode:0o600});await writeFile(stage,'FAKE_SECRET_STAGE',{mode:0o600});await writeFile(join(storage,'inbox',config.collectorId,randomUUID()+'.json'),'FAKE_SECRET_PENDING',{mode:0o600});await assert.rejects(reopen(),/journal-corrupt/);
 const review=await reset.prepare(),result=await reset.commit(review.token);assert.ok(result.removed>=3);assert.notEqual(result.newEpoch,config.collectorId);assert.equal((await reread()).enabled,false);assert.equal(await readFile(join(root,'user.txt'),'utf8'),'keep user');assert.equal(await readFile(join(storage,'hook-ownership.json'),'utf8'),'keep original hook backup');assert.equal(await readFile(saved,'utf8'),'keep reviewed export');await assert.rejects(access(stage));await assert.rejects(access(join(storage,'inbox',config.collectorId)));assert.deepEqual(await readdir(join(storage,'journal')),[]);const owner=await reopen();try{assert.equal(owner.journal.records.length,0);}finally{await owner.close();}
});
test('saved exports are deleted only by an explicitly reviewed export scope',async t=>{
 const {storage,reset}=await setup(t);await mkdir(join(storage,'exports'),{mode:0o700});const saved=join(storage,'exports','export-'+randomUUID()+'.json');await writeFile(saved,'reviewed metadata',{mode:0o600});const review=await reset.prepare(true);assert.equal(review.includeExports,true);await reset.commit(review.token);await assert.rejects(access(saved));
});
test('unknown generation contents prevent completion and interrupted reset blocks replay until a reviewed completion',async t=>{
 const {storage,reset,config,reopen}=await setup(t),foreign=join(storage,'inbox',config.collectorId,'keep-user.txt');await writeFile(foreign,'do not delete',{mode:0o600});const review=await reset.prepare();assert.ok(review.preservedUnknownEntries>0);await assert.rejects(reset.commit(review.token),/reset-generation-not-empty/);assert.equal(await readFile(foreign,'utf8'),'do not delete');await assert.rejects(reopen(),/pending-history-reset/);await rm(foreign);const resumed=await reset.prepare();assert.equal(resumed.interrupted,true);await reset.commit(resumed.token);const owner=await reopen();try{assert.equal(owner.journal.records.length,0);}finally{await owner.close();}
});
test('active owners and a replaced fixture marker refuse reset without changing journal contents',async t=>{
 const {root,storage,reset,reopen}=await setup(t),journal=join(storage,'journal','journal-000000.ndjson'),before=await readFile(journal,'utf8'),owner=await reopen();try{await assert.rejects(reset.prepare(),/reset-ownership-unavailable/);assert.equal(await readFile(journal,'utf8'),before);}finally{await owner.close();}
 const review=await reset.prepare();await writeFile(join(root,'.overwatch-probe-fixture'),'foreign fixture');await assert.rejects(reset.commit(review.token),/invalid-reset-scope/);assert.equal(await readFile(journal,'utf8'),before);
});

test('reset scope and review tokens cannot cross workspaces; unrelated active history stays byte-identical', async t => {
 const first = await setup(t), second = await setup(t);
 const otherJournal = join(second.storage, 'journal', 'journal-000000.ndjson');
 const before = await readFile(otherJournal);
 const otherOwner = await second.reopen();
 try {
  await assert.rejects(new HistoryReset(first.root, second.storage).prepare(), /invalid-reset-scope/);
  const review = await first.reset.prepare();
  await assert.rejects(second.reset.commit(review.token), /reset-review-expired/);
  await first.reset.commit(review.token);
  assert.deepEqual(await readFile(otherJournal), before);
  await otherOwner.assertOwner();
 } finally { await otherOwner.close(); }
});

test('symlinked selected artifacts refuse deletion and preserve the unrelated target', async t => {
 const {root, storage, reset} = await setup(t);
 const target = join(root, 'user-data.txt');
 await writeFile(target, 'FAKE_SECRET_USER_FILE', {mode:0o600});
 await symlink(target, join(storage, 'projection-checkpoint.json'));
 await assert.rejects(reset.prepare());
 assert.equal(await readFile(target, 'utf8'), 'FAKE_SECRET_USER_FILE');
 await assert.rejects(access(join(storage, 'collector.lock')));
});
