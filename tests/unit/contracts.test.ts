import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEvent, projectEventCandidate } from '../../src/core/eventValidation';
import { MAX_EVENT_BYTES, type EventV1 } from '../../src/core/contracts';
import exampleJson from '../fixtures/core/event-v1.json';

const example = exampleJson as EventV1;
const copy = (): EventV1 => structuredClone(example);
const accepts = (value: unknown): boolean => parseEvent(JSON.stringify(value)).ok;

test('complete event-v1 example is valid, typed and preserves independent evidence', () => {
  const result = parseEvent(JSON.stringify(example));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Example rejected');
  const event: EventV1 = result.event;
  assert.equal(event.phase, 'requested');
  assert.equal(event.evidence.completion, 'not-observed');
  assert.equal(event.evidence.diskPersistence, 'not-observed');
  const terminal = copy();
  terminal.phase = 'completed'; terminal.outcome = 'success';
  terminal.evidence.completion = 'source-reported';
  assert.equal(accepts(terminal), true);
  const unknownActor = copy();
  unknownActor.actorScope = 'unknown'; unknownActor.evidence.attribution = 'unknown';
  unknownActor.evidence.limitations.push('source-session-unlinked');
  assert.equal(accepts(unknownActor), true);
});

test('strict events reject extras; candidate projection drops additive fields without mutation', () => {
  const secret = 'INVENTED_FORBIDDEN_SOURCE_CONTENT';
  const candidate = {
    ...copy(), content: secret, prompt: secret, tool_output: secret,
    evidence: { ...example.evidence, reasoning: secret },
    targets: [{ ...example.targets[0], contents: secret }],
    metrics: { durationMs: 4, command: secret },
  };
  Object.defineProperty(candidate, 'unrecognizedGetter', { enumerable: true, get() { throw new Error(secret); } });
  const result = projectEventCandidate(candidate);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(candidate.content, secret);
  assert.equal(candidate.targets[0]?.contents, secret);
  assert.equal(parseEvent(JSON.stringify({ ...example, content: secret })).ok, false);
  assert.equal(projectEventCandidate({ ...example, metrics: { durationMs: { secret } } }).ok, false);
  assert.equal(JSON.stringify(projectEventCandidate({ ...example, phase: secret })).includes(secret), false);
});

test('invalid enum and contradictory identity/evidence combinations fail closed', () => {
  const invalid = [
    { ...copy(), schemaVersion: 2 },
    { ...copy(), phase: 'finished' },
    { ...copy(), outcome: 'success' },
    { ...copy(), phase: 'completed' },
    { ...copy(), actorScope: 'unknown', actorId: 'guessed-child' },
    { ...copy(), actorScope: 'child', actorId: 'child' },
    { ...copy(), actorScope: 'unknown' },
    { ...copy(), evidence: { ...example.evidence, diskPersistence: 'observed' } },
    { ...copy(), source: 'filesystem' },
    { ...copy(), operation: 'lifecycle', sourceEvent: 'stop', lifecycleScope: 'conversation' },
    { ...copy(), evidence: { ...example.evidence, correlation: 'unpaired' } },
  ];
  for (const event of invalid) assert.equal(accepts(event), false);
  const unscoped = copy(); delete unscoped.generationId;
  assert.equal(accepts(unscoped), false);
  unscoped.evidence.correlation = 'ambiguous';
  unscoped.evidence.limitations.push('generation-not-established');
  assert.equal(accepts(unscoped), true);
  const failure = copy();
  failure.phase = 'failed'; failure.outcome = 'denied'; failure.evidence.completion = 'source-reported';
  assert.equal(accepts(failure), true);
  const aborted = { ...failure, phase: 'cancelled', outcome: 'aborted' };
  assert.equal(accepts(aborted), true);
});

test('filesystem observations require unknown actor and do not imply tool completion', () => {
  const event = copy();
  event.source = 'filesystem'; event.sourceEvent = 'fileChanged';
  event.actorScope = 'unknown'; event.phase = 'observed';
  event.evidence = { activity: 'filesystem-observed', attribution: 'unknown', completion: 'not-observed', diskPersistence: 'observed', correlation: 'unpaired', limitations: ['acceptance-not-established'] };
  delete event.sourceCallId;
  assert.equal(accepts(event), true);
  event.phase = 'completed'; event.outcome = 'success'; event.evidence.completion = 'source-reported';
  assert.equal(accepts(event), false);
});

