import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const names = (await readdir('tests/unit')).filter(name => name.endsWith('.test.ts'));
await build({ entryPoints: names.map(name => `tests/unit/${name}`), outdir: '.local/unit-tests', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
const result = spawnSync(process.execPath, ['--test', ...names.map(name => `.local/unit-tests/${name.replace(/\.ts$/, '.cjs')}`)], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
