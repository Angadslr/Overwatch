import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalPaths, type LocalTarget, type LocalPathFilesystem } from '../../src/adapters/localPaths';
import { containsPath, excludedPath, validLocalPath } from '../../src/core/paths';
import { FileActivityStore } from '../../src/core/reducers';
import { parseEvent } from '../../src/core/eventValidation';
import { randomUUID } from 'node:crypto';
import type { EventV1 } from '../../src/core/contracts';

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-paths-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'workspace with spaces'); await mkdir(root);
  await writeFile(join(root, 'read.txt'), 'Invented file bytes.');
  return { parent, root, paths: await LocalPaths.create('local', [{ path: root }]) };
}
function resolved(result: LocalTarget): asserts result is Extract<LocalTarget, { ok: true }> { assert.equal(result.ok, true); }
function event(result: Extract<LocalTarget, { ok: true }>): EventV1 {
  return { schemaVersion: 1, eventId: randomUUID(), collectorId: 'collector', environmentId: 'local', workspaceId: result.root.workspaceId,
    ...(result.root.worktreeId ? { worktreeId: result.root.worktreeId } : {}), source: 'cursor-hook', sourceEvent: 'beforeReadFile', receivedAt: '2026-10-23T12:00:00.000Z',
    actorScope: 'unknown', operationId: randomUUID(), operation: 'read', phase: 'requested', outcome: 'unknown', targets: [result.target],
    evidence: { activity: 'source-reported', attribution: 'unknown', completion: 'not-observed', diskPersistence: 'not-observed', correlation: 'unpaired', limitations: [] } };
}

test('spaces, Unicode and dot components resolve without file contents or absolute paths in persisted targets', async t => {
  const { root, paths } = await setup(t); await mkdir(join(root, '日本語')); await writeFile(join(root, '日本語', 'café.txt'), 'SECRET_BYTES');
  const file = await paths.resolve('./日本語/café.txt'); resolved(file);
  assert.equal(file.relativePath, '日本語/café.txt'); assert.equal(file.target.pathScope, 'workspace'); assert.equal(file.target.pathKind, 'file');
  assert.equal(parseEvent(JSON.stringify(event(file))).ok, true);
  assert.equal(JSON.stringify(file.target).includes(root), false); assert.equal(JSON.stringify(file.target).includes('SECRET_BYTES'), false);
  const same = await paths.resolve(join(root, '日本語', 'café.txt')); resolved(same); assert.equal(file.target.fileKey, same.target.fileKey);
});

test('longest physical root wins and ambiguous relative paths require an explicit base root', async t => {
  const { root } = await setup(t); const nested = join(root, 'nested'); await mkdir(nested); await writeFile(join(nested, 'read.txt'), 'invented');
  const paths = await LocalPaths.create('local', [{ path: root }, { path: nested }]);
  const file = await paths.resolve(join(nested, 'read.txt')); resolved(file); assert.equal(file.root.path, nested); assert.equal(file.relativePath, 'read.txt');
  const ambiguous = await paths.resolve('read.txt'); assert.equal(ambiguous.ok, false); if (!ambiguous.ok) assert.equal(ambiguous.reason, 'ambiguous-root');
  const explicit = await paths.resolve('nested/read.txt', paths.roots.find(r => r.path === root)!.workspaceId); resolved(explicit);
  assert.equal(explicit.target.fileKey, file.target.fileKey);
  const directory = await paths.resolve(join(root, 'nested')); assert.equal(directory.ok, false); // root itself has no file-relative target
});

test('traversal, external siblings, control characters and URI inputs expose no visible path', async t => {
  const { root, parent, paths } = await setup(t); await mkdir(root + '-sibling');
  assert.equal(containsPath(root, root + '-sibling/read.txt'), false);
  for (const path of ['../read.txt', 'a/../../read.txt', root + '/../escape', 'file:///secret', 'ssh://remote/file', 'bad\u0000name', 'bad\\name']) {
    const result = await paths.resolve(path); assert.equal(result.ok, false); assert.equal('relativePath' in result.target, false); assert.equal('fileKey' in result.target, false);
  }
  const outside = await paths.resolve(join(parent, 'external.txt')); assert.equal(outside.ok, false); assert.equal(outside.target.pathScope, 'external-redacted');
});

test('internal symlink aliases share canonical identity, preserving a separate display locator', async t => {
  const { root, paths } = await setup(t); await symlink('read.txt', join(root, 'alias.txt'));
  const original = await paths.resolve('read.txt'), alias = await paths.resolve('alias.txt'); resolved(original); resolved(alias);
  assert.equal(alias.target.fileKey, original.target.fileKey); assert.equal(alias.relativePath, 'read.txt'); assert.equal(alias.displayPath, 'alias.txt'); assert.equal(alias.canonicalized, true);
  const store = new FileActivityStore(); store.apply({ event: event(original) }); store.apply({ event: event(alias) }); assert.equal(store.snapshot().files.length, 1);
});

