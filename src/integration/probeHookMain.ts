import { observationResponse } from './probeHook';
// Retired discovery launcher: cached commands retain their response contract,
// but cannot bypass the versioned supervision publisher privacy policy.
process.stdout.write(JSON.stringify(observationResponse(process.argv.at(-1) ?? '')) + '\n', () => process.exit(0));
