import { mkdir, writeFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { constants } from 'node:fs';
import { environment } from './environment.mjs';

const project = resolve('.');
const fixture = join(project, '.local', 'native fixture with spaces');
const cli = join(process.env.CURSOR_APP ?? '/Applications/Cursor.app', 'Contents', 'Resources', 'app', 'bin', 'cursor');
await access(cli, constants.X_OK);
await mkdir(fixture, { recursive: true });
await writeFile(join(fixture, '.overwatch-probe-fixture'), 'overwatch-invented-fixture-v1\n');
for (const [name, contents] of Object.entries({ 'read.txt': 'Invented read fixture: amber.\n', 'edit.txt': 'Invented edit fixture: cobalt.\n', 'shared.txt': 'Invented shared fixture: indigo.\n' })) {
  try { await writeFile(join(fixture, name), contents, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
await writeFile(join(project, '.local', 'environment.json'), JSON.stringify(await environment(), null, 2));
const args = ['--new-window', `--extensionDevelopmentPath=${project}`, fixture];
const child = spawn(cli, args, { env: { ...process.env, OVERWATCH_PROBE_AUTOSTART: '1' }, stdio: 'inherit' });
child.on('error', () => { console.error('Cursor probe launcher failed.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
console.log('Opening the invented fixture in a Cursor Extension Development Host.');
console.log('Run “Overwatch Probe: Show Compatibility Report” to inspect registration.');