test('external, cross-root, dangling and cyclic symlinks never acquire a workspace file key', async t => {
  const { root, parent } = await setup(t); const other = join(parent, 'other'); await mkdir(other); await writeFile(join(other, 'read.txt'), 'invented');
  await symlink(join(other, 'read.txt'), join(root, 'external')); await symlink('absent.txt', join(root, 'dangling')); await symlink('cycle', join(root, 'cycle'));
  const paths = await LocalPaths.create('local', [{ path: root }, { path: other }]);
  for (const name of ['external', 'dangling', 'cycle']) { const result = await paths.resolve(join(root, name)); assert.equal(result.ok, false); assert.equal(result.target.fileKey, undefined); }
});

test('missing descendants resolve their real parent but never silently merge physical identities', async t => {
  const { root, paths } = await setup(t); await mkdir(join(root, 'directory')); await symlink('directory', join(root, 'alias'));
  const missing = await paths.resolve('alias/new/deleted.txt'); resolved(missing);
  assert.equal(missing.existence, 'missing'); assert.equal(missing.relativePath, 'directory/new/deleted.txt'); assert.equal(missing.target.pathScope, 'unresolved'); assert.equal(missing.target.fileKey, undefined);
  assert.equal(parseEvent(JSON.stringify(event(missing))).ok, true);
  const impossible = await paths.resolve('read.txt/child'); assert.equal(impossible.ok, false);
  await writeFile(join(root, 'later.txt'), 'invented'); const existing = await paths.resolve('later.txt'); resolved(existing); assert.ok(existing.target.fileKey);
  await rm(join(root, 'later.txt')); const deleted = await paths.resolve('later.txt'); resolved(deleted); assert.equal(deleted.target.fileKey, undefined);
});

test('secret names, custom globs and symlink destinations are excluded before visible target persistence', async t => {
  const { root } = await setup(t); await mkdir(join(root, 'private')); await writeFile(join(root, '.env'), 'SECRET'); await writeFile(join(root, 'private', 'client.txt'), 'SECRET');
  await symlink('.env', join(root, 'innocent.txt')); const paths = await LocalPaths.create('local', [{ path: root }], ['private/**', '**/*.dump']);
  for (const path of ['.env', '.env.production', 'cert.pem', 'credentials.json', 'private/client.txt', 'innocent.txt', 'nested/debug.dump']) {
    const result = await paths.resolve(path); assert.equal(result.ok, false, path); if (!result.ok) assert.equal(result.reason, 'excluded', path);
    assert.equal(JSON.stringify(result).includes(path), false); assert.equal(result.target.fileKey, undefined);
  }
  assert.equal(excludedPath('public/environment.ts'), false);
  await assert.rejects(LocalPaths.create('local', [{ path: root }], ['../private']));
});

test('physical worktrees and environments keep identical relative names separate', async t => {
  const { root, parent } = await setup(t); const second = join(parent, 'worktree-two'); await mkdir(second); await writeFile(join(second, 'read.txt'), 'other invented bytes');
  const firstPaths = await LocalPaths.create('local', [{ path: root, worktreeId: 'first' }]);
  const secondPaths = await LocalPaths.create('local', [{ path: second, worktreeId: 'second' }]);
  const remotePaths = await LocalPaths.create('remote', [{ path: root, worktreeId: 'first' }]);
  const results = await Promise.all([firstPaths.resolve('read.txt'), secondPaths.resolve('read.txt'), remotePaths.resolve('read.txt')]);
  for (const result of results) resolved(result);
  assert.equal(new Set(results.map(r => r.ok && r.target.fileKey)).size, 3);
  const store = new FileActivityStore();
  for (const result of results) { resolved(result); const e = event(result); if (result.target.fileKey === (results[2]!.ok ? results[2]!.target.fileKey : '')) e.environmentId = 'remote'; store.apply({ event: e }); }
  assert.equal(store.snapshot().files.length, 3);
});

test('rename endpoints remain independent and an excluded destination is redacted', async t => {
  const { paths } = await setup(t); const pair = await paths.rename('read.txt', 'new.txt');
  assert.equal(pair.source.target.pathScope, 'workspace'); assert.equal(pair.destination.target.pathScope, 'unresolved'); assert.equal(pair.target.renameDestination?.fileKey, undefined);
  const hidden = await paths.rename('read.txt', '.env'); assert.equal(hidden.target.renameDestination?.pathScope, 'external-redacted');
  assert.equal(JSON.stringify(hidden.target).includes('.env'), false);
});

