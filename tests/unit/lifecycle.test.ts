import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { EventV1 } from '../../src/core/contracts';
import { LifecycleStore } from '../../src/core/lifecycle';
import { FileActivityStore } from '../../src/core/reducers';
import { ConversationIdentities } from '../../src/core/identity';
import { conversationNodes } from '../../src/ui/conversations';
import { normalizeJournalRecord } from '../../src/adapters/cursorHooks';

const epoch = Date.parse('2026-10-24T12:00:00.000Z');
function fact(options: Partial<EventV1> = {}): EventV1 {
  const event = { schemaVersion: 1, eventId: randomUUID(), collectorId: 'collector', environmentId: 'local', workspaceId: 'root',
    source: 'cursor-hook', sourceEvent: 'beforeReadFile', receivedAt: new Date(epoch).toISOString(), conversationId: 'session', generationId: 'turn-1',
    sourceCallId: 'call', actorScope: 'unknown', operationId: randomUUID(), operation: 'read', phase: 'requested', outcome: 'unknown', targets: [],
    evidence: { activity: 'source-reported', attribution: 'unknown', completion: 'not-observed', diskPersistence: 'not-observed', correlation: 'source-call-id', limitations: [] }, ...options } as EventV1;
  if (['completed', 'failed', 'cancelled'].includes(event.phase)) event.evidence = { ...event.evidence, completion: 'source-reported' };
  if (!event.generationId || !event.conversationId) event.evidence = { ...event.evidence, correlation: 'ambiguous' };
  return event;
}
const stop = (options: Partial<EventV1> = {}) => fact({ sourceEvent: 'stop', operation: 'lifecycle', lifecycleScope: 'generation', phase: 'completed', outcome: 'success', ...options });

test('shared view summaries invalidate at exact uncertainty boundaries while public snapshots remain detached', () => {
  let now = epoch;const files = new FileActivityStore(() => now), event = fact();files.apply({event});
  const first = files.viewSnapshot();assert.equal(files.viewSnapshot(), first);assert.ok(Object.isFrozen(first.operations[0]));
  const publicCopy = files.snapshot();publicCopy.operations[0]!.eventIds.push('not-source');assert.equal(files.viewSnapshot().operations[0]!.eventIds.length, 1);
  now += 29999;assert.equal(files.viewSnapshot(), first);now++;
  assert.notEqual(files.viewSnapshot(), first);assert.equal(files.viewSnapshot().operations[0]!.liveState, 'completion-not-observed');
  now = epoch;assert.equal(files.viewSnapshot().operations[0]!.liveState, 'recent-request');
  files.markLiveStateUnknown();assert.equal(files.viewSnapshot().operations[0]!.liveState, 'unknown-after-reload');
  files.clear();assert.deepEqual(files.viewSnapshot().operations, []);
});

test('turn completion preserves its conversation and does not complete a pending operation', () => {
  let now = epoch; const life = new LifecycleStore(), files = new FileActivityStore(() => now);
  life.apply(fact({ sourceEvent: 'sessionStart', lifecycleScope: 'conversation', operation: 'lifecycle', phase: 'started' }));
  const start = fact(); life.apply(start); files.apply({ event: start }); life.apply(stop());
  assert.equal(life.snapshot().conversations[0]?.state, 'open'); assert.equal(life.snapshot().conversations[0]?.available, true);
  assert.equal(life.snapshot().turns[0]?.state, 'complete'); assert.equal(files.snapshot().operations[0]?.state, 'requested');
  now += 30000; assert.equal(files.snapshot().operations[0]?.liveState, 'completion-not-observed');
  assert.equal(files.snapshot().operations[0]?.outcome, 'unknown');
});

test('new generations reuse a call ID without reopening earlier completed operations', () => {
  const life = new LifecycleStore(), files = new FileActivityStore(() => epoch);
  for (const event of [fact(), fact({ sourceEvent: 'postToolUse', phase: 'completed', outcome: 'success' }), stop(), fact({ generationId: 'turn-2' })]) {
    life.apply(event); files.apply({ event });
  }
  assert.deepEqual(life.snapshot().turns.map(t => t.state), ['complete', 'activity-observed']);
  assert.deepEqual(files.snapshot().operations.map(o => o.state), ['completed', 'requested']);
  life.apply(stop({ generationId: 'turn-2', phase: 'cancelled', outcome: 'aborted' }));
  assert.deepEqual(life.snapshot().turns.map(t => t.state), ['complete', 'aborted']);
});

