import { build } from 'esbuild';
await build({
  entryPoints: { extension: 'src/extension.ts', 'probe-hook': 'src/integration/probeHookMain.ts', 'event-contract': 'src/core/eventValidation.ts', transport:'src/transport/spoolIngester.ts', 'cursor-projection':'src/adapters/cursorHooks.ts', 'file-activity':'src/core/reducers.ts' },
  outdir: 'dist', outExtension: { '.js': '.cjs' }, bundle: true,
  platform: 'node', target: 'node22', format: 'cjs', external: ['vscode'],
  sourcemap: false, logLevel: 'info',
  define: { __PROBE_NODE__: JSON.stringify(process.execPath) },
});
