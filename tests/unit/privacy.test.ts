import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixturePolicy, pathHint, validPolicy } from '../../src/integration/privacyPolicy';
import { diagnosticObservation, privacyExclusions } from '../../src/core/privacy';
import { normalizeCursorEnvelope } from '../../src/adapters/cursorHooks';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeSpool, SpoolIngester } from '../../src/transport/spoolIngester';
import type { SourceEnvelopeV1 } from '../../src/transport/sourceContracts';
import { randomUUID } from 'node:crypto';
import { excludedPath } from '../../src/core/paths';

test('default exclusions cover environment variants and common credential stores', () => {
  for (const path of ['.envrc', '.env.production', '.ssh/config', '.aws/config', '.azure/config', '.kube/config', '.gnupg/key', '.npmrc', '.pypirc', '.netrc', 'nested/credentials.json']) assert.equal(excludedPath(path), true);
  assert.equal(excludedPath('environment.ts'), false);
});

test('compiled privacy policy contains only hashes and applies custom globs before creating allowed hints', () => {
  const root = '/invented/FAKE_SECRET_ROOT', hash = createHash('sha256').update('workspace-root\0' + root).digest('hex');
  const policy = fixturePolicy(root, hash, ['EDIT.*', '**/read.txt', 'FAKE_SECRET_PATTERN']);
  assert.ok(validPolicy(policy, hash));
  for (const path of ['edit.txt', join(root, 'edit.txt'), 'read.txt', join(root, 'read.txt'), '.env', 'credentials.json']) assert.equal(policy.allowedPathHashes.includes(pathHint(path)), false);
  assert.equal(policy.allowedPathHashes.length, 8); assert.equal(JSON.stringify(policy).includes('FAKE_SECRET'), false);
  assert.equal(validPolicy({ ...policy, policyId: 'a'.repeat(64) }, hash), false);
  for (const input of [null, {}, [false], ['../escape'], Array(101).fill('x')]) assert.throws(() => privacyExclusions(input));
});

test('privacy gaps normalize to coarse self-check evidence without file or actor claims', () => {
  const eventId = randomUUID(), receivedAt = '2026-10-25T12:00:00.000Z';
  const source: SourceEnvelopeV1 = { transportVersion: 1, eventId, receivedAt, collectorId: 'collector', environmentId: 'local', workspaceId: 'workspace',
    result: { metadata: { metadataVersion: 1, eventId, receivedAt, sourceVersion: '3.26.16', sourceEvent: 'beforeReadFile', tool: 'read', pathHash: 'a'.repeat(64), workspaceRootHashes: ['b'.repeat(64)] },
      counters: { unknownFields: 1, sensitiveFields: 2, invalidFields: 0, privacy: 'policy-unavailable' } } };
  const observation = normalizeCursorEnvelope(source); assert.ok(observation);
  assert.equal(observation.pathHint, undefined); assert.equal(observation.event.source, 'self-check');
  assert.equal(observation.event.operation, 'unknown'); assert.equal(observation.event.actorScope, 'unknown'); assert.deepEqual(observation.event.targets, []);
});

test('ingress rejects hints outside the current policy and legacy config upgrades require collector ownership', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'privacy-'))); t.after(() => rm(root, { recursive: true, force: true }));
  let config = await initializeSpool(root, { collectorId: 'collector', environmentId: 'local', workspaceId: 'workspace' }, root, false);
  const { privacyVersion, policyId, allowedPathHashes, ...legacy } = config;
  await writeFile(join(root, 'publisher.json'), JSON.stringify(legacy), { mode: 0o600 });
  config = await initializeSpool(root, legacy, root, false);
  const owner = await SpoolIngester.open(root, config);
  try {
    await assert.rejects(SpoolIngester.open(root, config));
    await owner.setPrivacyPolicy(root, ['edit.txt']);
    const current = JSON.parse(await readFile(join(root, 'publisher.json'), 'utf8'));
    assert.equal(current.enabled, false); assert.equal(current.privacyVersion, 1);
    const eventId = randomUUID(), receivedAt = new Date().toISOString();
    const source: SourceEnvelopeV1 = { transportVersion: 1, eventId, receivedAt, collectorId: 'collector', environmentId: 'local', workspaceId: 'workspace', result: {
      metadata: { metadataVersion: 1, eventId, receivedAt, sourceVersion: '3.26.16', sourceEvent: 'afterFileEdit', tool: 'edit', pathHash: pathHint('edit.txt'), policyId: current.policyId, workspaceRootHashes: [current.sourceRootHash] },
      counters: { unknownFields: 0, sensitiveFields: 0, invalidFields: 0 } } };
    await writeFile(join(root, 'inbox', eventId + '.json'), JSON.stringify(source), { mode: 0o600 });
    await owner.scan(); assert.equal(owner.journal.records.length, 0); assert.equal(owner.counters.rejected, 1);
  } finally { await owner.close(); }
});

test('default local diagnostics omit relative paths and file keys', () => {
  const raw = { kind: 'disk-change-notification', currentPresence: 'file', event: { eventId: 'id', source: 'filesystem', sourceEvent: 'fileChanged', receivedAt: 'now', environmentId: 'local', workspaceId: 'workspace', targets: [{ relativePath: 'FAKE_SECRET_PATH', fileKey: 'FAKE_SECRET_KEY' }], evidence: { attribution: 'unknown' } } };
  const diagnostic = diagnosticObservation(raw as Parameters<typeof diagnosticObservation>[0]);
  assert.equal(JSON.stringify(diagnostic).includes('FAKE_SECRET'), false);
});