test('target, identifier and metric bounds reject unsafe or oversized records', () => {
  for (const path of ['../secret', 'src/../secret', 'src/./file', '/etc/hosts', 'C:/secret', 'C:\\secret', 'src\\file', 'src//file', 'src/', 'file\0name', 'https://host/file']) {
    assert.equal(accepts({ ...copy(), targets: [{ ...example.targets[0], relativePath: path }] }), false, path);
  }
  assert.equal(accepts({ ...copy(), targets: [{ ...example.targets[0], relativePath: '代码/雪.txt' }] }), true);
  assert.equal(accepts({ ...copy(), targets: [{ ...example.targets[0], relativePath: 'a'.repeat(1025) }] }), false);
  assert.equal(accepts({ ...copy(), collectorId: 'x'.repeat(129) }), false);
  assert.equal(accepts({ ...copy(), targets: Array.from({ length: 100 }, () => example.targets[0]) }), true);
  assert.equal(projectEventCandidate({ ...copy(), targets: Array.from({ length: 101 }, () => example.targets[0]) }).ok, false);
  for (const metrics of [{ durationMs: -1 }, { durationMs: 86400001 }, { count: 1.5 }, { targetsTruncated: -1 }]) {
    assert.equal(accepts({ ...copy(), metrics }), false);
  }
  assert.equal(accepts({ ...copy(), targets: [{ pathScope: 'workspace', pathKind: 'file' }] }), false);
  assert.equal(accepts({ ...copy(), targets: [{ pathScope: 'external-redacted', pathKind: 'unknown' }] }), true);
  assert.equal(accepts({ ...copy(), targets: [{ pathScope: 'external-redacted', pathKind: 'file', relativePath: 'leaked/path' }] }), false);
  const rename = { ...copy(), operation: 'rename', targets: [{ ...example.targets[0], renameDestination: { ...example.targets[0], relativePath: 'src/new.ts' } }] };
  assert.equal(accepts(rename), true);
  assert.equal(accepts({ ...rename, operation: 'read' }), false);
});

test('wire limit counts UTF-8 bytes and accepts the exact boundary', () => {
  const json = JSON.stringify(example);
  const padding = MAX_EVENT_BYTES - new TextEncoder().encode(json).byteLength;
  assert.equal(parseEvent(json + ' '.repeat(padding)).ok, true);
  assert.deepEqual(parseEvent(json + ' '.repeat(padding + 1)), { ok: false, reason: 'too-large' });
  const unicode = JSON.stringify({ ...copy(), targets: Array.from({ length: 40 }, () => ({ ...example.targets[0], relativePath: '雪'.repeat(700) })) });
  assert.ok(unicode.length < MAX_EVENT_BYTES);
  assert.deepEqual(parseEvent(unicode), { ok: false, reason: 'too-large' });
  assert.deepEqual(parseEvent('{broken'), { ok: false, reason: 'malformed-json' });
});

test('timestamps and spool/journal ordering have explicit validation boundaries', () => {
  assert.equal(accepts({ ...copy(), receivedAt: '2026-02-30T12:00:00.000Z' }), false);
  assert.equal(accepts({ ...copy(), receivedAt: '2026-10-21T15:11:47.536-07:00' }), false);
  assert.equal(accepts({ ...copy(), receivedAt: '2026-10-21T22:11:47Z' }), false);
  const journal = JSON.stringify({ ...copy(), ingestSequence: 1 });
  assert.deepEqual(parseEvent(journal), { ok: false, reason: 'invalid-stage' });
  assert.equal(parseEvent(journal, 'journal').ok, true);
  assert.deepEqual(parseEvent(JSON.stringify(example), 'journal'), { ok: false, reason: 'invalid-stage' });
  assert.equal(parseEvent(JSON.stringify({ ...example, ingestSequence: 0 }), 'journal').ok, false);
});

test('core contract modules have no editor or Node imports', async () => {
  for (const name of ['contracts.ts', 'eventValidation.ts']) {
    const source = await readFile(`src/core/${name}`, 'utf8');
    assert.equal(/(?:from\s*|import\s*\(|require\s*\()\s*['"](?:vscode|node:)/.test(source), false);
  }
});
