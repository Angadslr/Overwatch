import {mkdtemp, mkdir, writeFile, readFile, copyFile, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// The copied helper can be faulted without changing a user's installed helper
// or another test host. Every input file belongs to this new invented fixture.
const project = resolve('.'), run = await mkdtemp(join(project, '.local/t22-native-'));
const extension = join(run, 'extension'), fixture = join(run, 'fixture with spaces');
for (const path of [extension, fixture, join(extension, 'dist'), join(extension, 'assets'), join(fixture, '.vscode')]) await mkdir(path);
await writeFile(join(fixture, '.overwatch-probe-fixture'), 'overwatch-invented-fixture-v1\n');
await writeFile(join(fixture, '.gitignore'), '.local/\n');
await writeFile(join(fixture, '.vscode/settings.json'), JSON.stringify({'files.autoSave': 'off'}));
for (const [name, contents] of Object.entries({'read.txt': 'Invented native qualification read: amber.\n', 'edit.txt': 'Invented native qualification edit: cobalt.\n', 'shared.txt': 'Invented native qualification shared: indigo.\n'})) await writeFile(join(fixture, name), contents);
const git = spawnSync('git', ['-C', fixture, 'init', '--quiet'], {encoding: 'utf8'});
if (git.error || git.status !== 0) throw new Error('Invented fixture Git initialization failed');
const implementation = {};
for (const name of ['package.json', 'assets/supervision.svg', 'dist/extension.cjs', 'dist/cursor-supervision-hook']) {
  await copyFile(join(project, name), join(extension, name));
  implementation[name] = createHash('sha256').update(await readFile(join(extension, name))).digest('hex');
}
await chmod(join(extension, 'dist/cursor-supervision-hook'), 0o755);
const profile = 'Overwatch native qualification ' + run.split('/').at(-1);
const args = ['--new-window', '--profile', profile, '--extensionDevelopmentPath=' + extension, fixture];
const report = {createdAt: new Date().toISOString(), run, fixture, extension, profile, implementation,
  scope: 'Fresh named Cursor profile and invented fixture; existing application authentication may be shared by Cursor.',
  nativeDelivery: 'not-yet-tested', args};
await writeFile(join(run, 'launch.json'), JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--launch')) {
  const cli = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
  const launched = spawnSync(cli, args, {env: {...process.env, OVERWATCH_PROBE_AUTOSTART: '0'}, encoding: 'utf8', timeout: 30000});
  if (launched.error || launched.status !== 0) throw new Error('Cursor native fixture launch failed; inspect ' + run);
}
console.log(JSON.stringify(report, null, 2));
