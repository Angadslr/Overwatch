import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, realpath, rm, truncate, writeFile, mkdir, rename, symlink, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecureDirectory } from '../../src/transport/secureFs';

test('native canonical guards still reject ancestor symlinks even when the pinned directory inode is unchanged', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-native-guard-')));
  await mkdir(join(root, 'parent'));await mkdir(join(root, 'parent/storage'), {mode: 0o700});
  const directory = await SecureDirectory.open(join(root, 'parent/storage'));
  t.after(async () => {await directory.close();await rm(root, {recursive: true, force: true});});
  await directory.guard();await rename(join(root, 'parent'), join(root, 'moved'));
  await symlink(join(root, 'moved'), join(root, 'parent'));
  await assert.rejects(directory.guard(), /storage-directory-changed/);
});

test('secure reads allocate for file bytes while preserving empty, exact-limit and oversize behavior', async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-secure-read-')));
  const directory = await SecureDirectory.open(path);
  t.after(async () => { await directory.close(); await rm(path, { recursive: true, force: true }); });
  for (const contents of ['', 'metadata']) {
    await writeFile(join(path, 'record.json'), contents, { mode: 0o600 });
    const read = await directory.read('record.json', 24 * 1024 * 1024);
    assert.equal(read.bytes.toString('utf8'), contents);
    assert.equal(read.bytes.buffer.byteLength, Buffer.byteLength(contents) + 1);
    assert.equal((await directory.read('record.json', Buffer.byteLength(contents))).bytes.toString('utf8'), contents);
  }
  await assert.rejects(directory.read('record.json', 7), /storage-file-too-large/);
});

test('secure reads reject growth and truncation after descriptor validation', async t => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-secure-race-')));
  const directory = await SecureDirectory.open(path);
  t.after(async () => { await directory.close(); await rm(path, { recursive: true, force: true }); });
  const original = directory.file.bind(directory);
  for (const mutation of [
    () => appendFile(join(path, 'record.json'), 'growth'),
    () => truncate(join(path, 'record.json'), 0),
  ]) {
    await writeFile(join(path, 'record.json'), 'metadata', { mode: 0o600 });
    const replacement = t.mock.method(directory, 'file', async (name: string, flags?: number) => {
      const file = await original(name, flags);
      await mutation();
      return file;
    });
    try { await assert.rejects(directory.read('record.json', 24 * 1024 * 1024), /storage-file-changed/); }
    finally { replacement.mock.restore(); }
  }
});
test('pinned control reads restart at offset zero and reject replacement, mutation, hardlinks and permissions', async t => {
 const root = await realpath(await mkdtemp(join(tmpdir(), 'overwatch-pinned-read-')));
 t.after(() => rm(root, {recursive: true, force: true}));
 const mutations = [
  async (path:string) => {await rename(join(path,'lease'),join(path,'old'));await writeFile(join(path,'lease'),'lease-token',{mode:0o600});},
  async (path:string) => {await writeFile(join(path,'lease'),'other-token');},
  async (path:string) => {await appendFile(join(path,'lease'),'x');},
  async (path:string) => {await truncate(join(path,'lease'),0);},
  async (path:string) => {await link(join(path,'lease'),join(path,'alias'));},
  async (path:string) => {await chmod(join(path,'lease'),0o644);},
  async (path:string) => {await rename(join(path,'lease'),join(path,'old'));await symlink(join(path,'old'),join(path,'lease'));},
 ];
 for (const [index, mutate] of mutations.entries()) {
  const path = join(root,String(index));await mkdir(path,{mode:0o700});await writeFile(join(path,'lease'),'lease-token',{mode:0o600});
  const directory = await SecureDirectory.open(path), pinned = await directory.pin('lease',512);
  try {assert.equal((await pinned.read()).bytes.toString(),'lease-token');assert.equal((await pinned.read()).bytes.toString(),'lease-token');await mutate(path);await assert.rejects(pinned.read());}
  finally {await pinned.close();await pinned.close();await assert.rejects(pinned.read(),/closed/);await directory.close();}
 }
});
