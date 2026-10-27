import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ConversationIdentities, conversationKey } from '../../src/core/identity';
import { conversationNodes } from '../../src/ui/conversations';
import { normalizeCursorEnvelope } from '../../src/adapters/cursorHooks';
import type { SourceMetadata, SourceEnvelopeV1 } from '../../src/transport/sourceContracts';
import type { EventV1 } from '../../src/core/contracts';

function event(conversationId: string, options: Partial<EventV1> = {}): EventV1 {
  return { schemaVersion: 1, eventId: randomUUID(), collectorId: 'collector', environmentId: 'local', workspaceId: 'root',
    source: 'cursor-hook', sourceEvent: 'beforeReadFile', receivedAt: '2026-10-23T12:00:00.000Z', conversationId,
    generationId: 'generation', actorScope: 'unknown', operationId: randomUUID(), operation: 'read', phase: 'requested', outcome: 'unknown', targets: [],
    evidence: { activity: 'source-reported', attribution: 'unknown', completion: 'not-observed', diskPersistence: 'not-observed', correlation: 'unpaired', limitations: [] }, ...options };
}

test('aliases persist across generations, reordered replay and serialization without model or timing identity', () => {
  const store = new ConversationIdentities();
  const a = event('a'), b = event('b');
  store.observe(a); store.observe(b); store.observe(event('a', { generationId: 'next' }));
  assert.deepEqual(store.snapshot().sessions.map(s => s.alias), ['Session 1', 'Session 2']);
  const restored = new ConversationIdentities(JSON.parse(JSON.stringify(store.aliasState())));
  restored.observe(b); restored.observe(a);
  const aliases = new Map(restored.snapshot().sessions.map(s => [s.sourceId, s.alias]));
  assert.equal(aliases.get('a'), 'Session 1'); assert.equal(aliases.get('b'), 'Session 2');
  const returned = restored.snapshot(); returned.sessions[0]!.alias = 'mutated';
  assert.equal(restored.snapshot().sessions[0]!.alias, 'Session 2');
});

test('collector, environment, root and worktree namespace identical source IDs independently', () => {
  const store = new ConversationIdentities();
  for (const scope of [{}, { collectorId: 'second' }, { environmentId: 'remote' }, { workspaceId: 'second' }, { worktreeId: 'second' }])
    store.observe(event('same', scope));
  assert.equal(store.snapshot().sessions.length, 5);
  assert.equal(new Set(store.snapshot().sessions.map(s => s.key)).size, 5);
  store.observe({ ...event('unused'), conversationId: undefined } as unknown as EventV1);
  assert.equal(store.snapshot().sessions.length, 5);
});

test('captured identical child descriptions render only proven lifecycle edges, leaving file sessions unlinked', async () => {
  const fixture = JSON.parse(await readFile('tests/fixtures/cursor/concurrency.json', 'utf8'));
  const store = new ConversationIdentities();
  for (const p of fixture.events) {
    const m: SourceMetadata = { metadataVersion: 1, eventId: p.eventId, receivedAt: p.receivedAt, sourceEvent: p.hookEvent,
      sourceVersion: p.sourceVersion, tool: p.toolName === 'Read' ? 'read' : p.toolName === 'Task' ? 'task' : 'unknown', workspaceRootHashes: [p.rootKey] };
    for (const [target, key] of [['conversationId', 'conversationKey'], ['generationId', 'generationKey'], ['subagentId', 'subagentKey'], ['parentConversationId', 'parentConversationKey']] as const)
      if (typeof p[key] === 'string') m[target] = p[key];
    if (p.status) m.status = p.status;
    const source: SourceEnvelopeV1 = { transportVersion: 1, eventId: p.eventId, receivedAt: p.receivedAt, collectorId: 'fixture', environmentId: 'local', workspaceId: p.rootKey,
      result: { metadata: m, counters: { unknownFields: 0, sensitiveFields: 0, invalidFields: 0 } } };
    const normalized = normalizeCursorEnvelope(source); assert.ok(normalized); store.observe(normalized.event);
  }
  const snapshot = store.snapshot();
  const parent = snapshot.sessions.find(s => s.sourceId === fixture.childDiscovery.parentConversationKey)!;
  assert.ok(parent); assert.equal(snapshot.children.length, 2);
  assert.ok(snapshot.children.every(c => c.parents.length === 1 && c.parents[0] === parent.key && c.terminalReports[0] === 'completed'));
  const nodes = conversationNodes(store);
  assert.equal(nodes.find(n => n.key === parent.key)?.children.length, 2);
  for (const id of fixture.childDiscovery.childToolConversationKeys) {
    const childFileSession = snapshot.sessions.find(s => s.sourceId === id)!;
    assert.ok(childFileSession); assert.equal(nodes.find(n => n.key === childFileSession.key)?.children.length, 0);
  }
  assert.equal(fixture.topLevelConversationKeys.every((id: string) => snapshot.sessions.some(s => s.sourceId === id)), true);
});

test('unjoinable child stop never attaches to a recent session; conflicting explicit parents stay ambiguous', () => {
  const store = new ConversationIdentities(); const base = event('session');
  store.observe(base);
  store.observe(event('session', { sourceEvent: 'subagentStop', lifecycleScope: 'child', operation: 'lifecycle', phase: 'observed' }));
  assert.equal(store.snapshot().children.length, 0);
  for (const parentActorId of ['parent-a', 'parent-b']) store.observe(event('session', {
    sourceEvent: 'subagentStart', lifecycleScope: 'child', operation: 'lifecycle', phase: 'started', actorScope: 'child', actorId: 'child', parentActorId,
    evidence: { ...base.evidence, attribution: 'child' },
  }));
  assert.equal(store.snapshot().children[0]?.ambiguous, true);
  assert.equal(store.snapshot().children[0]?.parents.length, 2);
  assert.ok(conversationNodes(store).flatMap(n => n.children).every(c => c.description.includes('Ambiguous')));
});

test('invalid alias persistence is rejected instead of merging aliases or scopes', () => {
  const key = conversationKey(event('a'), 'a');
  for (const state of [{}, { version: 2, aliases: [] }, { version: 1, aliases: [{ key, number: 0 }] },
    { version: 1, aliases: [{ key, number: 1 }, { key, number: 2 }] },
    { version: 1, aliases: [{ key, number: 1 }, { key: conversationKey(event('b'), 'b'), number: 1 }] }])
    assert.throws(() => new ConversationIdentities(state), /invalid-alias-state/);
});
