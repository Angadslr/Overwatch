import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileObservations } from '../../src/adapters/fileObservations';
import { LocalPaths, type LocalTarget } from '../../src/adapters/localPaths';
import { FileActivityStore, LocalObservationStore, localObservationKey, type LocalObservation } from '../../src/core/reducers';
import { LifecycleStore } from '../../src/core/lifecycle';
import { CollectorHealth } from '../../src/core/health';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-observe-')));
  const active: FileObservations[] = [];
  t.after(async () => { for (const observer of active) { observer.dispose(); await observer.whenIdle(); } await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, 'read.txt'), 'INVENTED_CONTENT_NOT_TELEMETRY');
  const paths = await LocalPaths.create('local', [{ path: root }]);
  const store = new LocalObservationStore();
  let eligible = true;
  const observer = new FileObservations({ root, collectorId: 'collector', paths, eligible: () => eligible, deliver: record => { store.apply(record); } });
  active.push(observer);
  return { root, paths, store, observer, active, eligibility: (value: boolean) => { eligible = value; } };
}

test('dirty buffer, editor save and disk notifications stay independent with unknown actor and unverified bytes', async t => {
  const { root, store, observer } = await setup(t), path = join(root, 'read.txt');
  observer.enqueue({ path, kind: 'buffer-change', dirty: true });
  observer.enqueue({ path, kind: 'buffer-save' }); observer.enqueue({ path, kind: 'disk-change' });
  await observer.whenIdle(); const records = store.snapshot().records;
  assert.deepEqual(records.map(r => r.kind), ['buffer-dirty', 'editor-save', 'disk-change-notification']);
  for (const record of records) {
    assert.equal(record.event.actorScope, 'unknown'); assert.equal(record.event.evidence.attribution, 'unknown');
    assert.equal(record.event.evidence.completion, 'not-observed'); assert.equal(record.event.outcome, 'unknown'); assert.equal(record.event.operation, 'unknown');
    assert.equal(record.event.conversationId, undefined); assert.equal(record.event.actorId, undefined);
    assert.notEqual(record.event.evidence.diskPersistence, 'observed');
  }
  assert.equal(records[0]?.event.source, 'editor-buffer'); assert.equal(records[1]?.event.sourceEvent, 'bufferSaved'); assert.equal(records[2]?.event.source, 'filesystem');
  const agent = new FileActivityStore(), life = new LifecycleStore(), health = new CollectorHealth(); health.beginCollection();
  for (const record of records) { agent.apply({ event: record.event }); life.apply(record.event); health.observe(record.event, 'live'); }
  assert.equal(agent.snapshot().operations.length, 0); assert.equal(life.snapshot().conversations.length, 0); assert.equal(health.snapshot().nativeDelivery, 'awaiting-first-event');
  assert.equal(JSON.stringify(records).includes('INVENTED_CONTENT_NOT_TELEMETRY'), false); assert.equal(JSON.stringify(records).includes(root), false);
});

test('secret/external/integration paths are filtered before resolution, and internal aliases are checked canonically', async t => {
  const { root, paths, active } = await setup(t); await writeFile(join(root, '.env'), 'SECRET'); await symlink('.env', join(root, 'innocent.txt'));
  let resolutions = 0; const records: LocalObservation[] = [];
  const observer = new FileObservations({ root, collectorId: 'collector', eligible: () => true,
    paths: { environmentId: paths.environmentId, resolve: async input => { resolutions++; return paths.resolve(input); } }, deliver: r => { records.push(r); } }); active.push(observer);
  for (const path of [join(root, '.env'), join(root, '.local', 'journal.txt'), join(root, '.cursor', 'hooks.json'), join(root, '.git', 'index'), root + '-outside/file.txt'])
    observer.enqueue({ path, kind: 'disk-change' });
  await observer.whenIdle(); assert.equal(resolutions, 0); assert.equal(records.length, 0);
  observer.enqueue({ path: join(root, 'innocent.txt'), kind: 'disk-change' }); await observer.whenIdle();
  assert.equal(records.length, 0); assert.equal(observer.snapshot().excluded, 6);
});

