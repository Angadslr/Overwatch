# Overwatch implementation handoff

Updated 22 October 2026 for Angad.

Build a local, observation-only extension for native Cursor source-session/file evidence, overlap advisories and bounded history. [plan.md](plan.md) defines the architecture; [todo.md](todo.md) tracks execution.

## Completed

T01–T08, G0 and G1 are complete for the reduced local observation profile. The repository contains the fixture-gated TypeScript/Node discovery probe, event-v1 and source-envelope schemas, generated contracts, Go privacy/response pipeline, bounded atomic spool, exclusive collector, durable source journal and conservative file-evidence adapter/reducer. T08 supplies a native fixture tree and safe known-file opening. Stable aliases follow in T09; general physical/visible paths remain T10. Retention, checkpoints and automatic ownership takeover remain later work.

T01 retains historical Cursor 3.25.9 evidence. T02/T03 qualified updated Cursor 3.26.16, commit `8fcb8ace5c73fa31f2e2707fd6783160e4ed3e40`, API 1.128.0, extension-host Node 24.19.0, macOS 26.5.2 arm64. Development Node/npm: 24.21.0/11.19.0. Go 1.27.3 was checksum-verified into `.local/go-toolchain/go`; add its `bin` to PATH and set GOCACHE to `.local/go-cache` as shown in `docs/helper-pipeline.md`. System PATH was not modified.

159 new native events and fifteen timing samples cover operations, failures/denial/abort, deliberate telemetry loss, simultaneous same-model chats, identical parallel children, two physical worktrees and two regular windows on one checkout. Thirteen hook kinds delivered. Read/edit repeated after reload. [Qualification](docs/phase-a-qualification.md), [compatibility](docs/compatibility.md), [action trace](docs/native-smoke-test.md), [accepted decision](docs/decisions/native-integration.md), and [fixtures](tests/fixtures/cursor/) contain exact evidence and limits.

## Constraints for the next implementer

- Select explicit project hooks on the qualified build; plugin registration API is unavailable. One canonical root has one producer/inbox and one collector owner; duplicate windows stay passive. T06 implements an exclusive storage lease and explicit dead-process recovery; editor-window routing, heartbeat, config merging and automatic recovery remain later integration/T20/T21 work.
- Partition call joins by operation kind as well as environment/root/conversation/generation/call ID. IDs were reused across Read/Write. Retain ambiguity on same-kind reuse.
- Child Task/lifecycle IDs join, but child file-tool session IDs lack a retained join to the lifecycle IDs. Keep these sessions unlinked; no task/model/PID/time attribution.
- `afterFileEdit` lacks a call ID. Keep it separate from Write, buffer/disk state and Keep/Undo. Shell/MCP file internals and session-end delivery are unavailable in the qualified profile.
- Native `stop: aborted` arrived before tool failure. Missing telemetry after observation loss remains unknown even when the native UI reports success.
- Disable the collection marker before config cleanup and reload to clear cached hook commands. Resolve pending fixture reviews before reloading.

## Verification and cleanup

```sh
npm ci --ignore-scripts
npm run check
npm run test:unit
npm run test:integration
npm run probe:environment
npm run probe:launch
```

Phase A checks: type check/build, 15 unit tests and 5 child-process integration tests passed; T04 verification is recorded below. Fixture probe VSIX 0.0.3 installed/uninstalled via the supported Cursor CLI. The tested package checksum and contents result are in the qualification report; the package was built before final documentation edits.

Collection is disabled in all three native fixtures; all owned hook configs/markers and the temporary MCP config are absent. Final disabled native Read succeeded with main inbox unchanged at 184; worktree inboxes remain 19 and 16. Fixture windows are left for evidence inspection. No real project or user/global hooks changed. No commit, publication or release was created for T08. T08 cleanup and current verification are recorded below.

## T04 implementation handoff

See [event contract](docs/event-contract.md). Edit the schema, run `npm run generate:contracts`, and verify with `npm run check`. `parseEvent` strictly validates persisted bytes; `projectEventCandidate` strips unknown candidate fields without replacing T05/T07 source-specific mapping. Spool input omits ingestSequence; journal input requires it. Source-call joins require explicit scope and a separate sourceCallId; unpaired facts remain separate. Core modules have no editor/Node imports. Schema representations include reserved capabilities without advertising native support.

Ajv is pinned to 8.20.0. Clean build, 23 unit tests, 5 integration tests and standalone bundle smoke passed. No additional Cursor agent runs or hook setup occurred. T05 now generates Go shapes alongside TypeScript. Editor-host tests/alpha packaging remain T08/T24.

## T05 implementation handoff

