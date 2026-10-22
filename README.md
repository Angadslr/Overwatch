# Overwatch

Local, observation-only supervision for native Cursor Agent Chat. The repository currently implements the **Phase A native integration probe**, not the personal alpha UI. See [todo.md](todo.md) for execution status and [docs/compatibility.md](docs/compatibility.md) for measured limits.

## Run the probe

Requires macOS Apple Silicon, Cursor installed in `/Applications/Cursor.app`, and Node.js 22 or later. The qualified development Node is 24.21.0. Production will use the planned Go helper; this disposable discovery probe deliberately uses Node and makes no startup-performance claim.

```sh
npm ci --ignore-scripts
npm run check
npm run test:unit
npm run test:integration
npm run probe:environment
npm run probe:launch
```

`probe:launch` creates invented files under `.local/native fixture with spaces` and opens a Cursor Extension Development Host. It does not install a global extension or edit hooks in a real project. `CURSOR_APP` may select another installed app bundle when running the launcher.

The launcher attempts the documented plugin registration API. In the tested Cursor 3.25.9 and 3.26.16 hosts, that API is unavailable. Open the Command Palette and run **Overwatch Probe: Enable Project Hook Fallback in Fixture Workspace**. It creates `.cursor/hooks.json` exclusively in the invented workspace and refuses to overwrite an existing configuration. The exact generated configuration is saved as `.local/probe-storage/project-hooks.proposed.json` inside that fixture.

Use the native smoke instructions in [docs/native-smoke-test.md](docs/native-smoke-test.md). Inspect **Overwatch Probe: Show Compatibility Report** and the fixture's `.local/probe-storage/inbox`. The report's automatic `nativeDelivery: not-verified` deliberately requires a separate reviewed action trace; a successful registration or a file count alone cannot prove delivery.

Run **Overwatch Probe: Disable and Reload Fixture Window** when finished. Cursor 3.25.9 can retain cached project hooks after file deletion, so clearing the invocation requires a reload. Plain **Disable** removes the collection marker and prevents the corrected helper from persisting telemetry, but cached processes may still launch until reload. Normal extension-host shutdown also removes an unchanged owned project-hook file. If it was modified after installation, cleanup preserves it and reports `modified-preserved`; inspect and remove only the probe entries manually. A process crash can leave the fixture hook file behind. Do not promote this fixture-only lifecycle to production without T20/T21 ownership and recovery work.

## Implemented boundaries

- Workspace trust, local macOS arm64, and an explicit invented-fixture marker gate execution.
- The helper drops content, prompts, commands, outputs, email, reasoning, and unknown fields before publication. Source identifiers are hashed; only named invented fixture paths are recorded.
- Input is capped at 32 MiB. Publication uses exclusive temporary files and atomic rename; the inbox has an approximate 500-file limit. At the limit, telemetry is dropped. This probe does not yet have the production gap counters or journal.
- Permission-bearing hooks return `{"permission":"allow"}`; the installed observational hooks return `{}`. Nothing injects prompts or changes tool input.
- The tests use Node's test runner. Unit tests compile TypeScript into `.local/unit-tests`; integration tests launch the actual bundled hook process. These are distinct from real Cursor evidence.

A machine-specific probe VSIX can be rebuilt with `npm run package:probe`; its native install/read/edit/disable/uninstall was verified. See `docs/probe-package-verification.json` for the historical 0.0.2 package and [Phase A qualification](docs/phase-a-qualification.md) for the tested 0.0.3 checksum and cleanup. No alpha VSIX, journal, supervision view, export, or remote/cloud adapter is claimed. T01–T03 and G0 are complete for the reduced local Cursor 3.26.16/macOS arm64 profile. See [qualification](docs/phase-a-qualification.md) for the native matrix and explicit limits; T04 is complete; see the [event-v1 contract](docs/event-contract.md). T05 is next.
