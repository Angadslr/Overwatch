import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Journal } from '../../src/transport/journal';
import { SecureDirectory } from '../../src/transport/secureFs';
import type { SourceEnvelopeV1 } from '../../src/transport/sourceContracts';

async function fixture(t: TestContext) {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-journal-stream-')));
  const directory = await SecureDirectory.open(path);
  t.after(async () => { await directory.close(); await rm(path, { recursive: true, force: true }); });
  const receivedAt = '2026-10-26T00:00:00.000Z';
  const events: SourceEnvelopeV1[] = Array.from({length: 400}, () => {
    const eventId = randomUUID();
    return {transportVersion: 1, eventId, receivedAt, collectorId: 'collector', environmentId: 'local', workspaceId: 'workspace',
      result: {metadata: {metadataVersion: 1, eventId, receivedAt, sourceEvent: 'beforeReadFile', sourceVersion: '3.26.16', tool: 'read', workspaceRootHashes: ['a'.repeat(64)]},
        counters: {unknownFields: 0, sensitiveFields: 0, invalidFields: 0}}};
  });
  const lines = events.map((envelope, index) => JSON.stringify({journalVersion: 1, ingestSequence: index + 1, envelope}));
  const file = join(path, 'journal-000000.ndjson');
  await writeFile(file, lines.join('\n') + '\n', {mode: 0o600});
  const journal = new Journal(directory, async () => {}, event => event.workspaceId === 'workspace', {now: () => Date.parse(receivedAt)});
  await journal.load();
  return {journal, directory, events, lines, file};
}

test('history pages use bounded reads across split records and preserve exact sequence and identity', async t => {
  const {journal, directory, events} = await fixture(t);
  const original = directory.file.bind(directory);
  const lengths: number[] = [];
  t.mock.method(directory, 'file', async (name: string, flags?: number) => {
    const file = await original(name, flags);
    return {...file, handle: new Proxy(file.handle, {
      get(target, key) {
        if (key === 'read') return (...args: unknown[]) => {
          assert.ok(Buffer.isBuffer(args[0]));
          lengths.push(args[0].byteLength);
          return Reflect.apply(target.read, target, args);
        };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })};
  });
  const page = await journal.readHistory(110, 180);
  assert.deepEqual(page.map(record => record.ingestSequence), Array.from({length: 180}, (_, index) => index + 111));
  assert.deepEqual(page.map(record => record.envelope.eventId), events.slice(110, 290).map(event => event.eventId));
  assert.ok(lengths.length > 1);
  assert.ok(lengths.every(length => length <= 64 * 1024));
  assert.deepEqual((await journal.readHistory(399, 2)).map(record => record.ingestSequence), [400]);
});

test('an early history-page return still rejects file growth and closes its descriptor', async t => {
  const {journal, directory, file} = await fixture(t);
  const original = directory.file.bind(directory);
  let closed = false;
  t.mock.method(directory, 'file', async (name: string, flags?: number) => {
    const opened = await original(name, flags);
    await appendFile(file, ' ');
    const close = opened.handle.close.bind(opened.handle);
    t.mock.method(opened.handle, 'close', async () => { closed = true; await close(); });
    return opened;
  });
  await assert.rejects(journal.readHistory(0, 1), /journal-file-changed/);
  assert.equal(closed, true);
});

test('history pagination validates skipped prefix digests and refuses a torn suffix without repairing it', async t => {
  const {journal, events, lines, file} = await fixture(t);
  const changed = structuredClone(events[0]!);
  changed.result.counters.unknownFields = 1;
  await writeFile(file, [JSON.stringify({journalVersion: 1, ingestSequence: 1, envelope: changed}), ...lines.slice(1)].join('\n') + '\n');
  await assert.rejects(journal.readHistory(300, 1), /journal-corrupt/);
  const torn = lines.join('\n') + '\n{"torn":';
  await writeFile(file, torn);
  await assert.rejects(journal.readHistory(399, 2), /journal-corrupt/);
  assert.equal(await readFile(file, 'utf8'), torn);
});
