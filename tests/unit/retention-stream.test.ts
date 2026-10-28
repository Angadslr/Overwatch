import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RetentionDecoder, readRetentionStream, writeRetentionStream} from '../../src/transport/retentionStream';
import {SecureDirectory} from '../../src/transport/secureFs';
import {JournalIndex} from '../../src/transport/journalIndex';
import type {RetiredIdentity, RetentionManifest} from '../../src/transport/retention';

const identities: RetiredIdentity[] = [1, 2].map(sequence => ({id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, digest: 'a'.repeat(64), sequence, receivedAt: '2026-10-27T00:00:00.000Z'}));
const manifest: RetentionManifest = {retentionVersion: 1, firstSegment: 2, firstSequence: 3, expiredBefore: '2026-10-20T00:00:00.000Z', retired: identities};
function decode(text: string, chunk: number, limit = 10) {
  const index = new JournalIndex(limit), parser = new RetentionDecoder(limit, identity => {index.addRetired(identity);});
  for (let offset = 0; offset < text.length; offset += chunk) parser.feed(text.slice(offset, offset + chunk));
  return {header: parser.finish(), identities: [...index.identities()]};
}

test('retention streaming accepts arbitrary chunk boundaries, whitespace, field order and escaped JSON strings', () => {
  const reordered = {retired: identities, firstSequence: 3, expiredBefore: manifest.expiredBefore, firstSegment: 2, retentionVersion: 1};
  for (const text of [JSON.stringify(manifest), JSON.stringify(reordered, null, 2), JSON.stringify(manifest).replace('firstSegment', 'first\\u0053egment').replace('2026-10-20', '\\u0032026-10-20')]) {
    for (const chunk of [1, 2, 3, 7, 31, text.length]) {
      const result = decode(text, chunk);
      assert.deepEqual(result.header, {...manifest, retired: []});assert.deepEqual(result.identities, identities);
    }
  }
});

test('retention streaming rejects corruption, duplicates, trailing tokens, invalid scope bounds and non-JSON whitespace', () => {
  const valid = JSON.stringify(manifest);
  const invalid = [valid.slice(0, -1), valid + '{}', valid.replace('"retired":[', '"retired":[,'), valid.replace(']}', ',]}'), valid.replace('"firstSegment":2', '"firstSegment":2,"firstSegment":2'), valid.replace('"firstSequence":3', '"firstSequence":2'), valid.replace('"firstSegment":2', '"secret":"FAKE_SECRET"'), valid.replace('"retired":[', '"retired":[' + JSON.stringify(identities[0]) + ','), valid.replace('{', '{\u00a0')];
  for (const text of invalid) assert.throws(() => decode(text, 3));
  assert.throws(() => decode(valid, 7, 1));
  assert.throws(() => decode(valid.replace('"firstSegment":2', '"firstSegment":' + '1'.repeat(5000)), 64));
});

test('streamed retention remains compatible JSON and failed replacement preserves the committed manifest', async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-retention-stream-'))), directory = await SecureDirectory.open(path);
  t.after(async () => {await directory.close();await rm(path, {recursive: true, force: true});});
  await writeRetentionStream(directory, manifest, identities, async () => {});
  const before = await readFile(join(path, 'retention.json'));
  assert.deepEqual(JSON.parse(before.toString()), manifest);
  const read: RetiredIdentity[] = [];
  assert.deepEqual(await readRetentionStream(directory, 10, item => {read.push(item);}), {...manifest, retired: []});assert.deepEqual(read, identities);
  const failed = function* (): IterableIterator<RetiredIdentity> {yield identities[0]!;throw new Error('interrupted-generator');};
  await assert.rejects(writeRetentionStream(directory, manifest, failed(), async () => {}), /interrupted-generator/);
  assert.deepEqual(await readFile(join(path, 'retention.json')), before);
  await writeFile(join(path, 'retention.json'), Buffer.from([255]));
  await assert.rejects(readRetentionStream(directory, 10, () => {}));
});
