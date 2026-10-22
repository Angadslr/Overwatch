import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PROBE_HOOKS } from '../../src/integration/probe';

type Event = { eventId: string; receivedAt: string; hookEvent: string; toolName: string; conversationKey?: string; generationKey?: string; callKey?: string; rootKey?: string; target?: string; status?: string; failure?: string; subagentKey?: string; parentConversationKey?: string; toolCallKey?: string; [key: string]: unknown };
async function fixture(name: string) {
  return JSON.parse(await readFile(`tests/fixtures/cursor/${name}.json`, 'utf8'));
}
const keys = new Set(['probeSchemaVersion', 'eventId', 'source', 'receivedAt', 'hookEvent', 'declaredEventMatches', 'sourceVersion', 'rootKey', 'conversationKey', 'generationKey', 'callKey', 'sessionKey', 'toolCallKey', 'parentConversationKey', 'subagentKey', 'agentKey', 'parentKey', 'toolName', 'target', 'status', 'failure', 'durationMs', 'fieldTypes', 'inputFieldTypes', 'workingDirectoryMatchesRoot', 'evidence']);

test('T02/T03 native evidence validates the projected shape and excludes raw source data', async () => {
  const names = ['operations', 'failures', 'concurrency', 'worktrees', 'windows', 'lifecycle'];
  for (const name of names) {
    const capture = await fixture(name);
    assert.equal(capture.host.cursorVersion, '3.26.16');
    for (const event of capture.events as Event[]) {
      assert.equal(event.probeSchemaVersion, 1);
      assert.match(event.eventId, /^[a-f0-9-]{36}$/);
      assert.ok(Number.isFinite(Date.parse(event.receivedAt)));
      assert.ok((PROBE_HOOKS as readonly string[]).includes(event.hookEvent));
      assert.equal(event.declaredEventMatches, true);
      assert.equal(event.workingDirectoryMatchesRoot, true);
      assert.equal(event.sourceVersion, '3.26.16');
      for (const [key, value] of Object.entries(event)) {
        assert.ok(keys.has(key), `Unexpected persisted field: ${key}`);
        if (key.endsWith('Key')) assert.match(String(value), /^[a-f0-9]{64}$/);
        if (key.endsWith('FieldTypes') || key === 'fieldTypes') {
          for (const type of Object.values(value as object)) assert.ok(['string', 'number', 'boolean', 'object', 'array', 'null'].includes(String(type)));
        }
      }
      if (event.target) assert.match(event.target, /^(read|edit|shared|missing|created|renamed)\.txt$/);
      assert.equal(JSON.stringify(event).includes('/Users/'), false);
    }
  }
});

test('T02 native failures distinguish denial, abort ordering, and missing telemetry', async () => {
  const capture = await fixture('failures');
  const events = capture.events as Event[];
  assert.ok(events.some(e => e.target === 'missing.txt' && e.failure === 'error'));
  assert.ok(events.some(e => e.toolName === 'Shell' && e.failure === 'permission_denied'));
  const aborted = events.filter(e => e.generationKey === capture.abortedGeneration);
  const stop = aborted.find(e => e.status === 'aborted');
  const failure = aborted.find(e => e.hookEvent === 'postToolUseFailure');
  assert.ok(stop && failure && stop.receivedAt < failure.receivedAt);
  const missing = events.filter(e => e.generationKey === capture.missingCompletion.generationKey && e.toolName === 'Shell');
  assert.ok(missing.some(e => e.hookEvent === 'preToolUse'));
  assert.equal(missing.some(e => ['postToolUse', 'postToolUseFailure'].includes(e.hookEvent)), false);
  assert.ok(events.some(e => e.hookEvent === 'afterShellExecution' && e.generationKey === capture.abortedGeneration));
});

test('T03 simultaneous identities stay separate and child tool joins remain unavailable', async () => {
  const capture = await fixture('concurrency');
  const events = capture.events as Event[];
  const conversations = capture.topLevelConversationKeys as string[];
  assert.equal(new Set(conversations).size, 2);
  const intervals = conversations.map(key => {
    const scoped = events.filter(e => e.conversationKey === key && e.toolName === 'Shell');
    return { start: scoped.find(e => e.hookEvent === 'preToolUse')!, end: scoped.find(e => e.hookEvent === 'postToolUse')! };
  });
  assert.ok(intervals.every(i => i.start && i.end));
  assert.ok(intervals[0]!.start.receivedAt < intervals[1]!.end.receivedAt && intervals[1]!.start.receivedAt < intervals[0]!.end.receivedAt);
  const starts = events.filter(e => e.hookEvent === 'subagentStart');
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0]!.subagentKey, starts[1]!.subagentKey);
  for (const start of starts) {
    assert.equal(start.parentConversationKey, capture.childDiscovery.parentConversationKey);
    assert.equal(start.toolCallKey, start.subagentKey);
    assert.ok(events.some(e => e.hookEvent === 'preToolUse' && e.toolName === 'Task' && e.callKey === start.toolCallKey));
  }
  const childKeys = capture.childDiscovery.childToolConversationKeys as string[];
  assert.equal(childKeys.length, 2);
  for (const child of childKeys) {
    assert.ok(!starts.some(e => e.subagentKey === child));
    assert.ok(events.filter(e => e.conversationKey === child).every(e => e.parentConversationKey === undefined && e.subagentKey === undefined));
  }
});

test('T03 native worktrees and duplicate-window evidence enforce physical scope', async () => {
  const trees = await fixture('worktrees');
  assert.notEqual(trees.worktrees[0].rootKey, trees.worktrees[1].rootKey);
  assert.notEqual(trees.worktrees[0].diskHash, trees.worktrees[1].diskHash);
  for (const tree of trees.worktrees) {
    assert.ok(trees.events.some((e: Event) => e.rootKey === tree.rootKey && e.target === 'shared.txt' && e.toolName === 'Write' && e.hookEvent === 'postToolUse'));
    assert.equal(tree.hooksRemoved, true);
    assert.equal(tree.markerRemoved, true);
  }
  const windows = await fixture('windows');
  assert.equal(windows.ownerCleanupReport.projectHookCleanup, 'removed');
  assert.equal(windows.originalConfig.hookCount, PROBE_HOOKS.length);
  assert.ok(Object.values(windows.originalConfig.entriesPerHook).every(count => count === 1));
  assert.equal(windows.secondaryReport.projectHookRegistration, 'creation-failed-existing-config-preserved');
  assert.equal(windows.observations.secondaryReadCycles, 1);
  assert.equal(new Set(windows.events.map((e: Event) => e.rootKey)).size, 1);
});

test('T02 timing proves a dirty-buffer interval without proving acceptance from hooks', async () => {
  const timing = await fixture('timing');
  assert.ok(timing.observations.some((e: { dirty: boolean; bufferMatchesDisk: boolean }) => e.dirty && !e.bufferMatchesDisk));
  assert.ok(timing.observations.some((e: { kind: string; bufferMatchesDisk: boolean }) => e.kind === 'save' && e.bufferMatchesDisk));
  for (const sample of timing.observations) {
    assert.match(sample.bufferHash, /^[a-f0-9]{64}$/);
    assert.match(sample.diskHash, /^[a-f0-9]{64}$/);
    assert.equal(sample.bufferMatchesDisk, sample.bufferHash === sample.diskHash);
  }
});