test('late activity and duplicate generation terminals do not regress terminal evidence; conflicting reports stay ambiguous', () => {
  const life = new LifecycleStore(); const terminal = stop(); life.apply(terminal);
  assert.equal(life.snapshot().turns[0]?.missingStart, true); assert.equal(life.apply(terminal), false);
  life.apply(stop()); life.apply(fact());
  assert.equal(life.snapshot().turns[0]?.state, 'complete'); assert.equal(life.snapshot().turns[0]?.missingStart, false);
  life.apply(fact({ sourceCallId: 'new-call' })); // Same generation cannot be reopened by arrival order.
  assert.equal(life.snapshot().turns[0]?.state, 'complete');
  life.apply(stop({ phase: 'failed', outcome: 'error' })); assert.equal(life.snapshot().turns[0]?.state, 'ambiguous');
  assert.equal(life.snapshot().turns[0]?.terminalReports.length, 2);
});

test('completion-before-start repairs missing start; event duplicates are idempotent and distinct repeated terminals remain ambiguous', () => {
  const files = new FileActivityStore(() => epoch); const terminal = fact({ sourceEvent: 'postToolUse', phase: 'completed', outcome: 'success' });
  files.apply({ event: terminal }); assert.equal(files.snapshot().operations[0]?.missingStart, true);
  assert.equal(files.apply({ event: terminal }), false);
  files.apply({ event: fact() }); assert.equal(files.snapshot().operations[0]?.missingStart, false);
  assert.equal(files.snapshot().operations[0]?.liveState, 'terminal');
  files.apply({ event: fact({ sourceEvent: 'postToolUse', phase: 'completed', outcome: 'success' }) });
  assert.equal(files.snapshot().operations[0]?.state, 'ambiguous'); assert.equal(files.snapshot().operations[0]?.hasTerminal, true);
});

test('fake-clock aging changes presentation at exactly 30 seconds without changing source facts or manufacturing success', () => {
  let now = epoch; const files = new FileActivityStore(() => now); const start = fact(); const before = JSON.stringify(start);
  files.apply({ event: start }); now += 29999; assert.equal(files.snapshot().operations[0]?.liveState, 'recent-request');
  now++; assert.equal(files.snapshot().operations[0]?.liveState, 'completion-not-observed');
  now += 86400000; const operation = files.snapshot().operations[0]!;
  assert.equal(operation.state, 'requested'); assert.equal(operation.outcome, 'unknown'); assert.equal(operation.hasTerminal, false);
  assert.equal(JSON.stringify(start), before);
  files.apply({ event: fact({ sourceEvent: 'postToolUseFailure', phase: 'failed', outcome: 'denied' }) });
  assert.equal(files.snapshot().operations[0]?.liveState, 'terminal'); assert.equal(files.snapshot().operations[0]?.outcome, 'denied');
});

test('replayed open operations stay live-unknown; a matching terminal resolves them and unrelated fresh turns do not', () => {
  const files = new FileActivityStore(() => epoch + 1000), life = new LifecycleStore(); const old = fact();
  files.apply({ event: old }, 'replay'); life.apply(old, 'replay');
  files.apply({ event: fact({ generationId: 'turn-2' }) }); life.apply(fact({ generationId: 'turn-2' }));
  assert.equal(files.snapshot().operations[0]?.liveState, 'unknown-after-reload');
  assert.deepEqual(life.snapshot().turns.map(t => t.state), ['unknown', 'activity-observed']);
  const terminal = fact({ sourceEvent: 'postToolUse', phase: 'completed', outcome: 'success' });
  files.apply({ event: terminal }); life.apply(stop());
  assert.equal(files.snapshot().operations[0]?.state, 'completed'); assert.equal(life.snapshot().turns[0]?.state, 'complete');
  files.markLiveStateUnknown(); life.markLiveStateUnknown();
  assert.equal(files.snapshot().operations[0]?.liveState, 'terminal'); assert.equal(files.snapshot().operations[1]?.liveState, 'unknown-after-reload');
  assert.equal(life.snapshot().turns[0]?.state, 'complete'); assert.equal(life.snapshot().turns[1]?.state, 'unknown');
});

test('reenabling an existing store marks duplicate replayed requests unknown rather than reviving recent activity', () => {
  const files = new FileActivityStore(() => epoch); const start = fact(); files.apply({ event: start });
  files.markLiveStateUnknown(); assert.equal(files.apply({ event: start }, 'replay'), false);
  assert.equal(files.snapshot().operations[0]?.liveState, 'unknown-after-reload');
});

