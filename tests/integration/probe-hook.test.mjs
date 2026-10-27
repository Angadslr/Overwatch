import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const helper = resolve('dist/probe-hook.cjs');
const events = ['sessionStart', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'beforeReadFile', 'afterFileEdit', 'beforeShellExecution', 'afterShellExecution', 'beforeMCPExecution', 'afterMCPExecution', 'subagentStart', 'subagentStop', 'stop', 'sessionEnd'];
const permissionEvents = ['preToolUse', 'beforeReadFile', 'beforeShellExecution', 'beforeMCPExecution', 'subagentStart'];

async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-hook-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storage = join(root, 'storage with spaces');
  await mkdir(join(storage, 'inbox'), { recursive: true });
  await writeFile(join(storage, 'collection.enabled'), 'overwatch-probe-enabled-v1');
  await writeFile(join(root, 'read.txt'), 'invented');
  return { root, storage };
}

function invoke({ storage, root }, event, input, executable = helper) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [executable, storage, root, event], { stdio: ['pipe', 'pipe', 'pipe'], cwd: root });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('helper-exceeded-test-deadline')); }, 5000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timeout); resolveResult({ code, stdout, stderr }); });
    child.stdin.end(typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input));
  });
}

test('every configured event responds once, including malformed JSON and absent storage', async t => {
  const fixture = await setup(t);
  for (const event of events) {
    for (const input of ['{broken', '[]', JSON.stringify({ workspace_roots: [fixture.root], hook_event_name: event })]) {
      const result = await invoke({ ...fixture, storage: join(fixture.root, 'absent-storage') }, event, input);
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, JSON.stringify(permissionEvents.includes(event) ? { permission: 'allow' } : {}) + '\n');
    }
  }
  assert.deepEqual(await readdir(join(fixture.storage, 'inbox')), []);
});

test('retired discovery launcher responds concurrently without persisting paths or content', async t => {
  const fixture = await setup(t);
  const input = { workspace_roots: [fixture.root], hook_event_name: 'beforeReadFile', file_path: join(fixture.root, 'read.txt'), content: 'FORBIDDEN_FILE_CONTENT' };
  const results = await Promise.all(Array.from({ length: 16 }, () => invoke(fixture, 'beforeReadFile', input)));
  assert.ok(results.every(result => result.code === 0 && result.stdout === '{"permission":"allow"}\n' && result.stderr === ''));
  assert.deepEqual(await readdir(join(fixture.storage, 'inbox')), []);
});

test('oversized inputs and full inbox preserve response without publishing', async t => {
  const fixture = await setup(t);
  const oversized = Buffer.alloc(32 * 1024 * 1024 + 1, 32);
  const result = await invoke(fixture, 'preToolUse', oversized);
  assert.deepEqual(result, { code: 0, stdout: '{"permission":"allow"}\n', stderr: '' });
  assert.deepEqual(await readdir(join(fixture.storage, 'inbox')), []);
  await Promise.all(Array.from({ length: 500 }, (_, index) => writeFile(join(fixture.storage, 'inbox', `${index}.json`), '{}')));
  const full = await invoke(fixture, 'afterFileEdit', { workspace_roots: [fixture.root], file_path: join(fixture.root, 'edit.txt') });
  assert.deepEqual(full, { code: 0, stdout: '{}\n', stderr: '' });
  assert.equal((await readdir(join(fixture.storage, 'inbox'))).length, 500);
});

test('unrelated workspaces and symlinked inboxes receive no telemetry', async t => {
  const fixture = await setup(t);
  await invoke(fixture, 'beforeReadFile', { workspace_roots: ['/unrelated'], file_path: join(fixture.root, 'read.txt') });
  assert.deepEqual(await readdir(join(fixture.storage, 'inbox')), []);
  await rm(join(fixture.storage, 'inbox'), { recursive: true });
  const external = join(fixture.root, 'external');
  await mkdir(external);
  await symlink(external, join(fixture.storage, 'inbox'));
  assert.equal((await invoke(fixture, 'beforeReadFile', { workspace_roots: [fixture.root] })).stdout, '{"permission":"allow"}\n');
  assert.deepEqual(await readdir(external), []);
});

test('cached hook commands cannot persist telemetry after collection is disabled', async t => {
  const fixture = await setup(t);
  await rm(join(fixture.storage, 'collection.enabled'));
  const result = await invoke(fixture, 'sessionStart', { workspace_roots: [fixture.root], conversation_id: 'disabled-fixture' });
  assert.deepEqual(result, { code: 0, stdout: '{}\n', stderr: '' });
  assert.deepEqual(await readdir(join(fixture.storage, 'inbox')), []);
});