See [helper pipeline](docs/helper-pipeline.md) for limits, review fixes, exact commands and actual results. The standard-library-only Go CLI emits its response before telemetry and applies a 1,500 ms input/consumer budget. Every discovery hook response is tested in compiled processes; `sessionEnd` remains unqualified for installation. Safe gap codes never become source action failures. Consumer errors/panics are contained without printing errors. Go tests, race detection, vet, helper build and 468,699 fuzz executions passed, alongside the existing TypeScript/probe checks.

`input.Result` is bounded source metadata, not event-v1. T06 now wraps/publishes it through the validated source-envelope contract; T07 maps normalized facts. No raw nested arguments, roots or visible paths are retained: approved root hashes and nonconflicting path hints survive until T10 supplies physical scope/exclusion policy. Do not infer canonical file identity or actor ownership from those hints. Generated Go shapes are not runtime validators; `check:contracts` verifies freshness for both languages. Probe VSIX exclusions keep the production helper/transport/projection bundles and local tool metadata out of discovery packages.

## T06/T07 implementation handoff

See [local transport](docs/local-transport.md) and [Cursor file projection](docs/cursor-file-projection.md) for architecture, review findings and actual tests. `npm run test:integration` builds the real Go helper and TypeScript transport/projection bundles. The Go wrapper selects the ignored local toolchain when present, otherwise Go on PATH, with a project-local cache.

Use an existing private canonical storage directory with `initializeSpool`, acquire `SpoolIngester.open`, and invoke the helper as `HOOK STORAGE` from a trusted launcher. The helper validates configured scope/profile, publishes complete independent ready files and keeps one immutable identity across retries. The ingester uses bounded rescans plus periodic polling, validates ready records and syncs a segmented source journal before conditionally removing a ready file. Dead-process recovery requires the prior lease token and a provably absent PID. No active lease is stolen. Full spool drops new data; full journal stops accepting. Do not imply retention/automatic takeover is complete.

Source envelopes carry immutable receipt time, namespaced IDs and safe metadata/counters. The source journal is authoritative; `normalizeJournalRecord` derives event-v1 with its durable sequence. Rebuild `FileActivityStore` from journal records on startup; deduplication makes repeated application safe. Generic/specialized read evidence groups only by full namespace/call/kind; repeated same-kind calls or conflicting evidence stay ambiguous. After-file-edit remains an independent report. Persistence/acceptance and file actor remain unknown. Path hints are explicitly unresolved, not physical file keys.

Final checks passed: contracts/types/build, 41 unit tests, 10 process integration tests, Go tests/race detector and vet. Tests include SIGKILL after sync before acknowledgment, corruption recovery, filesystem substitution, concurrent publishers, loss of watcher notifications, call reuse/order, source scope, detail eviction and compiled-helper-to-projection restart/replay. Manual review fixed unsynced recovered-line acknowledgment, segment holes, shutdown/rescan races, immutable diagnostic time and retired-call ambiguity. No new Cursor native action or T08 UI was performed.

## T08 implementation handoff

See [native vertical slice](docs/t08-vertical-slice.md), [host results](docs/t08-extension-host-verification.json), and [native metadata fixture](tests/fixtures/cursor/t08-journey.json). Run `npm run supervision:launch`, then explicitly enable in the trusted fixture window. No automatic collection or global installation is introduced. The probe VSIX still excludes the production Go helper; use development mode for this slice until T24 packaging.

`PluginManager` serializes ownership transitions, exclusively creates project hooks, claims the T06 lease and toggles private publisher configuration. Disable stops cached publishers before conditionally deleting the exact owned hook inode/bytes. Modified/existing configs and live competing collectors are preserved. SecureDirectory stays private by default; existing owned non-group/other-writable fixture parent/hook directories can use the less restrictive directory mode. Automatic crash recovery/config merging remain future lifecycle work.

The native tree groups full source-session namespaces and shows age and evidence. A six-name fixture allowlist resolves hashed hints to safe local files; no arbitrary payload path or command URI opens. Trust, workspace and target are rechecked. Persistence, acceptance and child file ownership remain unknown. Reports contain bounded metadata and TreeItem request times, not source content or pixel-paint timing.

Final checks: strict contracts/types/build, 48 unit tests, 10 process integration tests and seven real Cursor extension-host checks passed. The native run produced 13 records, five operations and six first TreeItem request samples of 110–217 ms. Same-window visibility and intended-file selection were observed. Collection is off in the T08 fixture: hooks/lease absent, publisher false, inbox empty. After disable/reload a successful native read left journal count at 13. The fixture window is left for inspection. The isolated test host also cleaned up its owned integration. T09 is next; it was not started.