test('delete/create bursts report notifications and current presence without constructing rename or deletion success', async t => {
  const { root, store, observer } = await setup(t); const path = join(root, 'transient.txt');
  await writeFile(path, 'invented'); await rm(path);
  observer.enqueue({ path, kind: 'disk-create' }); observer.enqueue({ path, kind: 'disk-delete' }); await observer.whenIdle();
  const records = store.snapshot().records; assert.equal(records.length, 2);
  assert.ok(records.every(r => r.currentPresence === 'missing' && r.event.operation === 'unknown' && r.event.outcome === 'unknown'));
  assert.ok(records.every(r => r.event.targets[0]?.pathScope === 'unresolved' && r.event.targets[0]?.fileKey === undefined));
  assert.ok(records.every(r => r.event.targets[0]?.relativePath === 'transient.txt'));
  await writeFile(path, 'recreated'); observer.enqueue({ path, kind: 'disk-create' }); await observer.whenIdle();
  assert.equal(store.snapshot().records.at(-1)?.currentPresence, 'file');
});

test('a buffer without dirty evidence stays unverified and malformed dirty metadata is rejected', async t => {
  const { root, store, observer } = await setup(t); const path = join(root, 'read.txt');
  observer.enqueue({ path, kind: 'buffer-change', dirty: false }); observer.enqueue({ path, kind: 'buffer-change' }); await observer.whenIdle();
  assert.equal(store.snapshot().records[0]?.kind, 'buffer-change'); assert.equal(store.snapshot().records.length, 1); assert.equal(observer.snapshot().failures, 1);
});

test('bounded queues disclose overflow and only adjacent matching notifications coalesce', async t => {
  const { root, paths, store, active } = await setup(t); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); let first = true;
  const observer = new FileObservations({ root, collectorId: 'collector', eligible: () => true, maxPending: 2, deliver: r => { store.apply(r); },
    paths: { environmentId: paths.environmentId, resolve: async path => { if (first) { first = false; await held; } return paths.resolve(path); } } }); active.push(observer);
  const path = join(root, 'read.txt'); observer.enqueue({ path, kind: 'disk-change' });
  observer.enqueue({ path, kind: 'buffer-change', dirty: true }); observer.enqueue({ path, kind: 'buffer-change', dirty: true });
  observer.enqueue({ path, kind: 'buffer-save' }); observer.enqueue({ path: join(root, 'dropped.txt'), kind: 'disk-delete' });
  try { assert.equal(observer.snapshot().dropped, 1); assert.equal(observer.snapshot().coalesced, 1); assert.equal(observer.snapshot().queued, 3); }
  finally { release(); }
  await observer.whenIdle(); assert.deepEqual(store.snapshot().records.map(r => r.kind), ['disk-change-notification', 'buffer-dirty', 'editor-save']);
  assert.equal(store.snapshot().records[1]?.event.metrics?.count, 2); assert.equal(observer.snapshot().coverage, 'partial');
});

test('disposal and eligibility changes suppress pending/in-flight delivery, including callbacks after stop', async t => {
  const { root, paths, store, active } = await setup(t); let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }); let eligible = true;
  const observer = new FileObservations({ root, collectorId: 'collector', eligible: () => eligible, deliver: r => { store.apply(r); },
    paths: { environmentId: paths.environmentId, resolve: async path => { await held; return paths.resolve(path); } } }); active.push(observer);
  observer.enqueue({ path: join(root, 'read.txt'), kind: 'disk-change' }); eligible = false; release(); await observer.whenIdle();
  assert.equal(store.snapshot().records.length, 0); assert.equal(observer.snapshot().cancelled, 1);
  eligible = true; observer.dispose(); observer.enqueue({ path: join(root, 'read.txt'), kind: 'buffer-save' }); await observer.whenIdle();
  assert.equal(store.snapshot().records.length, 0); assert.equal(observer.snapshot().state, 'off');
});

