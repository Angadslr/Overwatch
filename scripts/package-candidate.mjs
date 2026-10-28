import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdir, mkdtemp, readFile, writeFile, copyFile, readdir, rm, lstat} from 'node:fs/promises';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url)), local = join(root, '.local');
const require = createRequire(import.meta.url), {createVSIX} = require('@vscode/vsce');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Candidate qualification is darwin-arm64 only');
await mkdir(local, {recursive: true});
const stage = await mkdtemp(join(local, 'candidate-stage-'));
const output = join(local, 'overwatch-supervision-candidate-0.0.4-darwin-arm64.vsix');
try {
  await mkdir(join(stage, 'dist'));await mkdir(join(stage, 'assets'));
  const bundled = await build({absWorkingDir: root, entryPoints: ['src/extension.ts'], outfile: join(stage, 'dist/extension.cjs'),
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], metafile: true, sourcemap: false, logLevel: 'silent'});
  const go = join(local, 'go-toolchain/go/bin/go');
  const compiled = spawnSync(go, ['build', '-trimpath', '-buildvcs=false', '-o', join(stage, 'dist/cursor-supervision-hook'), './cmd/cursor-supervision-hook'],
    {cwd: join(root, 'helper'), stdio: 'inherit', env: {...process.env, GOTOOLCHAIN: 'local', CGO_ENABLED: '0', GOOS: 'darwin', GOARCH: 'arm64', GOCACHE: join(local, 'go-cache')}});
  if (compiled.error || compiled.status !== 0) throw new Error('Pinned local Go helper build failed');
  const helper = await readFile(join(stage, 'dist/cursor-supervision-hook'));
  if (helper.readUInt32LE(0) !== 0xfeedfacf || helper.readUInt32LE(4) !== 0x100000c || !((await lstat(join(stage, 'dist/cursor-supervision-hook'))).mode & 0o111)) throw new Error('Expected executable Mach-O arm64 helper');
  const bundle = await readFile(join(stage, 'dist/extension.cjs'), 'utf8');
  if ([root, local, '/Users/', '/private/var/folders/', 'FAKE_SECRET', 'BEGIN PRIVATE KEY'].some(marker => bundle.includes(marker) || helper.includes(Buffer.from(marker)))) throw new Error('Candidate contains a forbidden development marker');
  await copyFile(join(root, 'assets/supervision.svg'), join(stage, 'assets/supervision.svg'));
  const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const {scripts, dependencies, devDependencies, ...manifest} = source;
  Object.assign(manifest, {version: '0.0.4', displayName: 'Overwatch Supervision Engineering Candidate',
    description: 'Private fixture-only engineering candidate. Resource qualification is incomplete; not a qualified personal alpha.', license: 'UNLICENSED',
    files: ['dist/extension.cjs', 'dist/cursor-supervision-hook', 'assets/supervision.svg', 'README.md', 'THIRD_PARTY_NOTICES.txt']});
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const packages = new Set(Object.keys(bundled.metafile.inputs).filter(path => path.startsWith('node_modules/')).map(path => {
    const parts = path.slice('node_modules/'.length).split('/');return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  }));
  const notices = [];
  for (const name of [...packages].sort()) {
    const path = join(root, 'node_modules', name), metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    const license = (await readdir(path)).find(file => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(file));
    if (!license) throw new Error('Missing bundled dependency license: ' + name);
    notices.push(`${name} ${metadata.version}\n${await readFile(join(path, license), 'utf8')}`);
  }
  notices.push(`Go runtime and standard library\n${await readFile(join(dirname(dirname(go)), 'LICENSE'), 'utf8')}`);
  await writeFile(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n========================================\n\n') + '\n');
  await copyFile(join(root, 'docs/candidate-readme.md'), join(stage, 'README.md'));
  process.env.SOURCE_DATE_EPOCH = String(Date.parse('2026-10-27T00:00:00.000Z') / 1000);
  await createVSIX({cwd: stage, packagePath: output, target: 'darwin-arm64', dependencies: false, preRelease: true,
    readmePath: 'README.md', allowMissingRepository: true, skipLicense: true, rewriteRelativeLinks: false});
  const {inspectCandidate} = await import('./verify-candidate.mjs');
  const inspection = await inspectCandidate(output);
  const report = {recordedAt: new Date().toISOString(), qualifiedRelease: false, resourceGate: 'open',
    packageSha256: createHash('sha256').update(await readFile(output)).digest('hex'), ...inspection};
  await writeFile(join(local, 'candidate-package-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, ...report}, null, 2));
} finally { await rm(stage, {recursive: true, force: true}); }
