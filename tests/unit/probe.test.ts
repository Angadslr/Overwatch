import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPluginApi, probeEligibility } from '../../src/host/capabilities';
import { quotePosix, buildHookConfig, NativeProbe, ProjectHookProbe, FIXTURE_MARKER, PROBE_HOOKS, PERMISSION_HOOKS } from '../../src/integration/probe';
import { projectProbe, observationResponse } from '../../src/integration/probeHook';
import { createTimingRecorder } from '../../src/integration/probeTiming';

test('feature detection requires both functions and preserves their receiver', () => {
  assert.equal(getPluginApi({ cursor: { plugins: { registerPath() {} } } }), undefined);
  const calls: string[] = [];
  const plugin = { name: 'correct', registerPath(this: { name: string }, path: string) { calls.push(this.name + path); }, unregisterPath() {} };
  getPluginApi({ cursor: { plugins: plugin } })?.registerPath('-path');
  assert.deepEqual(calls, ['correct-path']);
});

test('unsupported and untrusted environments cannot install hooks', () => {
  const supported = { trusted: true, remote: false, platform: 'darwin', arch: 'arm64', fixture: true, pluginApi: true };
  assert.equal(probeEligibility(supported), undefined);
  for (const override of [{ trusted: false }, { remote: true }, { fixture: false }, { pluginApi: false }, { platform: 'win32' }, { arch: 'x64' }]) {
    assert.equal(typeof probeEligibility({ ...supported, ...override }), 'string');
  }
});

test('launcher quoting handles spaces, apostrophes and shell syntax as literal data', () => {
  assert.equal(quotePosix("/tmp/Angad's $(touch ignored)"), "'/tmp/Angad'\\''s $(touch ignored)'");
  assert.throws(() => quotePosix('/tmp/new\nline'));
  assert.throws(() => buildHookConfig('node', '/helper', '/storage', '/root'));
  assert.deepEqual(Object.keys(buildHookConfig('/node', '/helper', '/storage', '/root').hooks), [...PROBE_HOOKS]);
  for (const hook of PROBE_HOOKS) assert.deepEqual(observationResponse(hook), (PERMISSION_HOOKS as readonly string[]).includes(hook) ? { permission: 'allow' } : {});
});