test('resolution/delivery failures disclose gaps without retaining errors, paths or document content', async t => {
  const { root, active } = await setup(t); const observer = new FileObservations({ root, collectorId: 'collector', eligible: () => true, deliver: () => {},
    paths: { environmentId: 'local', resolve: async (): Promise<LocalTarget> => { throw new Error('FAKE_SECRET_ERROR_' + root); } } }); active.push(observer);
  observer.enqueue({ path: join(root, 'read.txt'), kind: 'disk-change' }); await observer.whenIdle();
  assert.equal(observer.snapshot().failures, 1); assert.equal(JSON.stringify(observer.snapshot()).includes(root), false);
  assert.equal(JSON.stringify(observer.snapshot()).includes('FAKE_SECRET'), false);
});

test('local store rejects actor attribution, secret locators and false operation success; copies cannot mutate history', async t => {
  const { root, observer, store } = await setup(t); observer.enqueue({ path: join(root, 'read.txt'), kind: 'disk-change' }); await observer.whenIdle();
  const original = store.snapshot().records[0]!; assert.equal(store.apply(original), false);
  const attributed = JSON.parse(JSON.stringify(original)); attributed.event.eventId = '00000000-0000-4000-8000-000000000001';
  attributed.event.conversationId = 'recent-agent'; assert.throws(() => store.apply(attributed), /invalid-local-observation/);
  const secret = JSON.parse(JSON.stringify(original)); secret.event.targets[0].relativePath = '.env'; assert.throws(() => store.apply(secret));
  const success = JSON.parse(JSON.stringify(original)); success.event.outcome = 'success'; assert.throws(() => store.apply(success));
  const rename = JSON.parse(JSON.stringify(original)); rename.event.targets[0].renameDestination = { pathScope: 'unresolved', pathKind: 'unknown', relativePath: '.env' };
  assert.throws(() => store.apply(rename));
  const missing = JSON.parse(JSON.stringify(original)); missing.currentPresence = 'missing'; assert.throws(() => store.apply(missing));
  original.event.targets[0]!.relativePath = 'mutated.txt'; assert.equal(store.snapshot().records[0]?.event.targets[0]?.relativePath, 'read.txt');
  const current = store.snapshot().records[0]!; const another = JSON.parse(JSON.stringify(current)); another.event.environmentId = 'other';
  assert.equal(store.apply(another), true); assert.equal(store.snapshot().records.length, 2);
  assert.ok(store.get(localObservationKey(current.event)));
});

test('custom exclusions cover canonical destinations and empty observers expose missed-coverage limits', async t => {
  const { root, paths, active } = await setup(t); await mkdir(join(root, 'private')); await writeFile(join(root, 'private', 'client.txt'), 'invented'); await symlink('private/client.txt', join(root, 'alias.txt'));
  const exclusions = ['private/**'];
  const records: LocalObservation[] = []; const observer = new FileObservations({ root, collectorId: 'collector', paths, exclusions, eligible: () => true, deliver: r => { records.push(r); } }); active.push(observer);
  exclusions.length = 0; // An external mutation cannot silently remove the captured policy.
  observer.enqueue({ path: join(root, 'alias.txt'), kind: 'disk-change' }); await observer.whenIdle();
  assert.equal(records.length, 0); assert.equal(observer.snapshot().excluded, 1); assert.ok(observer.snapshot().limitations.some(s => s.includes('missed')));
});

test('local observation history stays bounded and discloses eviction without mutating agent activity', async t => {
  const { root, observer, store } = await setup(t); observer.enqueue({ path: join(root, 'read.txt'), kind: 'disk-change' }); await observer.whenIdle();
  const first = store.snapshot().records[0]!;
  for (let i = 1; i <= 2000; i++) {
    const next = JSON.parse(JSON.stringify(first)) as LocalObservation;
    next.event.eventId = `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`; next.event.operationId = next.event.eventId;
    store.apply(next);
  }
  assert.equal(store.snapshot().records.length, 2000); assert.equal(store.snapshot().coverageDropped, 1);
  assert.equal(store.get(localObservationKey(first.event)), undefined); assert.equal(store.apply(first), false);
});
