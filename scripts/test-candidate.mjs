import {build} from 'esbuild';
import {mkdir, mkdtemp, writeFile, readFile, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {inspectCandidate} from './verify-candidate.mjs';

const root = resolve('.'), vsix = join(root, '.local/overwatch-supervision-candidate-0.0.4-darwin-arm64.vsix');
await inspectCandidate(vsix);
const run = await mkdtemp(join(root, '.local/t24-installed-')), profile = join(run, 'profile'), extensions = join(run, 'extensions'), fixture = join(run, 'fixture with spaces'), driver = join(run, 'driver');
for (const path of [profile, extensions, fixture, driver]) await mkdir(path);
await writeFile(join(fixture, '.overwatch-probe-fixture'), 'overwatch-invented-fixture-v1\n');
await writeFile(join(fixture, 'read.txt'), 'Invented read fixture.\n');await writeFile(join(fixture, 'edit.txt'), 'Invented edit fixture.\n');
await writeFile(join(driver, 'package.json'), JSON.stringify({name: 'overwatch-package-smoke-driver', publisher: 'angad-local', version: '0.0.1', engines: {vscode: '^1.105.0'}, main: './driver.cjs'}));
await writeFile(join(driver, 'driver.cjs'), 'exports.activate = function activate() {};\n');
await build({entryPoints: ['tests/extension/package-smoke.ts'], outfile: join(driver, 'tests.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode']});
const cli = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
const installed = spawnSync(cli, ['--user-data-dir', profile, '--extensions-dir', extensions, '--install-extension', vsix, '--force'], {encoding: 'utf8', timeout: 30000});
await writeFile(join(run, 'install.log'), (installed.stdout ?? '') + (installed.stderr ?? ''));
if (installed.error || installed.status !== 0) throw new Error('Isolated candidate installation failed');
const target = (await readdir(extensions)).filter(name => name.startsWith('angad-local.overwatch-native-probe-'));
if (target.length !== 1) throw new Error('Installed target is ambiguous');
const resultPath = join(run, 'result.json');
const child = spawn('/Applications/Cursor.app/Contents/MacOS/Cursor', [`--user-data-dir=${profile}`, `--extensions-dir=${extensions}`, `--extensionDevelopmentPath=${driver}`, `--extensionTestsPath=${join(driver, 'tests.cjs')}`, '--skip-welcome', '--skip-release-notes', fixture],
  {stdio: 'ignore', env: {...process.env, OVERWATCH_PACKAGE_SMOKE_RESULT: resultPath, OVERWATCH_PACKAGE_EXTENSIONS: extensions}});
let launchError;child.on('error', error => {launchError = error;});
try {
  const deadline = Date.now() + 120000;let result;
  while (Date.now() < deadline && !launchError) {
    try {result = JSON.parse(await readFile(resultPath, 'utf8'));break;}catch (error) {if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!result?.passed) throw new Error('Installed candidate smoke did not pass; inspect ' + run);
  await writeFile(join(root, 'docs/t24-installed-candidate-verification.json'), JSON.stringify({...result, run, installedExtension: join(extensions, target[0])}, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {child.kill('SIGTERM');}
