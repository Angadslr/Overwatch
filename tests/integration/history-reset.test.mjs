import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp, realpath, mkdir, writeFile, readFile, readdir, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {build} from 'esbuild';

await build({entryPoints:['src/privacy/historyReset.ts'], outfile:'.local/t23-history-reset.cjs', bundle:true, platform:'node', format:'cjs', target:'node22'});
const require = createRequire(import.meta.url);
const {HistoryReset} = require('../../.local/t23-history-reset.cjs');
const {initializeSpool, SpoolIngester} = require('../../dist/transport.cjs');
const helper = resolve('dist/cursor-supervision-hook');

function startHelper(storage, epoch) {
 const child = spawn(helper, ['beforeReadFile', storage, ...(epoch === undefined ? [] : [epoch])], {stdio:['pipe','pipe','pipe']});
 let stdout = '', stderr = '';
 let responded;
 const response = new Promise(resolveResponse => { responded = resolveResponse; });
 const completed = new Promise((resolveResult, reject) => {
  const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('helper-test-timeout')); }, 5000);
  child.stdout.on('data', bytes => { stdout += bytes; if (stdout.includes('\n')) responded(); });
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.stdin.on('error', () => {});
  child.on('error', error => { clearTimeout(timeout); reject(error); });
  child.on('close', code => { clearTimeout(timeout); resolveResult({code, stdout, stderr}); });
 });
 return {child, response:Promise.race([response, completed.then(() => assert.fail('helper-closed-before-response'))]), completed};
}

test('reviewed reset fences cached and pending compiled helpers and rejects an old envelope after reenable', async t => {
 const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-reset-process-')));
 const storage = join(root, '.local', 'supervision-storage');
 await writeFile(join(root, '.overwatch-probe-fixture'), 'overwatch-invented-fixture-v1\n');
 await writeFile(join(root, 'read.txt'), 'Invented process-test data.\n');
 await mkdir(join(root, '.local'), {mode:0o700});
 await mkdir(storage, {mode:0o700});
 const reset = new HistoryReset(root, storage);
 let owner;
 const children = [];
 t.after(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  await reset.cancel(); await owner?.close(); await rm(root, {recursive:true, force:true});
 });
 const config = await initializeSpool(storage, {collectorId:randomUUID(), environmentId:'local-darwin-arm64', workspaceId:createHash('sha256').update('workspace\0'+root).digest('hex')}, root, false);
 owner = await SpoolIngester.open(storage, config);
 await owner.requireCollectorEpoch(); await owner.setPublisherEnabled(true);
 const oldEpoch = owner.publisherConfig().collectorId;
 const payload = JSON.stringify({hook_event_name:'beforeReadFile',cursor_version:'3.26.16',workspace_roots:[root],conversation_id:'synthetic-reset',file_path:join(root,'read.txt'),prompt:'FAKE_SECRET_PENDING_PAYLOAD'});
 const expected = {code:0,stdout:'{"permission":"allow"}\n',stderr:''};
 async function invoke(epoch) {
  const launched = startHelper(storage, epoch); children.push(launched.child);
  launched.child.stdin.end(payload);
  assert.deepEqual(await launched.completed, expected);
 }
 await invoke(oldEpoch);
 const oldInbox = join(storage,'inbox',oldEpoch), name = (await readdir(oldInbox))[0];
 const staleEnvelope = await readFile(join(oldInbox,name));
 await owner.scan(); assert.equal(owner.journal.records.length,1);
 await owner.setPublisherEnabled(false); await owner.close(); owner = undefined;
 const pending = startHelper(storage, oldEpoch); children.push(pending.child);
 await pending.response;
 pending.child.stdin.write(payload.slice(0,20));
 const review = await reset.prepare();
 const result = await reset.commit(review.token);
 pending.child.stdin.end(payload.slice(20));
 assert.deepEqual(await pending.completed, expected);
 await assert.rejects(access(oldInbox));
 const next = JSON.parse(await readFile(join(storage,'publisher.json'),'utf8'));
 assert.equal(next.collectorId,result.newEpoch); assert.equal(next.enabled,false);
 const fresh = await initializeSpool(storage,next,root,false);
 owner = await SpoolIngester.open(storage,fresh); await owner.setPublisherEnabled(true);
 await invoke(oldEpoch); await invoke(undefined);
 assert.deepEqual(await readdir(join(storage,'inbox',next.collectorId)),[]);
 await writeFile(join(storage,'inbox',next.collectorId,name),staleEnvelope,{mode:0o600});
 await owner.scan(); assert.equal(owner.counters.scopeRejected,1); assert.equal(owner.journal.records.length,0);
 await invoke(next.collectorId); await owner.scan(); assert.equal(owner.journal.records.length,1);
 assert.equal(JSON.stringify(owner.journal.records).includes('FAKE_SECRET'),false);
 await owner.setPublisherEnabled(false);
});
