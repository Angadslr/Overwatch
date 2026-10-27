import { constants } from 'node:fs';
import { lstat, realpath, mkdir, open, readFile, rename, unlink, link } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse, parseTree, modify, applyEdits } from 'jsonc-parser';

const key = 'agentSupervision.detailsBeside';
const args = process.argv.slice(2), mode = args.shift() ?? 'status';
let workspace = process.env.INIT_CWD ?? process.cwd();
if (args.length) {
  if (args.length !== 2 || args[0] !== '--workspace') throw new Error('Usage: supervision:details -- status|toggle|beside|current --workspace PATH');
  workspace = args[1];
}
if (!['status', 'toggle', 'beside', 'current'].includes(mode)) throw new Error('Unknown details placement mode');
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size;
async function settings(directory) {
  const name = join(directory, 'settings.json');
  let info;
  try { info = await lstat(name); } catch (e) { if (e.code === 'ENOENT') return { text: '{}\n', info: undefined }; throw e; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw new Error('unsafe-settings-file');
  const file = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!sameFile(info, await file.stat())) throw new Error('settings-changed');
    return { text: await file.readFile('utf8'), info };
  } finally { await file.close(); }
}
function placement(text) {
  const errors = [], tree = parseTree(text, errors, { allowTrailingComma: true });
  const value = parse(text, [], { allowTrailingComma: true });
  if (errors.length || tree?.type !== 'object' || tree.children.filter(p => p.children?.[0]?.value === key).length > 1 ||
    (value[key] !== undefined && typeof value[key] !== 'boolean')) throw new Error('invalid-settings');
  return value[key] ?? true;
}
async function run() {
  const root = await realpath(resolve(workspace)), directory = join(root, '.vscode');
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('unsafe-settings-directory');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (mode !== 'status') await mkdir(directory);
  }
  if (mode === 'status') { console.log(`File details: ${placement((await settings(directory)).text) ? 'beside' : 'current editor group'}`); return; }
  const directoryInfo = await lstat(directory);
  const lockName = join(directory, '.overwatch-details.lock');
  const lock = await open(lockName, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const lockInfo = await lock.stat(), temporary = join(directory, `.overwatch-details-${randomUUID()}.tmp`);
  try {
    const before = await settings(directory), current = placement(before.text);
    const next = mode === 'toggle' ? !current : mode === 'beside';
    const text = applyEdits(before.text, modify(before.text, [key], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, before.info?.mode & 0o777 || 0o600);
    try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
    const checked = await settings(directory), currentDirectory = await lstat(directory);
    if (currentDirectory.dev !== directoryInfo.dev || currentDirectory.ino !== directoryInfo.ino || checked.text !== before.text || Boolean(checked.info) !== Boolean(before.info) ||
      (checked.info && !sameFile(checked.info, before.info))) throw new Error('settings-changed');
    if (before.info) await rename(temporary, join(directory, 'settings.json'));
    else await link(temporary, join(directory, 'settings.json'));
    console.log(`File details: ${next ? 'beside' : 'current editor group'} (applies to the next activity selection)`);
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    const current = await lstat(lockName).catch(() => undefined);
    if (current && sameFile(current, lockInfo)) await unlink(lockName);
  }
}
run().catch(() => { console.error('Could not update details placement. Check the workspace path, settings syntax, symlinks, or an existing .overwatch-details.lock.'); process.exitCode = 1; });