test('probe registration is idempotent and unregisters precisely its own path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'overwatch-unit-'));
  try {
    const fixture = join(root, 'fixture');
    await mkdir(fixture);
    const calls: string[] = [];
    const probe = new NativeProbe({ registerPath: path => calls.push(`add:${path}`), unregisterPath: path => calls.push(`remove:${path}`) });
    await assert.rejects(probe.enable(join(root, 'storage'), fixture, '/node', '/helper'));
    await writeFile(join(fixture, '.overwatch-probe-fixture'), FIXTURE_MARKER);
    const source = await probe.enable(join(root, 'storage'), fixture, '/node', '/helper');
    await probe.enable(join(root, 'storage'), fixture, '/node', '/helper');
    assert.equal(probe.disable(), true);
    assert.equal(probe.disable(), false);
    assert.deepEqual(calls, [`add:${source}`, `remove:${source}`]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('projection preserves safe evidence while dropping invented secrets and external targets', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-projection-')));
  try {
    await writeFile(join(root, 'read.txt'), 'invented');
    const input = { workspace_roots: [root], hook_event_name: 'beforeReadFile', conversation_id: 'conversation-a', generation_id: 'generation-a', tool_use_id: 'call-a', file_path: join(root, 'read.txt'), content: 'FORBIDDEN_CONTENT', user_email: 'FORBIDDEN_EMAIL', transcript_path: 'FORBIDDEN_TRANSCRIPT', tool_input: { command: 'FORBIDDEN_COMMAND' }, unknown: 'FORBIDDEN_UNKNOWN' };
    const projected = projectProbe(input, 'beforeReadFile', root);
    assert.equal(projected?.target, 'read.txt');
    assert.equal(projected?.conversationKey?.length, 64);
    assert.equal(JSON.stringify(projected).includes('FORBIDDEN'), false);
    assert.equal(JSON.stringify(projected).includes(root), false);
    assert.equal(projectProbe({ ...input, workspace_roots: ['/unrelated'] }, 'beforeReadFile', root), undefined);
    assert.equal(projectProbe({ ...input, file_path: '../read.txt' }, 'beforeReadFile', root)?.target, undefined);
    await symlink('/etc/hosts', join(root, 'shared.txt'));
    assert.equal(projectProbe({ ...input, file_path: join(root, 'shared.txt') }, 'beforeReadFile', root)?.target, undefined);
    assert.equal(projectProbe({ ...input, file_path: join(root, '.env') }, 'beforeReadFile', root)?.target, undefined);
    assert.throws(() => projectProbe([], 'beforeReadFile', root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fixture fallback preserves existing and subsequently modified hook files', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-fallback-')));
  try {
    await writeFile(join(root, '.overwatch-probe-fixture'), FIXTURE_MARKER);
    const storage = join(root, 'storage');
    const config = join(root, '.cursor', 'hooks.json');
    const probe = new ProjectHookProbe();
    await probe.enable(storage, root, '/node', '/helper');
    const original = await readFile(config, 'utf8');
    const other = new ProjectHookProbe();
    await assert.rejects(other.enable(storage, root, '/other-node', '/other-helper'));
    assert.equal(await readFile(config, 'utf8'), original);
    await writeFile(config, original + '\n');
    assert.equal(await probe.disable(), 'modified-preserved');
    assert.equal(await readFile(config, 'utf8'), original + '\n');
    await writeFile(config, original);
    assert.equal(await probe.disable(), 'removed');
    await assert.rejects(readFile(config));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fixture fallback rejects a symlinked configuration directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-symlink-')));
  try {
    await writeFile(join(root, '.overwatch-probe-fixture'), FIXTURE_MARKER);
    const other = join(root, 'other-directory');
    await mkdir(other);
    await symlink(other, join(root, '.cursor'));
    await assert.rejects(new ProjectHookProbe().enable(join(root, 'storage'), root, '/node', '/helper'));
    await assert.rejects(readFile(join(other, 'hooks.json')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('captured native fixtures retain failed-read and call-ID-reuse evidence', async () => {
  const first = JSON.parse(await readFile('tests/fixtures/cursor/probe.json', 'utf8'));
  const replay = JSON.parse(await readFile('tests/fixtures/cursor/reload.json', 'utf8'));
  const all = [...first.events, ...replay.events] as Array<{ hookEvent: string; toolName: string; callKey?: string; conversationKey?: string; target?: string; failure?: string }>;
  assert.equal(first.events.length, 10);
  assert.equal(replay.events.length, 16);
  assert.equal(new Set(all.map(event => event.conversationKey)).size, 2);
  assert.ok(all.some(event => event.hookEvent === 'postToolUseFailure' && event.target === 'missing.txt' && event.failure === 'error'));
  const write = first.events.find((event: typeof all[number]) => event.hookEvent === 'preToolUse' && event.toolName === 'Write');
  assert.ok(write?.callKey);
  assert.ok(first.events.some((event: typeof all[number]) => event.hookEvent === 'preToolUse' && event.toolName === 'Read' && event.callKey === write.callKey));
  assert.ok(all.filter(event => event.hookEvent === 'afterFileEdit').every(event => event.callKey === undefined));
  const serialized = JSON.stringify({ first, replay });
  for (const field of ['user_email', 'transcript_path', 'tool_output', 'reasoning', 'content']) assert.equal(serialized.includes(`"${field}":`), false);
});

test('physical worktree roots separate identical source IDs and child keys stay explicit', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-roots-')));
  try {
    const roots = [join(directory, 'a'), join(directory, 'b')];
    await Promise.all(roots.map(root => mkdir(root)));
    const events = roots.map(root => projectProbe({ workspace_roots: [root], conversation_id: 'same-source', subagent_id: 'child', parent_conversation_id: 'parent', tool_call_id: 'spawn', tool_input: { prompt: 'FORBIDDEN_PROMPT', file_path: 'read.txt' } }, 'subagentStart', root));
    assert.notEqual(events[0]?.rootKey, events[1]?.rootKey);
    assert.equal(events[0]?.conversationKey, events[1]?.conversationKey);
    assert.equal(events[0]?.subagentKey?.length, 64);
    assert.equal(events[0]?.toolCallKey?.length, 64);
    assert.equal(events[0]?.inputFieldTypes?.prompt, 'string');
    assert.equal(JSON.stringify(events).includes('FORBIDDEN'), false);
    assert.equal(JSON.stringify(events).includes(directory), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('fixture timing separates dirty buffer bytes from disk without retaining contents', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-timing-')));
  try {
    const storage = join(root, 'storage');
    await mkdir(storage);
    await writeFile(join(storage, 'collection.enabled'), 'overwatch-probe-enabled-v1');
    await writeFile(join(root, 'edit.txt'), 'FORBIDDEN_DISK');
    const record = createTimingRecorder(storage, root);
    const document = { uri: { fsPath: join(root, 'edit.txt'), scheme: 'file' }, isDirty: true, version: 2, getText: () => 'FORBIDDEN_BUFFER' };
    record('change', document);
    const bytes = await readFile(join(storage, 'timing.jsonl'), 'utf8');
    const event = JSON.parse(bytes);
    assert.equal(event.dirty, true);
    assert.equal(event.bufferMatchesDisk, false);
    assert.notEqual(event.bufferHash, event.diskHash);
    assert.equal(bytes.includes('FORBIDDEN'), false);
    assert.equal(bytes.includes(root), false);
    record('change', { ...document, uri: { ...document.uri, fsPath: join(root, '.env') } });
    await rm(join(storage, 'collection.enabled'));
    record('save', document);
    assert.equal(await readFile(join(storage, 'timing.jsonl'), 'utf8'), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});