test('missing generation and child stops never terminate a guessed turn; scopes remain independent', () => {
  const life = new LifecycleStore(); life.apply(fact());
  const unscoped = fact(); delete unscoped.generationId; unscoped.evidence.correlation = 'ambiguous'; life.apply(unscoped);
  const missingStop = stop(); delete missingStop.generationId; missingStop.evidence.correlation = 'ambiguous'; life.apply(missingStop);
  life.apply(fact({ sourceEvent: 'subagentStop', lifecycleScope: 'child', operation: 'lifecycle', phase: 'completed', outcome: 'success' }));
  assert.equal(life.snapshot().turns[0]?.state, 'activity-observed'); assert.equal(life.snapshot().conversations[0]?.unscopedActivity, true);
  for (const scope of [{ conversationId: 'other' }, { collectorId: 'other' }, { environmentId: 'other' }, { workspaceId: 'other' }, { worktreeId: 'other' }]) life.apply(stop(scope));
  assert.equal(life.snapshot().turns.length, 6); assert.equal(life.snapshot().turns[0]?.state, 'activity-observed');
});

test('shell and MCP observations never become terminal success merely because an after hook exists', () => {
  for (const operation of ['shell', 'mcp'] as const) {
    const files = new FileActivityStore(() => epoch + 30000);
    files.apply({ event: fact({ operation, sourceEvent: operation === 'shell' ? 'beforeShellExecution' : 'beforeMCPExecution' }) });
    files.apply({ event: fact({ operation, sourceEvent: operation === 'shell' ? 'afterShellExecution' : 'afterMCPExecution', phase: 'observed' }) });
    assert.equal(files.snapshot().operations[0]?.liveState, 'completion-not-observed'); assert.equal(files.snapshot().operations[0]?.outcome, 'unknown');
    assert.equal(files.snapshot().files.length, 0);
  }
});

test('captured native journey replays a completed turn without asserting current live state or changing identity', async () => {
  const fixture = JSON.parse(await readFile('tests/fixtures/cursor/t08-journey.json', 'utf8'));
  const life = new LifecycleStore(), identities = new ConversationIdentities();
  for (const record of fixture.sourceJournal) { const o = normalizeJournalRecord(record); assert.ok(o); life.apply(o.event, 'replay'); identities.observe(o.event); }
  const snapshot = life.snapshot(); assert.equal(snapshot.turns.length, 1); assert.equal(snapshot.turns[0]?.state, 'complete');
  assert.equal(snapshot.conversations[0]?.state, 'unknown'); assert.equal(snapshot.conversations[0]?.available, true);
  const nodes = conversationNodes(identities, snapshot); assert.ok(nodes[0]?.tooltip.includes(': complete'));
  assert.ok(nodes[0]?.description.includes('unknown after reload'));
});

test('an aborted turn preceding tool failure stays aborted without prematurely terminating its operation', () => {
  const life = new LifecycleStore(), files = new FileActivityStore(() => epoch); const start = fact();
  life.apply(start); files.apply({ event: start }); life.apply(stop({ phase: 'cancelled', outcome: 'aborted' }));
  assert.equal(files.snapshot().operations[0]?.hasTerminal, false);
  const failure = fact({ sourceEvent: 'postToolUseFailure', phase: 'failed', outcome: 'error' });
  life.apply(failure); files.apply({ event: failure });
  assert.equal(life.snapshot().turns[0]?.state, 'aborted'); assert.equal(files.snapshot().operations[0]?.state, 'failed');
});

test('explicit conversation end is sticky under late starts, while clock rollback cannot create a terminal outcome', () => {
  const life = new LifecycleStore();
  life.apply(fact({ sourceEvent: 'sessionEnd', lifecycleScope: 'conversation', operation: 'lifecycle', phase: 'completed', outcome: 'success' }));
  life.apply(fact({ sourceEvent: 'sessionStart', lifecycleScope: 'conversation', operation: 'lifecycle', phase: 'started' }));
  assert.equal(life.snapshot().conversations[0]?.state, 'closed');
  const files = new FileActivityStore(() => epoch - 60000); files.apply({ event: fact() });
  assert.equal(files.snapshot().operations[0]?.liveState, 'recent-request'); assert.equal(files.snapshot().operations[0]?.outcome, 'unknown');
});

test('an explicit operation start survives a late request and yields only to matching terminal evidence', () => {
  const files = new FileActivityStore(() => epoch);
  files.apply({ event: fact({ sourceEvent: 'preToolUse', phase: 'started' }) });
  assert.equal(files.snapshot().operations[0]?.state, 'started');
  files.apply({ event: fact() }); assert.equal(files.snapshot().operations[0]?.state, 'started');
  files.apply({ event: fact({ sourceEvent: 'postToolUse', phase: 'completed', outcome: 'success' }) });
  assert.equal(files.snapshot().operations[0]?.state, 'completed');
});
