import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSource, snapshotSource, parseJournalSnapshot} from '../../src/transport/sourceValidation';
import type {SourceEnvelopeV1} from '../../src/transport/sourceContracts';
import {normalizeCursorEnvelope, normalizeJournalRecord} from '../../src/adapters/cursorHooks';

function envelope(): SourceEnvelopeV1 {
  const eventId = '00000000-0000-4000-8000-000000000001', receivedAt = '2026-10-27T00:00:00.000Z';
  return {transportVersion: 1, eventId, receivedAt, collectorId: 'collector', environmentId: 'local', workspaceId: 'workspace',
    result: {metadata: {metadataVersion: 1, eventId, receivedAt, sourceEvent: 'beforeReadFile', sourceVersion: '3.26.16', tool: 'read', workspaceRootHashes: ['a'.repeat(64)]},
      counters: {unknownFields: 0, sensitiveFields: 0, invalidFields: 0}}};
}

test('source snapshot reuse requires module ownership and detaches all mutable nested input', () => {
  const input = envelope(), snapshot = snapshotSource(input);
  assert.ok(snapshot);assert.notEqual(snapshot, input);assert.equal(snapshotSource(snapshot), snapshot);
  input.result.counters.unknownFields = 4;input.result.metadata!.workspaceRootHashes.push('b'.repeat(64));
  assert.equal(snapshot.result.counters.unknownFields, 0);assert.equal(snapshot.result.metadata!.workspaceRootHashes.length, 1);
  assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.result.counters));assert.ok(Object.isFrozen(snapshot.result.metadata!.workspaceRootHashes));
  assert.throws(() => {snapshot.result.counters.invalidFields = 1;});
  const frozen = Object.freeze(envelope());assert.notEqual(snapshotSource(frozen), frozen);
  assert.equal(snapshotSource(Object.freeze({...envelope(), secret: 'FAKE_SECRET'})), undefined);
});

test('source and journal snapshot boundaries reject malformed bytes, extras and inconsistent identities', () => {
  const source = envelope(), record = {journalVersion: 1, ingestSequence: 7, envelope: source};
  const parsed = parseJournalSnapshot(Buffer.from(JSON.stringify(record)));assert.ok(parsed);
  assert.equal(snapshotSource(parsed.envelope), parsed.envelope);
  assert.deepEqual(parseSource(Buffer.from(JSON.stringify(source))), parsed.envelope);
  for (const invalid of [{...record, ingestSequence: 0}, {...record, extra: true}, {...record, envelope: {...source, eventId: '00000000-0000-4000-8000-000000000002'}}, {...record, envelope: {...source, secret: 'FAKE_SECRET'}}]) {
    assert.equal(parseJournalSnapshot(Buffer.from(JSON.stringify(invalid))), undefined);
  }
  assert.equal(parseJournalSnapshot(Buffer.from([255])), undefined);
  assert.equal(parseJournalSnapshot(Buffer.alloc(17000, 32)), undefined);
});

test('single-pass journal normalization preserves spool semantics and produces a detached frozen journal event', () => {
  const source = envelope(), spool = normalizeCursorEnvelope(source), journal = normalizeJournalRecord({journalVersion: 1, ingestSequence: 7, envelope: source});
  assert.ok(spool);assert.ok(journal);
  const {ingestSequence, ...facts} = journal.event;
  assert.equal(ingestSequence, 7);assert.deepEqual(facts, spool.event);
  assert.ok(Object.isFrozen(journal.event));assert.ok(Object.isFrozen(journal.event.evidence.limitations));
  source.result.metadata!.sourceEvent = 'afterFileEdit';assert.equal(journal.event.sourceEvent, 'beforeReadFile');
});

test('bounded per-journal string sharing cannot rewrite validated values or grow past its cap', () => {
  const strings = new Map<string, string>([['collector', 'FORBIDDEN_REPLACEMENT']]);
  for (let index = 1; index <= 700; index++) {
    const source = envelope();source.eventId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;source.result.metadata!.eventId = source.eventId;
    const row = parseJournalSnapshot(Buffer.from(JSON.stringify({journalVersion: 1, ingestSequence: index, envelope: source})), strings);
    assert.ok(row);const normalized = normalizeJournalRecord(row);assert.ok(normalized);
    assert.equal(normalized.event.collectorId, 'collector');assert.equal(row.envelope.collectorId, 'collector');
  }
  assert.ok(strings.size <= 512);assert.equal(strings.get('collector'), 'collector');
});
