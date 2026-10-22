import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { join } from 'node:path';

export async function environment() {
  const app = process.env.CURSOR_APP ?? '/Applications/Cursor.app';
  const resources = join(app, 'Contents', 'Resources', 'app');
  const product = JSON.parse(await readFile(join(resources, 'product.json'), 'utf8'));
  let goAvailable = true;
  try { execFileSync('go', ['version'], { stdio: 'ignore' }); } catch { goAvailable = false; }
  await access(join(resources, 'bin', 'cursor'), constants.X_OK);
  return {
    recordedAt: new Date().toISOString(), cursorVersion: product.version,
    cursorCommit: product.commit, embeddedVscodeVersion: product.vscodeVersion,
    platform: process.platform, architecture: process.arch,
    macosVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
    nodeVersion: process.version, goAvailable,
    minimumTypeDefinitions: '1.105.0', nativeDelivery: 'not-verified',
  };
}

if (process.argv[1]?.endsWith('/environment.mjs')) {
  const report = await environment();
  await mkdir('.local', { recursive: true });
  await writeFile('.local/environment.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
