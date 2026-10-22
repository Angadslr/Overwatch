# Event-v1 contract — T04

Implemented 21 October 2026. JSON Schema is the authoritative persisted shape: `schemas/event-v1.schema.json`. `src/core/contracts.ts` is generated; edit the schema and run `npm run generate:contracts`. `npm run check` rejects stale generated types and type-checks the project. Types describe fields/enums; runtime validation also enforces limits and cross-field constraints.

The complete synthetic normalized example is `tests/fixtures/core/event-v1.json`. It illustrates the product contract and is not a newly captured native event. The original probe fixtures retain their separate probe schema. Cursor-to-event mapping is implemented in T07; raw hook projection/response handling is T05. T06 ready files and the source journal use the separate `source-envelope-v1` contract; normalized events are derived views.

## Validation boundaries

`src/core/eventValidation.ts` exports:

- `parseEvent(json, stage = 'spool')`: strict UTF-8 wire validation. Rejects extra fields, invalid combinations, malformed JSON and oversized records. Returns a validated event or a fixed reason code; raw inputs and validator messages are never returned.
- `projectEventCandidate(candidate, stage = 'spool')`: copies only normalized schema fields, including nested targets/evidence/metrics, then validates. Unknown additive candidate/source fields are discarded without mutation or getter access. This does not map raw Cursor names or certify that a value placed into an allowed field is safe; source adapters must hash source identities and project safe fields before calling it.

Normalized pre-journal events must omit `ingestSequence`; normalized journal-stage events require a positive safe integer. This separates source receipt from collector ordering. `SpoolEventV1` and `JournalEventV1` expose the two normalized shapes; the `parseEvent` stage name `spool` is not the schema of actual T06 ready files. T06 assigns durable source-journal sequences; T07 derives event-v1 observations with that sequence through `normalizeJournalRecord`. Use source-envelope validation on actual spool bytes, then event-v1 validation on normalized facts.

The schema uses draft-07, local definitions only, an `overwatch-utc` format and an `x-maxUtf8Bytes` annotation. Other language implementations must enforce the annotation and UTC format explicitly; generic JSON Schema validators may ignore unknown formats/annotations. The TypeScript boundary checks bytes before JSON parsing and validates dates by exact ISO UTC round-trip. Ajv is pinned to 8.20.0 in the lockfile. [Ajv validation/type guards](https://ajv.js.org/guide/typescript.html), [JSON Schema object properties](https://json-schema.org/understanding-json-schema/reference/object).

## Evidence and identity

Every event declares activity provenance, attribution, completion, disk persistence and correlation independently. Attempts/starts/observations have unknown outcomes and cannot claim reported tool completion. Terminal phases require reported completion and matching outcomes: completed/success, failed/error-or-denied, cancelled/aborted. A failed operation can therefore remain distinct from an aborted turn.

Unknown attribution explicitly forbids actor and parent IDs but permits a source-session conversation ID; that ID alone does not prove a top-level or child actor. Conversation attribution requires a conversation ID. Child attribution requires explicit actor, parent and conversation IDs. The schema can represent proven child lifecycle relationships; it does not qualify the unavailable native child-to-file join.

`operationId` identifies the normalized operation/observation. `sourceCallId` retains an opaque source join key separately. Source-call correlation requires conversation and generation IDs. Missing scope can retain a call ID only as ambiguous; unpaired observations omit sourceCallId and use their own operation identity. T07 must partition joins by environment/root/conversation/generation/operation kind and preserve same-kind call reuse ambiguity.

Lifecycle facts identify conversation, generation or child scope. `stop` requires generation scope, so turn completion cannot be serialized as conversation closure. `sessionEnd` is reserved in the contract; its inclusion does not claim native delivery on the qualified build.

Cursor hook facts cannot claim observed disk persistence. Filesystem/buffer facts require unknown actor and observed phase; they do not imply tool completion. The schema does not infer acceptance from any of these fields. These constraints encode the T02/T03 evidence boundaries.

## Targets and bounds

| Dimension | Limit / rule |
| --- | --- |
| Serialized event | 65,536 UTF-8 bytes, enforced by the parsing boundary |
| IDs | 1–128 ASCII identifier characters; opaque values, not prompts/email/paths |
| Source version | 1–64 version/profile characters |
| Targets | At most 100; excess is rejected rather than silently truncated |
| Relative path | 1–1,024 Unicode code points; no absolute/drive paths, backslashes, control characters, empty/dot/traversal segments |
| Limitations | At most 16 distinct allowlisted codes |
| Duration | Finite 0–86,400,000 ms |
| Count / truncated targets | Nonnegative bounded integers |
| Ingest sequence | 1 through Number.MAX_SAFE_INTEGER, journal only |

Workspace targets require a file key and relative path. External-redacted targets cannot contain a relative path. Unresolved targets may lack a physical file key. Rename destinations use the same rules and appear only on rename operations. Environment/workspace/worktree scope namespaces file keys; the same relative path alone is not file identity. Physical canonicalization, symlinks, root containment and case rules remain T10; syntactic path validation is not a filesystem security check.

## Tooling and verification

The pinned editor types/engine remain 1.105.0 / `^1.105.0`, below the measured Cursor editor API 1.128.0. T04 uses no newer editor APIs. Node >=22 remains compatible with the qualified extension-host Node 24.19.0. No runtime dependencies contact a service.

Available commands: `generate:contracts`, `check:contracts`, `check`, `build`, `test:unit`, `test:integration`, and `package:probe`. The build emits a standalone `dist/event-contract.cjs` alongside the unchanged discovery entry points. Node's test runner remains the single test runner. Run all unit tests with `npm run test:unit`; this script does not forward arbitrary test path arguments.

T08 implements `test:extension` against the installed Cursor extension host and `supervision:launch` for the native fixture. Host tests use synthetic metadata; actual native evidence is recorded separately in [T08 verification](t08-vertical-slice.md). `package:alpha` remains a future T24 command, not an empty script or renamed probe package. T05 now adds the Go module, generated Go shape representation, `build:helper` and `test:helper`; see [helper pipeline](helper-pipeline.md). Generation/freshness checks cover both languages without requiring Go on PATH. Go shape types are not runtime validation, and the helper's safe raw-source envelope is separate from normalized event-v1.

Actual checks: generated-contract freshness, strict TypeScript, a clean bundle build, 23 unit tests, 5 real helper-process integration tests, and loading/validating the example through the standalone bundle all passed. Tests cover contradictory evidence, unknown-field privacy, source/journal stages, malformed/impossible timestamps, Unicode byte boundaries, array/string/count bounds, redaction, rename constraints and editor-free core imports. Cursor was not relaunched and no native agent run was needed for T04.