test('canonical symlink spellings still satisfy the event contract and cross-root rename targets stay unresolved', async t => {
  const { root, parent, paths } = await setup(t);
  await writeFile(join(root, 'a:b'), 'invented'); await symlink('a:b', join(root, 'ordinary.txt'));
  const invalid = await paths.resolve('ordinary.txt'); assert.equal(invalid.ok, false); assert.equal(invalid.target.fileKey, undefined);
  const second = join(parent, 'second'); await mkdir(second); await writeFile(join(second, 'next.txt'), 'invented');
  const multiple = await LocalPaths.create('local', [{ path: root }, { path: second }]);
  const pair = await multiple.rename(join(root, 'read.txt'), join(second, 'next.txt'));
  assert.equal(pair.destination.ok, true); assert.equal(pair.target.renameDestination?.pathScope, 'unresolved');
  assert.equal(pair.target.renameDestination?.relativePath, undefined);
});

test('actual filesystem case semantics use realpath rather than unconditional lowercasing', async t => {
  const { root, paths } = await setup(t); await writeFile(join(root, 'MixedCase.txt'), 'one');
  const upper = await paths.resolve('MixedCase.txt'); resolved(upper);
  let insensitive = false;
  try { insensitive = (await stat(join(root, 'mixedcase.txt'))).ino === (await stat(join(root, 'MixedCase.txt'))).ino; } catch { }
  if (!insensitive) await writeFile(join(root, 'mixedcase.txt'), 'two');
  const lower = await paths.resolve('mixedcase.txt'); resolved(lower);
  assert.equal(upper.target.fileKey === lower.target.fileKey, insensitive);
  assert.equal(upper.relativePath === lower.relativePath, insensitive);
  t.diagnostic(`Host volume case-insensitive: ${insensitive}; missing targets remain unresolved under either rule.`);
});

test('replaced roots fail closed and conflicting canonical root declarations are rejected', async t => {
  const { root, paths } = await setup(t); await rename(root, root + '-original'); await mkdir(root); await writeFile(join(root, 'read.txt'), 'replacement');
  const result = await paths.resolve('read.txt'); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.reason, 'root-changed');
  await assert.rejects(LocalPaths.create('local', [{ path: root, worktreeId: 'a' }, { path: root, worktreeId: 'b' }]), /ambiguous-local-root/);
  assert.equal(validLocalPath('literal space/日本語.txt'), true);
});

test('deterministic sensitive and insensitive filesystem fixtures preserve their own canonical spelling rules', async () => {
  for (const sensitive of [true, false]) {
    const names = ['/fixture', '/fixture/Mixed.txt', ...(sensitive ? ['/fixture/mixed.txt'] : [])];
    const canonical = (path: string): string => {
      const found = names.find(n => sensitive ? n === path : n.toLowerCase() === path.toLowerCase());
      if (!found) throw Object.assign(new Error('fixture-missing'), { code: 'ENOENT' });
      return found;
    };
    const info = async (path: string) => {
      const name = canonical(path);
      return { dev: 1, ino: names.indexOf(name) + 1, isDirectory: () => name === '/fixture', isFile: () => name !== '/fixture', isSymbolicLink: () => false };
    };
    const filesystem: LocalPathFilesystem = { realpath: async path => canonical(path), stat: info, lstat: info };
    const paths = await LocalPaths.create('case-fixture', [{ path: '/fixture' }], [], filesystem);
    const upper = await paths.resolve('Mixed.txt'), lower = await paths.resolve('mixed.txt'); resolved(upper); resolved(lower);
    assert.equal(upper.target.fileKey === lower.target.fileKey, !sensitive);
    assert.equal(upper.relativePath === lower.relativePath, !sensitive);
    const missing = await paths.resolve('absent.txt'); resolved(missing); assert.equal(missing.target.fileKey, undefined);
  }
});

test('bounded glob matching handles recursive directories and literal punctuation without regex backtracking', () => {
  for (const path of ['debug.dump', 'a/debug.dump', 'a/b/debug.dump']) assert.equal(excludedPath(path, ['**/*.dump']), true);
  assert.equal(excludedPath('a/file[1].txt', ['a/file[1].txt']), true);
  assert.equal(excludedPath('a/file1.txt', ['a/file[1].txt']), false);
  assert.equal(excludedPath('public/read.txt', ['private/**']), false);
  assert.equal(excludedPath('a'.repeat(1000) + 'c', ['a*'.repeat(100) + 'b']), false);
});

test('target substitution between canonicalization and final observation never yields a physical key', async () => {
  let targetLookups = 0;
  const info = async (path: string) => ({ dev: 1, ino: path === '/fixture' ? 1 : 2,
    isDirectory: () => path === '/fixture', isFile: () => path !== '/fixture', isSymbolicLink: () => false });
  const filesystem: LocalPathFilesystem = { stat: info, lstat: info, realpath: async path => {
    if (path === '/fixture/read.txt' && ++targetLookups > 1) return '/outside/private.txt';
    return path;
  } };
  const paths = await LocalPaths.create('local', [{ path: '/fixture' }], [], filesystem);
  const result = await paths.resolve('read.txt'); assert.equal(result.ok, false); assert.equal(result.target.fileKey, undefined);
  assert.equal(JSON.stringify(result).includes('private.txt'), false);
});
