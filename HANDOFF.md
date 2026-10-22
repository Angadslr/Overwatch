# Overwatch implementation handoff

Updated 21 October 2026 for Angad.

Build a local, observation-only extension for native Cursor source-session/file evidence, overlap advisories and bounded history. [plan.md](plan.md) defines the architecture; [todo.md](todo.md) tracks execution.

## Completed

T01–T03 and G0 passed for the reduced local observation profile. The repository contains a fixture-gated TypeScript/Node discovery probe, strict tooling, metadata projection, atomic publication and focused evidence/process tests. T04 now adds the event-v1 JSON Schema, generated TypeScript types, strict validator and allowlisted candidate projection. The production Go helper, journal and UI remain unimplemented; T05 is next.

T01 retains historical Cursor 3.25.9 evidence. T02/T03 qualified updated Cursor 3.26.16, commit `8fcb8ace5c73fa31f2e2707fd6783160e4ed3e40`, API 1.128.0, extension-host Node 24.19.0, macOS 26.5.2 arm64. Development Node/npm: 24.21.0/11.19.0. Go remains absent from PATH.

159 new native events and fifteen timing samples cover operations, failures/denial/abort, deliberate telemetry loss, simultaneous same-model chats, identical parallel children, two physical worktrees and two regular windows on one checkout. Thirteen hook kinds delivered. Read/edit repeated after reload. [Qualification](docs/phase-a-qualification.md), [compatibility](docs/compatibility.md), [action trace](docs/native-smoke-test.md), [accepted decision](docs/decisions/native-integration.md), and [fixtures](tests/fixtures/cursor/) contain exact evidence and limits.

## Constraints for the next implementer

- Select explicit project hooks on the qualified build; plugin registration API is unavailable. One canonical root has one producer/inbox and one collector owner; duplicate windows stay passive. Production lease, heartbeat, merge and recovery remain T06/T20/T21.
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

Collection is disabled in all three fixtures; all owned hook configs/markers and the temporary MCP config are absent. Final disabled native Read succeeded with main inbox unchanged at 184; worktree inboxes remain 19 and 16. Fixture windows are left for evidence inspection. No real project or user/global hooks changed. The main checkout has no Git repository/remote; no commit, publication or release was created. T05 is the next task.

## T04 implementation handoff

See [event contract](docs/event-contract.md). Edit the schema, run `npm run generate:contracts`, and verify with `npm run check`. `parseEvent` strictly validates persisted bytes; `projectEventCandidate` strips unknown candidate fields without replacing T05/T07 source-specific mapping. Spool input omits ingestSequence; journal input requires it. Source-call joins require explicit scope and a separate sourceCallId; unpaired facts remain separate. Core modules have no editor/Node imports. Schema representations include reserved capabilities without advertising native support.

Ajv is pinned to 8.20.0. Clean build, 23 unit tests, 5 integration tests and standalone bundle smoke passed. No additional Cursor agent runs or hook setup occurred. Go code generation is deferred until the T05 helper module exists. Editor-host tests/alpha packaging remain T08/T24.
