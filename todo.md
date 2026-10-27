# Cursor Agent Supervision — execution checklist

Prepared for Angad · 20 October 2026.

Execution started 21 October 2026. T01–T21, T23, G1, G2a and engineering checkpoint G2b are complete. G0 passed on 21 October for a reduced local observation profile on Cursor 3.26.16/macOS arm64; T01 also retains historical 3.25.9 evidence. Unsupported child-to-tool joins, session-end delivery, shell/MCP file internals, and acceptance inference remain explicit. T04 supplies the normalized contract; T05–T07 supply the Go privacy pipeline, bounded durable transport and read/edit evidence projection. The native fixture tree, persistent source-session aliases and local canonical path service are implemented. T11 now separates conversation, generation and operation lifecycles, replay liveness and collector/source health. T12 now adds independent bounded disk/editor observations with unknown actor and explicit partial coverage. Native collection remains fixture-gated. T13 enforces a versioned helper privacy policy and redacted diagnostics; T14 adds consistent Conversations/Files views and recent Explorer badges. T15 adds chronological activity, shared filters, frozen display and read-only inspection with a terminal-controllable placement setting. T16/T17 add qualified overlap rules and local attention controls; the native profile remains explicitly unqualified for physical overlap. T18 adds layered Source Health and a diagnostic-only helper/collector self-check. T19 adds bounded journal retention, crash-safe pruning and validated replay checkpoints. T20 adds passive duplicate-window handling, conservative stale-lease recovery and persistent enable choice across normal reload. T21 adds opt-in existing-hook preservation, exact private backups and conditional restoration. T23 adds reviewed local export and scoped history reset with collector-generation fencing. T22 now reconciles the full production broker burst but remains open for near-cap/shared-host memory, idle CPU and burst helper latency; G3/T24 are gated on those findings. This file tracks execution, not completion of the planning request. Follow [plan.md](plan.md) for architecture and product semantics and [HANDOFF.md](HANDOFF.md) for scope.

## Execution conventions

One implementation owner can complete the personal alpha. Responsibility labels below define module ownership; they do not request parallel agents. Keep each task to one focused implementation session where practical. If a task grows beyond five implementation files or roughly two hours of focused agent work, split it while preserving its acceptance criteria and dependencies.

Each task must leave usable code or a concrete discovery artifact. Check it off only after its acceptance criteria and verification pass. Record actual command results and native test build/date beside completion; never copy proposed results into the record.

Repository script contract established in T04: `npm run check` verifies generated-contract freshness and strict types; `npm run build` bundles implemented TypeScript entry points; `npm run test:unit` runs deterministic core/probe/transport tests; `npm run test:integration` builds and runs actual Node/Go helper-process tests. `npm run generate:contracts` updates schema-derived types and `npm run check:contracts` checks drift. `npm run test:extension` runs the actual installed Cursor extension host with isolated synthetic fixtures; `npm run supervision:launch` launches the T08 native fixture. `package:alpha` remains reserved for T24; no empty scripts are created. `npm run package:probe` packages only the discovery extension. The unit runner does not forward arbitrary test-path arguments. `npm run build:helper` and `npm run test:helper` select the local toolchain or Go on PATH; direct helper verification uses `go test ./...` from `helper/`. Real Cursor smoke runs remain separate from automated tests; T04–T07 required no additional native agent use. See [event contract](docs/event-contract.md).

## Phase A — prove the native integration

### T01 — Prove hook-bearing plugin registration in Cursor

**Owner:** Cursor integration. **Dependencies:** None. **Scope:** M, 3–5 files. **Budget:** 0.5–1 day for discovery, split further if needed.

**Description:** Create the smallest development extension and probe plugin needed to test the documented registration surface in Angad’s installed Cursor. Record actual versions, extension host API level, platform, trust state, command launch behavior, and plugin discovery. Use an invented fixture repository.

**Acceptance criteria:**

- [x] A native Agent Chat action invokes the registered probe, or the report records a reproducible unsupported result and the explicit project-hook fallback result.
- [x] Registration/unregistration, new/existing conversations, executable path quoting, and required reload behavior are documented without assuming CLI equivalence.
- [x] The report distinguishes documented behavior, observed behavior, and unresolved questions, including the initial supported OS/architecture.

**Verification:** Install the local probe package in Cursor, run one deliberate native file operation, disable it, and verify no remaining probe invocation. Do not use an editor API mock as proof of native delivery.

**Files likely touched:** `package.json`, `src/host/capabilities.ts`, `src/integration/probe.ts`, `docs/compatibility.md`, `tests/fixtures/cursor/probe.json`.

**Completion record — T01 completed on 21 October 2026:**

- Implemented strict TypeScript tooling, the development extension, capability/trust/fixture gates, generated plugin source, bounded discovery helper, fixture launcher, and exclusive project-hook fallback. Tooling, transport and native capture were separate focused slices; the full UI was not started.
- Actual host: Cursor 3.25.9, macOS 26.5.2 arm64, editor API 1.128.0, extension-host Node 24.18.1, trusted local fixture.
- Preferred API unavailable. Project fallback delivered 47 projected native events across three sequential source conversations, including one captured cleanup regression, including reads/edits, failed read, session start and turn stop. Quoted paths with spaces and the fixture-root working directory worked.
- Reload removed owned hooks; a subsequent native read succeeded with event count unchanged at 10. Explicit reenable worked. Final disable removed the generated config. Automated tests cover preserving existing and later-modified configs.
- Validation: `npm run check`, `npm run build`, `npm run test:unit`, `npm run test:integration`, `npm run probe:environment`; actual actions and fixtures are in `docs/native-smoke-test.md` and `tests/fixtures/cursor/`.
- Packaged verification: `npm run package:probe` produced a local machine-specific VSIX, finally version 0.0.2. Contents inspection excluded local data/source/tests/dependencies. Supported Cursor CLI installation succeeded; a regular host reported production extension mode and emitted ten native events using the installed helper. The first package exposed a cached-hook cleanup failure after plain hot removal. Version 0.0.2 adds an enabled marker and explicit disable-and-reload; its native replay passed, a subsequent new native session left the count unchanged at 47, both config and marker were absent, and CLI uninstall succeeded. Checksum and actual record: `docs/probe-package-verification.json`. Plugin registration scope/removal remains unavailable on this build; it is not inferred from the fallback.

### T02 — Capture operation and lifecycle evidence fixtures

**Owner:** Cursor adapter. **Dependencies:** T01. **Scope:** M, 3–5 files or fixture groups.

**Description:** Exercise known file read/edit/create/delete/rename, failure, denied/aborted actions, shell/MCP activity, and turn/session boundaries. Determine which are observable and which source fields can pair operations. Capture only invented-content payloads and sanitize before committing fixtures.

**Acceptance criteria:**

- [x] The operation matrix includes successful, failed, missing-completion, and out-of-order examples with exact observed identifiers and field shapes.
- [x] Buffer edits, saved disk bytes, Keep/Undo, and tool completion are compared in a timing trace without claiming unsupported equivalence.
- [x] Every proposed installed hook has a tested minimal valid observation response; raw content is absent from committed fixtures except explicitly invented test markers used for privacy tests.

**Verification:** Review each fixture against the native action trace and validate its shape. Repeat one read/edit pair after reload. Mark missing operations unsupported rather than filling gaps with hypothetical payloads.

**Files likely touched:** `docs/compatibility.md`, `docs/native-smoke-test.md`, `tests/fixtures/cursor/operations.json`, `tests/fixtures/cursor/lifecycle.json`, `tests/fixtures/cursor/failures.json`.

**Completion record — T02 completed on 21 October 2026:** Captured native Read/Write/create/failure, shell rename/delete/cat/redirection, a fixed-file stdio MCP call, independent gate denial, cancellation, and deliberate collection loss. `stop(aborted)` arrived before its tool failure; the outage retains a start without a terminal despite native success. Fifteen buffer/disk samples distinguish dirty state, auto-save, native edit reports, Keep and Undo. Read/edit repeated after reload. Thirteen hook kinds delivered; `sessionEnd` was not observed on secondary-window close and remains unavailable. All 14 configured discovery hooks have exact child-process stdout tests; the alpha candidate omits unqualified session-end tracking. See `docs/phase-a-qualification.md`, `field-profile.json`, and the operations/failures/lifecycle/timing fixtures. No hypothetical source payloads fill missing cases.

### T03 — Resolve concurrent attribution and integration scope

**Owner:** Identity/integration. **Dependencies:** T01, T02. **Scope:** M, 3–5 files.

**Description:** Run two top-level conversations using the same model, two similar child agents, two worktrees, and two windows over one checkout. Establish supported identities, plugin scope, duplicate producer behavior, and a viable one-producer routing strategy.

**Acceptance criteria:**

- [x] Top-level conversations are distinguishable, and child-to-tool attribution is either proven by source joins or explicitly classified as unavailable.
- [x] Same relative paths in different worktrees remain distinct; duplicate windows have a documented collection policy.
- [x] A decision record selects plugin registration or explicit project hooks and establishes one effective producer per enabled workspace; no CLI substitution is introduced.

**Verification:** Inspect sanitized simultaneous traces and demonstrate no identity assignment based solely on model, task text, process PID, or recent start time.

**Files likely touched:** `docs/compatibility.md`, `docs/decisions/native-integration.md`, `tests/fixtures/cursor/concurrency.json`, `tests/fixtures/cursor/worktrees.json`, `tests/fixtures/cursor/windows.json`.

**Completion record — T03 completed on 21 October 2026:** Two same-model native chats overlapped with distinct stable conversation keys. Two identical parallel explore children produced linked Task/lifecycle IDs, but file-tool conversation keys lacked a retained source join; child-to-tool ownership is unavailable. Two real Git linked worktrees produced distinct physical-root hashes and different disk hashes for `shared.txt`. Two regular windows over one checkout shared one generated config/inbox; second enable refused replacement, its read appeared once, and closing it preserved the owner's config/marker. The owner read and cleaned up successfully afterward. `docs/decisions/native-integration.md` selects explicit project hooks, one root-scoped producer and one collector owner with passive secondary windows; production leases/recovery remain T06/T20/T21, not implemented by discovery.

### Checkpoint G0 — native feasibility

- [x] Native local conversations produce enough evidence for a useful conversation/file view.
- [x] Minimum supported Cursor build/platform and reduced-capability fallback are named.
- [x] Registration, attribution, response behavior, and scope findings are reflected in the plan before building the full UI.

If G0 fails, finish the capability report and document the required upstream feature. Do not execute later UI work as though native supervision were proven.

**G0 review — passed, 21 October 2026:** Useful native file evidence is feasible on Cursor 3.26.16, API 1.128.0, macOS 26.5.2 arm64. Scope is metadata-only and source-session based; unjoinable child sessions remain unlinked, and no session-end/acceptance/shell-internal claim is made. Production schema, helper, collector leases, journal and UI remain later tasks. Validation: type check/build, 15 unit tests and 5 child-process integration tests passed. The fixture-only probe VSIX 0.0.3 installed and uninstalled successfully; all three fixture hook files/collection markers and the temporary MCP config are absent. Final disabled native read succeeded with main inbox unchanged at 184. No real project or user/global hook config changed.

## Phase B — first complete file-supervision slice

### T04 — Establish project tooling and the normalized contract

**Owner:** Core/tooling. **Dependencies:** G0. **Scope:** M per subtask; split tooling from schema if needed.

**Description:** Establish a minimal extension build/test setup and a versioned event contract based on captured capabilities. Define evidence dimensions, identity scope, path targets, unknown values, and limits. Pin dependencies compatible with the qualified Cursor host.

**Acceptance criteria:**

- [x] Proposed verification scripts exist and a clean build runs against the chosen extension API level.
- [x] Event-v1 schema and TypeScript representation validate a complete example and reject invalid enum/size combinations.
- [x] Core contracts have no editor imports and explicitly represent attempts, terminal evidence, unknown actor, and unknown persistence.

**Verification:** Type check/build and focused schema tests, including unknown additive source fields without retaining them. Inspect the package engine requirement against T01.

**Files likely touched:** `package.json`, `tsconfig.json`, build config, `schemas/event-v1.schema.json`, `src/core/contracts.ts`. Add lockfile as the normal tool-generated artifact.

**Completion record — T04 completed on 21 October 2026:** Added draft-07 `schemas/event-v1.schema.json`, generated editor-free TypeScript contracts, strict UTF-8/stage validation and allowlisted candidate projection. The contract separates attempts, terminal outcomes, unknown actors/persistence, lifecycle scope, source call identity and physical target scope. Schema-derived types are checked for drift. Pinned Ajv 8.20.0 with lockfile; editor types/engine remain 1.105.0 / `^1.105.0`, compatible with the measured host API 1.128.0. Clean build, 23 unit tests, 5 process integration tests and standalone bundled-example validation passed. Exact byte limits, invalid enum/evidence combinations and unknown additive fields have focused tests. Existing build/test commands cover current implementations; reserved editor-host/alpha command names remain T08/T24 as specified above. See `docs/event-contract.md`. No native hook configuration changed and T05 was not started.

### T05 — Implement bounded metadata projection and hook responses

**Owner:** Native helper. **Dependencies:** T02, T04. **Scope:** M, 4–5 files.

**Description:** Build the Go helper input pipeline, allowlist projection, event identity generation, and event-specific response handling. Add no network behavior. Distinguish input parse failures from source action outcomes.

**Acceptance criteria:**

- [x] Invented contents, prompts, commands, tool results, user email, and reasoning never appear in projected events or logs.
- [x] Every configured hook emits exactly one valid response on stdout, including malformed/oversized input and internal telemetry errors.
- [x] Bounded inputs and unknown fields produce safe metadata/gap counters without unbounded memory or accidental action denial.

**Verification:** `go test ./...`; child-process tests assert exact response JSON, exit behavior, stderr scrubbing, and absence of fake secret markers.

**Files likely touched:** `helper/go.mod`, `helper/cmd/cursor-supervision-hook/main.go`, `helper/internal/input/project.go`, `helper/internal/output/respond.go`, corresponding helper tests.

**Completion record — T05 completed on 22 October 2026:** Implemented the standard-library Go helper, 32 MiB input / 16 KiB projection bounds, depth/key/field limits, duplicate-key rejection, hashed identities/path hints, UUID v4 event identity, safe coverage counters and event-specific responses before telemetry. Input/consumer work has a 1,500 ms process budget; consumer errors/panics cannot alter the response. Source outcomes remain separate from parse gaps. Contract tooling now generates matching Go shapes and checks both languages for drift. Split into input/response and shared-contract/tooling slices with focused tests; see `docs/helper-pipeline.md` for the high-rigor review and resolved findings. Go 1.27.3 darwin/arm64 was downloaded into ignored local storage and checksum-verified. Helper build, `go test ./...`, race checks, `go vet`, a 10-second fuzz run (468,699 executions), existing strict TS checks, 23 unit tests, build and 5 probe integration tests passed. All 14 response kinds have compiled child-process coverage, including malformed/oversized input and unreadable stdin; consumer failure injection is in-process. Probe package inspection excludes the new sources/binary and local tool metadata. The CLI currently discards safe telemetry through an unconnected consumer seam: publication/transport is T06, normalized operation interpretation T07, visible/canonical paths T10. No new native delivery claim or hook configuration change; T06 was not started.

### T06 — Publish and ingest metadata through the local spool

**Owner:** Transport. **Dependencies:** T05. **Scope:** M; separate helper and extension halves if required.

**Description:** Implement per-event atomic publication, schema validation, bounded rescans, and acknowledgment only after durable journal acceptance. Establish one collector’s ownership without a public listener.

**Acceptance criteria:**

- [x] Concurrent helper processes publish complete independent files, and the ingester rejects partial/oversized/non-regular or unsupported files.
- [x] Retrying a published event reuses its ID, and duplicate delivery affects projections once.
- [x] Spool permission/full/absent-consumer failures remain bounded and do not change the helper’s observational response.

**Verification:** Helper tests plus transport integration tests with concurrent publishers, forced process exit, lost watcher notifications, symlink substitution attempts, and malformed filenames.

**Files likely touched:** `helper/internal/spool/publish.go`, `src/transport/spoolIngester.ts`, `src/transport/journal.ts`, transport tests.

**Completion record — T06 completed on 22 October 2026:** Implemented descriptor-confined Go publication with immutable retry identity, private configuration/root-scope validation and atomic no-replace ready names. Added strict source-envelope schema/types, collector ownership, bounded rescan/polling, synced segmented source journal, conditional acknowledgment, deduplication and conservative recovery. Helper and extension halves were separate focused implementation slices. Manual review fixed recovered-unsynced-line acknowledgment, segment-hole detection and publisher replacement/decoder bounds; see `docs/local-transport.md`. Go tests/race checks, TypeScript checks/build, 29 unit tests and 9 real-process integration tests passed, including 32 concurrent helpers and collector SIGKILL after sync before acknowledgment. Full spool drops new telemetry; full journal stops accepting rather than evicting unacknowledged data. Retention, automatic lease takeover and native UI wiring remain later tasks. No native hook configuration changed. T07 mapping/reducer follows under Angad's explicit continuation request.

### T07 — Map native read/edit events into a file projection

**Owner:** Cursor adapter/core. **Dependencies:** T04, T06. **Scope:** M, 3–5 files.

**Description:** Normalize the measured read/edit variants and build a small file-activity reducer. Preserve call IDs, conversation scope, attempts, completions, and edit reports separately.

**Acceptance criteria:**

- [x] T02 fixtures map deterministically to normalized facts with the correct evidence dimensions.
- [x] A pre-read alone never becomes completed; an edit report alone never becomes saved/accepted.
- [x] Generic and specialized observations are joined only by a proven identity, with repeated legitimate actions retained.

**Verification:** Focused adapter/reducer tests covering success, denied, missing call ID, repeated reads, completion-before-start, and unknown output grammars.

**Files likely touched:** `src/adapters/cursorHooks.ts`, `src/core/reducers.ts`, adapter tests, reducer tests.

**Completion record — T07 completed on 22 October 2026:** Implemented validated Cursor-to-event-v1 normalization and a bounded replayable file-evidence store. Generic/specialized read evidence joins only by complete namespace/call/kind; same-kind reuse, conflicting targets and repeated terminal evidence stay ambiguous. Read attempts, source-reported completion and unpaired edit reports remain separate, with unknown persistence/acceptance and no inferred child file ownership. Added hashed nested path hints with conflict handling and an immutable source-envelope receipt timestamp for diagnostic replay. Detail eviction retains deduplication and call-ambiguity tombstones; review also fixed queued-rescan shutdown ordering. Strict types/contracts/build, 41 unit tests, 10 real-process integration tests and Go tests/race/vet passed. Captured T02/T03 fixtures and an actual compiled-helper → spool → journal → reducer → restart/replay test cover evidence/privacy/idempotence. See `docs/cursor-file-projection.md` for review and boundaries. Source-hint targets remain unresolved until T10; T08/native UI was not started. No real-project hook changes or new native-delivery claim.

### T08 — Show one native read/edit journey inside Cursor

**Owner:** Editor UI/integration. **Dependencies:** T01, T06, T07. **Scope:** M, 3–5 files.

**Description:** Connect the owned plugin and helper to the ingester and render an initial native tree with file activity. This is the first usable vertical slice and the basis for further validation.

**Acceptance criteria:**

- [x] A normal native conversation’s fixture read/edit appears in the same Cursor window with identity, relative path, evidence, and age.
- [x] Selecting the entry opens the intended current file or gives an accurate missing-file result.
- [x] Enable/disable starts and removes only the extension’s integration; collection requires workspace trust.

**Verification:** Build and extension-host tests, followed by a named native Cursor smoke run. Record actual hook-to-visible latency without claiming the final performance target yet.

**Files likely touched:** `src/extension.ts`, `src/integration/pluginManager.ts`, `src/ui/files.ts`, `src/commands.ts`, `package.json`.

**Completion record — T08 completed on 22 October 2026:** Connected owned project hooks, Go helper, durable ingester and a native TreeDataProvider. Fixture-only path mapping safely opens known current files or reports missing/unsafe targets; general identity remains T10. Enable requires trust, refuses existing hooks/competing ownership, and disable stops publishers before exact-owned config cleanup. Implementation was split into integration/UI and host/native verification slices. Strict contracts/types/build, 48 unit tests, 10 process integration tests and seven actual Cursor extension-host checks passed. The named ordinary native Agent Chat read/edit run on Cursor 3.26.16/API 1.128.0/Node 24.19.0 produced 13 journal records and five visible operations across two files. Selection opened the intended current file. Six receipt-to-TreeItem-request samples ranged 110–217 ms; first screen observations bounded read visibility below 17 seconds and edit-report visibility below 14 seconds including automation delay, not pixel-paint latency or performance percentiles. Disable/reload removed owned hooks/lease, left publisher disabled, and a successful native read left the journal unchanged at 13. See [T08 verification](docs/t08-vertical-slice.md), [native fixture](tests/fixtures/cursor/t08-journey.json) and [host checks](docs/t08-extension-host-verification.json).

### Checkpoint G1 — first useful vertical slice

- [x] Read/edit telemetry is native, visible inside Cursor, and evidence-labelled correctly.
- [x] Collection path, stdout contract, and file opening pass without content retention.
- [x] Compare actual effort/overhead with the estimate and revise remaining tasks if needed.

**G1 review — passed, 22 October 2026:** The native slice is useful and evidence-labelled, with source-session identity and no content retention in telemetry. The installed-host suite uses synthetic metadata and is explicitly separate from native delivery evidence. Manual review corrected the native container identifier, event forwarding and test-profile storage isolation. The initial 3–5-file estimate was too small for ownership/trust boundaries plus two distinct verification layers; work was split as above. The native pair completed in about five seconds and the disabled read in about two seconds; neither measures hook overhead. No CPU, memory, p95 paint-latency or comparative overhead result is claimed. Keep T09/T10 focused on identity and paths, retain T13 for the full view and T20/T21 for lifecycle recovery; do not expand the fixture bridge into a general path policy. T08 is complete; T09 is next and has not been started.

## Phase C — trustworthy identity, lifecycle, and coverage

### T09 — Add stable conversation and qualified child identities

**Owner:** Core identity. **Dependencies:** T03, T07. **Scope:** M, 3–4 files.

**Description:** Namespace source IDs by collector/environment, retain stable local aliases, and represent proven parent/child relationships without assigning ambiguous child tools.

**Acceptance criteria:**

- [x] Concurrent same-model conversations never merge and retain aliases across turns/reload.
- [x] Proven child edges render correctly; missing join evidence stays at conversation or unknown scope.
- [x] Model/task text/PID/timing are never used as substitute unique identities.

**Verification:** Replay concurrency and child fixtures, including two indistinguishable child descriptions and an unjoinable child stop.

**Files likely touched:** `src/core/identity.ts`, `src/core/reducers.ts`, identity tests, `src/ui/conversations.ts`.

**Completion record — T09 completed on 23 October 2026:** Added editor-independent scoped identity keys and bounded local Session N aliases, persisted through workspace mementos and restored independently of replay order. The manager observes every normalized journal fact; the native tree now renders aliases and proven child lifecycle rows, including lifecycle-only sessions. Child file sessions with no retained source join stay separate and file actor scope stays unknown. Conflicting explicit parents/terminal reports remain ambiguous; no model, task text, PID or timing matching is used. Captured T03 concurrency/child fixtures, reordered state restoration and cross-collector/environment/root/worktree cases pass. The actual installed Cursor extension-host regression includes alias and child TreeItem assertions. See [identity/path implementation and review](docs/identity-and-paths.md).

### T10 — Canonicalize file, root, and worktree identity

**Owner:** Path identity. **Dependencies:** T03, T04. **Scope:** M, 3–5 files.

**Description:** Implement physical identity, relative display paths, root containment, symlink handling, new/deleted targets, case behavior, and environment separation.

**Acceptance criteria:**

- [x] Multi-root containment picks the correct root, traversal is rejected, and external targets are redacted/unknown by policy.
- [x] Symlink aliases and case rules behave as qualified on the target filesystem; unresolved identities do not silently merge.
- [x] Identical relative names in separate worktrees or environments remain distinct physical files.

**Verification:** Focused tests with spaces, Unicode, nested roots, existing and missing parents, symlinks, rename targets, and case-sensitive/case-insensitive fixtures.

**Files likely touched:** `src/core/paths.ts`, `src/core/identity.ts`, path tests, worktree tests.

**Completion record — T10 completed on 23 October 2026:** Added pure path policy plus a local filesystem adapter with canonical roots, longest-root containment, environment/worktree-qualified location keys, safe relative targets, preserved lexical display locators, root/target substitution checks, internal symlink resolution, independent rename endpoints and bounded exclusions. Missing/new/deleted targets resolve existing parents but receive no physical key. External/excluded paths are redacted; dangling/cyclic/cross-root aliases are refused. The existing fixture opener now uses the service while retaining its stricter no-symlink and six-name native gate. General source path discovery and native multi-root collection are not enabled; irreversible historical hints remain unresolved. Actual macOS volume tests qualified case-insensitive canonical spelling; deterministic filesystem fixtures cover both case rules without global lowercasing. Strict types/contracts/build, 68 unit tests, 10 real-process integration tests and nine actual Cursor extension-host checks passed. Host input is synthetic and does not replace T08 native delivery evidence. All test publishers are disabled with owned hooks/leases absent. Review fixes and exact boundaries: [identity/path implementation](docs/identity-and-paths.md), [host result](docs/t09-t10-extension-host-verification.json). T11 has not started.

### T11 — Implement independent conversation, turn, and operation lifecycles

**Owner:** Core reducers. **Dependencies:** T09, T10. **Scope:** M, 3–4 files.

**Description:** Add generation-aware terminal transitions, missing-start handling, aged unknown completion, and reload semantics. Keep source coverage independent from transport readiness.

**Acceptance criteria:**

- [x] Turn completion leaves its conversation available; a new generation does not reopen completed operations from the old one.
- [x] Out-of-order events never regress terminal state, and absent completion never becomes success.
- [x] Reloaded open operations show unknown live state; health reports awaiting-first-native-event separately from helper readiness.

**Verification:** Deterministic reducer tests using a fake clock for aging, late completion, terminal duplicates, generation reuse, and reload.

**Files likely touched:** `src/core/reducers.ts`, `src/core/health.ts`, lifecycle tests, health tests.

**Completion record — T11 completed on 24 October 2026:** Implemented bounded independent conversation/generation lifecycle projections, operation live-state labels with an injectable clock and the planned 30-second aging threshold, and collector readiness/delivery/coverage health. A turn stop affects only its complete namespace/generation; conversation records stay available and pending operations stay unresolved. Matching late terminals resolve requests; duplicate IDs are idempotent, repeated operation terminals preserve ambiguity, and late requests cannot regress reported starts/terminals. Replay and delayed pre-enable spool records cannot verify fresh delivery; replayed open operations remain live-unknown while terminal facts survive restart. Native tree labels/tooltips and bounded collection reports expose these dimensions. Failed cleanup reports disconnected/unknown and cannot be acknowledged as a ready re-enable. Work was split into core semantics and editor integration/verification slices. Strict generated contracts/types/build, 89 unit tests, 10 real helper-process integration tests and 14 installed Cursor extension-host checks passed (API 1.128.0, Node 24.19.0). Host input is synthetic, with nativeDelivery false; T08 remains native delivery evidence. Test publishers are disabled, owned hooks/leases absent and inboxes empty. See [T11 lifecycle/health implementation](docs/lifecycle-and-health.md) and [host result](docs/t11-extension-host-verification.json). T12 has not started.

### T12 — Add honest disk and editor-buffer observations

**Owner:** File observation adapter. **Dependencies:** T10, T11. **Scope:** M, 3–4 files.

**Description:** Observe eligible disk and buffer changes as independent facts. Avoid mapping editor-open events to agent reads or attributing formatters to recent agents.

**Acceptance criteria:**

- [x] User/formatter writes appear with unknown actor unless independent source evidence proves one.
- [x] Dirty buffers and saved disk changes are distinct, and opening a file does not produce an agent-read claim.
- [x] Watchers are scoped/excluded, disposed correctly, and disclose overflow or missed coverage.

**Verification:** Editor-host tests for unsaved edits, save, external rewrite, delete/create bursts, excluded paths, and watcher disposal.

**Files likely touched:** `src/adapters/fileObservations.ts`, `src/core/reducers.ts`, observation tests, extension tests.

**Completion record — T12 completed on 24 October 2026 (Pacific):** Added owned recursive fixture watchers, file-scheme buffer/save bindings, a bounded metadata-only queue and an independent local observation store/tree group. All local facts have unknown actor, no conversation/call attribution and no inferred operation success or saved byte version. Opening a file creates neither an agent read nor a buffer-change claim. Dirty buffers, editor-save reports and disk notifications remain distinct. Cursor can publish content changes before its dirty-state update; bounded URI/version tracking handles later metadata-only dirty transitions without retaining text. Exclusions run before queuing and after canonical resolution, with no raw error retention. Scope/trust gates, cancellation, ownership generations and disposal prevent late callbacks crossing disable/re-enable. Queue/tracking capacity gaps, errors, history eviction and intrinsically partial watcher coverage are exposed. Local history is bounded host memory, with at most 100 rows/reported records, not automatic source-journal persistence. Work was split into observation core, editor lifecycle wiring and actual host verification. Strict contracts/types/build, 101 unit tests, 10 real-process integration tests and 21 installed Cursor host checks passed (API 1.128.0, Node 24.19.0). Actual editor operations covered unsaved edit, save, formatter, independent rewrite, five-file create/delete burst, exclusions, safe current-file opening and disposal. Native Agent hook regression input remains synthetic; nativeDelivery false does not mean local watcher/editor events were mocked. Owned test collectors/watchers finished stopped, hooks/leases absent and inboxes empty. See [T12 observation implementation](docs/file-observations.md) and [host result](docs/t12-extension-host-verification.json). T13 has not started.

### T13 — Complete metadata-only privacy enforcement

**Owner:** Privacy/core. **Dependencies:** T05, T10, T12. **Scope:** M, 3–5 files.

**Description:** Apply exclusion policies before spool persistence, align helper/extension policy versions, and ensure source exception paths cannot bypass the allowlist. Add explicit coverage reasons for exclusions.

**Acceptance criteria:**

- [x] Secret-like paths and user exclusions do not enter spool, journal, checkpoints, logs, or default diagnostics.
- [x] Unknown source fields and fake secret-bearing exceptions are omitted while safe event/health metadata remains useful.
- [x] Missing or stale helper policy uses a privacy-preserving fallback and discloses reduced collection rather than capturing extra data.

**Verification:** Adversarial invented fixtures and byte searches over all generated artifacts; check both initial projection and error/recovery paths.

**Files likely touched:** Helper projection/policy modules, `src/core/privacy.ts`, privacy tests, `docs/privacy.md`.

**Completion record — T13 completed on 25 October 2026 (Pacific):** Added a private versioned hash allowlist compiled from default/custom exclusions, helper filtering before path-hint projection, policy revalidation before publication, current-policy journal admission and privacy-aware replay. Changing workspace exclusions synchronously restricts admission and clears affected UI/local history, then stops collection; invalid settings fail closed. Missing/stale policies publish only coarse safe diagnostics with explicit reduced-collection health counters. Unknown fields/exceptions remain dropped. Default reports omit all local path locators/file keys. The legacy discovery entrypoint is response-only and its content-derived editor timing listener is retired. Legacy publisher upgrades require an owned lease; older helpers reject the new configuration shape. Adversarial process tests search publisher/inbox/journal bytes and replay recovery for invented secrets, default/custom/mixed exclusions, symlinks and absent/stale policies. Historical immutable hashes are filtered on replay, not retroactively deleted. See [privacy implementation](docs/privacy.md).

### Checkpoint G2a — trustworthiness

- [x] Actor, file, environment, lifecycle, and evidence distinctions survive replay.
- [x] Missing child identity and shell-internal activity remain visibly unqualified.
- [x] Default persistence passes the fake-secret and excluded-path tests.

## Phase D — supervision interactions

### T14 — Build conversation/file trees and Explorer badges

**Owner:** Editor UI. **Dependencies:** T08–T13. **Scope:** M, 4–5 files.

**Description:** Complete the primary tree views, stable aliases, recent-activity labels, and affected-URI-only decorations. Render multiple actor participation without unsupported Explorer animation.

**Acceptance criteria:**

- [x] Conversations and files provide consistent counts, hierarchy, evidence, age, and physical-worktree labels.
- [x] Badges follow documented priority and include text/icon/tooltips suitable for high-contrast use.
- [x] Updates are batched, do not steal focus, and clear stale live emphasis without falsifying completion.

**Verification:** Extension tests plus keyboard/high-contrast manual review in Cursor at representative event volume.

**Files likely touched:** `src/ui/conversations.ts`, `src/ui/files.ts`, `src/ui/decorations.ts`, UI tests, contribution configuration.

**Completion record — T14 completed on 25 October 2026 (Pacific):** Added Files alongside Conversations, sharing the same operation rows, scoped aliases, evidence, ages and counts. File groups distinguish source path hints, physical samples and unresolved local locators; root/environment/worktree labels remain explicit. Badges use attention/edit/read/uncertainty priority, theme colors and text/tooltips; only changed/removed URIs emit after batched updates. Current eligibility and policy are checked again before decoration publication. Recent emphasis expires after 30 seconds while terminal history remains intact. Verified 200-session count consistency, editor focus preservation, real elapsed badge expiry, setting-driven privacy stop/replay/report behavior and cleanup in the installed Cursor host. A separate 200-session fixture received manual keyboard, high-contrast and Explorer W/tooltip review; theme restored and owned collector/window cleaned up. Contracts/types/build, 110 unit tests, 11 actual helper-process tests, Go tests/race checks and 25 installed-editor checks passed. No new ordinary native Agent turn or broader native collection is claimed. See [views and review](docs/supervision-views.md), [host/manual verification](docs/t13-t14-extension-host-verification.json), and [high-contrast capture](docs/t14-high-contrast.png). T15 has not started.

### T15 — Add activity inspection, filters, and frozen display

**Owner:** Activity UI. **Dependencies:** T14. **Scope:** M, 3–5 files.

**Description:** Add the chronological activity list, conversation/operation/time/evidence filters, file details, and view-freeze mode. Keep collection independent from display refresh.

**Acceptance criteria:**

- [x] Selecting an activity shows source, evidence, operation identity, timestamps, file scope, and explicit unknowns.
- [x] Filters produce consistent results across list/tree views and can be cleared without losing events.
- [x] Freeze mode clearly states collection continues, and resume shows events received while frozen without implying agent pause.

**Verification:** Replay a multi-conversation fixture and test filtered counts, missing/deleted targets, follow-latest off, focus preservation, and freeze/resume.

**Files likely touched:** `src/ui/activity.ts`, `src/ui/details.ts`, `src/commands.ts`, activity tests, view-state module.

**Completion record — T15 completed on 25 October 2026 (Pacific):** Added chronological Activity rows, scoped conversation/operation/time/evidence filters shared with Conversations/Files, and a bounded 5,000-event presentation snapshot. Freeze holds rows, ages and evidence while collection continues; incoming event counts and resume are explicit, and Explorer remains live. Follow latest defaults off and optional reveal never changes editor focus or selection. Selecting source/local activity opens the eligible current file plus a read-only metadata inspector with source/identity/timestamps/scope/independent evidence and explicit unknowns. Missing/deleted files open details without recreation or changing historical completion. Details reuse one friendly virtual tab, check current policy/workspace/trust, and cancel/clear on privacy changes. `agentSupervision.detailsBeside` defaults true, can be toggled through the Command Palette/Activity toolbar, and can be changed from the terminal with `npm run supervision:details -- toggle|beside|current|status --workspace PATH`. The JSONC edit preserves comments/unrelated settings and refuses malformed, duplicate, symlinked, replaced or locked settings. Work was delivered in presentation-state, inspection/placement, terminal and verification slices. Review corrected filtered locators/aggregate qualification, in-flight privacy invalidation, open-failure availability and duplicate details tabs. Contracts/types/build, 117 unit tests, 15 real process tests and 31 installed Cursor host checks passed (API 1.128.0, Node 24.19.0). Host checks cover replay/multiple conversations, filters/clear, follow-latest-off focus, real incoming frozen delivery/resume, terminal/editor placement, missing/deleted targets and privacy reset. Both owned test collectors ended off with hooks/leases absent and empty inboxes. No new ordinary native Agent turn, broader native collection or T16 work is claimed. See [activity implementation](docs/activity-inspection.md) and [host verification](docs/t15-extension-host-verification.json).

### T16 — Add overlap advisory rules

**Owner:** Overlap projection. **Dependencies:** T10–T12. **Scope:** M, 3–4 files.

**Description:** Implement the qualified concurrent/recent edit advisories and optional stale-context informational rule. Keep physical overlaps separate from logical repository path comparisons.

**Acceptance criteria:**

- [x] Two proven distinct conversations editing the same physical file produce an evidence-backed advisory in the defined window.
- [x] Separate worktrees, duplicate events, same-conversation ambiguity, and watcher-only actor guesses do not create false physical conflicts.
- [x] Possible stale context requires successful-read/order evidence and remains explicitly qualified.

**Verification:** Table-driven positive/negative cases with fake time and source uncertainty, plus replay of the native shared-file fixture.

**Files likely touched:** `src/core/overlap.ts`, overlap tests, `src/core/reducers.ts`, overlap fixtures.

**Completion record — T16, 25 October 2026 (Pacific):** Implemented physical/conversation-qualified concurrent and recent edit advisories plus source-ordered informational stale-context rules. Scope, actor proof, failed/ambiguous operations, duplicates, exclusions and bounds are explicit. Receipt timing never proves concurrency; attempts/ingestion order never prove a read baseline. Positive normalized fixtures pass; the actual T03 shared-file capture remains unqualified and produces no physical-conflict claim. See [rule and attention semantics](docs/overlap-and-attention.md).

### T17 — Surface attention items and bounded notifications

**Owner:** Attention UI. **Dependencies:** T15, T16. **Scope:** M, 3–4 files.

**Description:** Show overlap and collection issues with explanations and local acknowledge/mute controls. Keep reads and ordinary success quiet.

**Acceptance criteria:**

- [x] Attention items expose involved actors/files and the facts that triggered the rule.
- [x] Stable advisory identities prevent duplicate notifications while a condition remains unchanged.
- [x] Notifications default off; acknowledging/muting does not erase event history or stop agents.

**Verification:** Replay repeated and changing advisories, test optional notification mode and mute persistence, and inspect copy for unsupported certainty.

**Files likely touched:** `src/ui/attention.ts`, attention tests, notification module, settings declarations.

**Completion record — T17, 25 October 2026 (Pacific):** Added Attention inspection with involved identities/files, exact cause IDs and limitations. Acknowledge/mute are bounded local presentation controls persisted in workspace state, with stable continuous-episode identities. Optional notifications default off, exclude informational/read/success activity, and are limited to three per minute with clock-rollback containment. Native uncertainty remains informational. Source history and agent execution are unchanged. See [Attention verification](docs/t16-t18-extension-host-verification.json).

### T18 — Add source health and actionable self-checks

**Owner:** Health/UI. **Dependencies:** T06, T11, T15. **Scope:** M, 3–5 files.

**Description:** Add collector readiness, source coverage, queue age, gap counters, and a safe helper self-check. Explain the failing layer without starting an agent automatically.

**Acceptance criteria:**

- [x] Readiness distinguishes registered integration, working helper, ingesting collector, and actual native-event evidence.
- [x] Storage/schema/exclusion/unsupported-environment gaps appear with specific next actions and safe diagnostics.
- [x] A self-check has distinct source identity, does not count as real agent activity, and makes no paid model call.

**Verification:** Inject failures at each layer and confirm the visible diagnosis matches the broken layer without exposing payload content.

**Files likely touched:** `src/core/health.ts`, health view, self-check command, health tests, `docs/troubleshooting.md`.

**Completion record — T18, 25 October 2026 (Pacific):** Added Source Health rows for registration, helper response, diagnostic ingestion, ownership, native evidence, partial coverage and bounded queue age/count sampling. Added safe schema/scope/privacy rejection diagnostics and specific next actions. A trusted-launcher UUID self-check exercises helper/spool/collector, normalizes to self-check rather than native activity/source gaps, requires existing eligible collection, and makes no model call. Checks pin the enabled helper and bound process/ingestion waits. Contracts/types/build, 135 unit tests, 16 process integration tests, Go tests and 33 installed Cursor host checks passed (API 1.128.0, Node 24.19.0). Source input remains synthetic; no new ordinary native Agent turn is claimed. See [troubleshooting](docs/troubleshooting.md) and [host result](docs/t16-t18-extension-host-verification.json).

### Checkpoint G2b — useful supervision

- [x] Angad can answer “who touched this file, with what evidence?” from the view.
- [x] Overlap advisories are explainable, and unknown attribution remains visible.
- [x] Keyboard navigation, filters, frozen display, focus, and source health work together.

**G2b engineering record:** The installed-editor regression combines evidence inspection, explicit unknown attribution, explainable attention, filter/freeze/focus behavior and distinct readiness/native evidence. This is engineering verification, not a claim that Angad has completed the later T25 pilot.

## Phase E — reliability and clean installation lifecycle

### T19 — Finish journal replay, checkpoints, and retention

**Owner:** Storage. **Dependencies:** T06, T11, T13. **Scope:** M per subtask, split replay and retention if needed.

**Description:** Complete bounded journal rotation, projection checkpoints, event-ID dedup recovery, and pruning. Define crash durability honestly and disclose corrupt-segment gaps.

**Acceptance criteria:**

- [x] Crash after append/before acknowledgment replays events once; reload does not retain false live operation state.
- [x] Time/size limits prune oldest complete segments and update projections/indexes without retaining sensitive orphan data.
- [x] Torn final lines and damaged middle segments have different recovery paths, with coverage gaps surfaced.

**Verification:** Kill/restart integration tests at named persistence boundaries, corruption fixtures, storage-cap stress, and replay timing measurements.

**Files likely touched:** `src/transport/journal.ts`, `src/transport/retention.ts`, checkpoint module, storage/recovery tests.

**Completion record — 25 October 2026:** Bounded age/size/count retention, monotonic replay/dedup, metadata-first crash-safe pruning, policy/source-bound normalized tail checkpoints, live projection/frozen-inspector invalidation and categorized integrity diagnostics are implemented. Both persistence-boundary SIGKILL tests pass. Final verification: 141 unit tests, 17 process tests and 34 installed Cursor checks. A reproducible 2,000-record timing sample is saved without a native-latency or speedup claim. See [history and recovery](docs/history-and-recovery.md).

### T20 — Implement qualified workspace/window ownership

**Owner:** Integration lifecycle. **Dependencies:** T03, T08, T19. **Scope:** M, 3–5 files.

**Description:** Implement the scope strategy proven in T03, collector leases, enabled-root routing, and duplicate-window behavior. Keep the personal-alpha one-window-per-checkout limitation explicit.

**Acceptance criteria:**

- [x] One effective producer/consumer pipeline operates for an enabled workspace, including reload/extension upgrade.
- [x] A second window on the same checkout diagnoses ownership rather than silently duplicating activity; stale ownership is recoverable.
- [x] Unrelated projects do not persist telemetry merely because plugin registration has a wider scope.

**Verification:** Native two-window test, stale lease/process-exit cases, nested/multi-root routing, and exact ownership cleanup checks.

**Files likely touched:** `src/integration/workspaceLease.ts`, `src/integration/pluginManager.ts`, helper routing module, ownership tests, compatibility report.

**Completion record — 25 October 2026:** One root-scoped pipeline, passive duplicate windows, strict dead-process lease recovery, structural generated-hook ownership across upgrades, stable collector identity across profiles and exact single-root routing are implemented. Explicit Enable resumes after normal reload; Disable clears the choice. 143 unit, 19 process and Go tests passed. Two actual installed Cursor windows and a separate normal-window reload UI check passed; extension-test memento reset is disclosed. T03 native delivery evidence is retained separately. See [window ownership](docs/window-ownership.md).

### T21 — Complete safe enable/disable and configuration fallback

**Owner:** Onboarding/integration. **Dependencies:** T13, T18, T20. **Scope:** M per subtask; fallback is conditional.

**Description:** Complete trust-gated onboarding, clear support/coverage explanations, owned producer removal, and exact-diff project hooks only when the selected integration requires them.

**Acceptance criteria:**

- [x] A supported workspace can enable, reload, disable, and reenable without new prompts for routine steps already selected by the user.
- [x] If fallback configuration is used, exact-byte backup, structural ownership, atomic replace, and compare-before-restore preserve unrelated/later edits.
- [x] Restricted/invalid/unsupported setups explain the issue and do not run arbitrary workspace-defined executable paths.

**Verification:** Setup lifecycle tests including existing unknown hook keys, malformed JSON, foreign permission hooks, modified post-install config, trust changes, and extension upgrade.

**Files likely touched:** `src/integration/pluginManager.ts`, `src/integration/hookConfig.ts`, onboarding commands, integration lifecycle tests, setup documentation.

**Completion record — 25 October 2026:** Trust-gated reload/disable lifecycle now includes explicit opt-in for valid existing project hooks, unknown-key/permission-entry preservation, exact private original backup, atomic guarded replacement and compare-before-restore. Modified configurations and uncertain staging remain untouched. Parser module bundling is corrected and privacy changes clear auto-resume consent immediately. 149 unit, 19 process and 35 installed Cursor checks passed. See [setup and cleanup](docs/setup-and-cleanup.md).

### T22 — Verify producer failure containment and resource budgets

**Owner:** Reliability. **Dependencies:** T19–T21. **Scope:** M, 3–5 files.

**Description:** Measure cold/warm helper overhead and UI/transport behavior under realistic and burst loads. Exercise malformed input, spool exhaustion, collector absence, and helper launch errors against installed hook behavior.

**Acceptance criteria:**

- [ ] The measured report includes hardware/build, sample count, cold/warm p50/p95, hook-to-view latency, CPU/memory, and storage/replay results.
- [ ] Tested telemetry failures do not intentionally block/continue agents through malformed output; any remaining launcher/runtime limitation is disclosed and resolved before release claims.
- [ ] Queue, memory, storage, refresh rate, quarantine, and error logs stay bounded with visible loss/gap accounting.

**Verification:** Focused stress/failure harness plus a native Cursor failure smoke run. Optimize the demonstrated bottleneck only; rerun checks affected by changes.

**Files likely touched:** Stress/failure harness, helper response tests, native smoke record, `docs/performance.md`, transport tuning.

**Open record — T22 measured 25–26 October 2026 (Pacific):** Helper and native missing-executable failure artifacts are recorded, and bounded content-free producer-loss reporting is implemented. Burst isolation still accepted only 1,053 of 2,000 attempts with transport rejections/failures. Near-cap incremental RSS was 166,100,992 bytes, above the proposed 75 MiB target. Measurements predate T23’s per-generation inbox change; rerun on the final transport before qualification. T22 is not complete and G3/T24 remain gated. See [resource/failure report](docs/performance.md).

**Continuation checkpoint — 26 October 2026 (Pacific):** Added the bounded 5,000-source-payload tail, compact identity index, 64 KiB replay, bounded history pages, sequence-based rolling projection, namespace-partitioned reducer deduplication, clock/decoration caching and watcher-aware empty polling. Added a serialized durable batch journal API; production hooks still use the spool. Passed contracts/types/build, 172 unit tests, 23 process tests, Go tests and [40 installed Cursor checks](docs/t22-final-extension-host-verification.json). Comparable replay peak RSS fell from about 330 MiB to 199 MiB but remains over 75 MiB. A disposable synthetic batch writer persisted 2,000/2,000 records at ~22 ms helper-close p95; it is not production transport qualification. Current final-backoff CPU and production burst budgets remain unqualified. See [current measurements and next integration work](docs/performance.md).

### T23 — Add reviewed local export and scoped data deletion

**Owner:** Privacy/commands. **Dependencies:** T13, T19, T21. **Scope:** M, 3–4 files.

**Description:** Export content-free diagnostics with optional path redaction and clear extension-owned history with explicit scope. Preserve unrelated Cursor/project data.

**Acceptance criteria:**

- [x] Export preview shows exact included categories and defaults to redacted paths without uploading anything.
- [x] History deletion removes selected journal/checkpoint/spool/export-staging artifacts and does not recreate old records from pending producers.
- [x] Export and deletion tests cover fake secrets, stale files, multiple workspace ownership, and cancellation.

**Verification:** Inspect generated archives/manifests, search for invented forbidden markers, and compare filesystem scope before/after deletion in a temporary fixture area.

**Files likely touched:** Export command, deletion command, privacy/export tests, `docs/privacy.md`.

**Completion record — T23 completed on 26 October 2026 (Pacific):** Added allowlisted bounded JSON diagnostic exports with a read-only manifest preview, path redaction by default, optional normalized relative paths, consistent pseudonymized identities and exact reviewed-byte private save. Reviews expire after five minutes and invalidate on cancellation/privacy/retention/reset changes. Scoped history reset disables collection, holds exclusive workspace ownership, previews categories/counts, confirms separately and preserves user files, foreign hooks, original backups and unselected exports. It removes recognized journal/retention/checkpoint/spool/report/staging artifacts, clears current-window projections/aliases/attention, rotates the collector generation and leaves collection off. Installed hooks require the expected generation and use per-generation inboxes; old commands and envelopes cannot restore cleared data. A durable interrupted-reset marker blocks replay until reviewed completion. Review also fixed stale first-export memory after another window resets history and canonicalized one legacy probe test fixture path. Strict contracts/types/build, 164 unit tests, 22 actual process tests, Go tests/race/vet and 40 installed Cursor checks passed (Cursor 3.26.16, API 1.128.0, macOS arm64). Owned test fixture publisher is off, hooks/lease/reset marker absent and pending inbox files zero. Host automation covers the maintenance API and installed cancel command; the modal confirmation itself was not separately UI-driven. No new ordinary native Agent delivery is claimed. See [privacy/commands](docs/privacy.md), [host evidence](docs/t23-extension-host-verification.json), and [T22 limits](docs/performance.md).

### Checkpoint G3 — personal-beta readiness

- [ ] Enable/reload/disable/upgrade and bounded recovery pass on the qualified machine.
- [ ] Native smoke, privacy, resource, and unknown-state tests pass with measured records.
- [ ] No unrelated hooks, user files, or native conversation state are mutated by collection/recovery.

## Phase F — package and validate with Angad

### T24 — Package a reproducible personal-alpha VSIX

**Owner:** Release engineering. **Dependencies:** G3. **Scope:** M, 3–5 files plus generated package.

**Description:** Produce a local platform-qualified package with the correct helper, integration templates, documentation, licenses, and pinned dependencies. Do not publish as part of packaging.

**Acceptance criteria:**

- [ ] Package inspection proves the intended binary architecture, executable mode, resolved runtime generation flow, and absence of secrets/dev traces.
- [ ] A clean Cursor profile installs the package and completes the native read/edit/disable scenario.
- [ ] Release notes name the tested Cursor build/platform, evidence limits, supported workflows, and uninstall/recovery procedure.

**Verification:** Build, package, inspect package contents, run the minimum regression suite, and perform clean-profile native smoke. Record package checksum and build inputs.

**Files likely touched:** Packaging scripts, package metadata, ignore rules, release notes, release verification record.

### T25 — Validate the normal supervision workflow with Angad

**Owner:** Product/engineering. **Dependencies:** T24. **Scope:** S, 2 documents and local settings if requested.

**Description:** Observe Angad using ordinary native conversations, including simultaneous activity. Measure whether the view helps locate work and make a decision, with explicit consent for any shared diagnostic data.

**Acceptance criteria:**

- [ ] Record time to first useful native event, at least three file-evidence inspections, and review of an overlap or uncertainty case.
- [ ] Categorize confusing/incorrect attribution, missing activity, noise, and installation friction with reproducible examples.
- [ ] Decide whether conversation-level visibility is valuable enough or child-level attribution is required before broader work.

**Verification:** User walkthrough and reviewed findings using local counters; do not treat panel-open count as proof of value.

**Files likely touched:** `docs/pilot.md`, prioritized follow-up issue list.

### T26 — Close alpha findings and update the handoff

**Owner:** Maintenance/product. **Dependencies:** T25. **Scope:** S or M per concrete fix.

**Description:** Resolve release-blocking findings, update compatibility and limitations to match behavior, and leave a coherent reproducible project. Split unrelated fixes into separate reviewable changes.

**Acceptance criteria:**

- [ ] Every blocker has a passing verification record or an explicit unsupported-scope decision accepted for the alpha.
- [ ] Handoff, source contract, settings, compatibility matrix, and known limitations match the shipped package.
- [ ] The next increment is selected from pilot evidence rather than automatically expanding to all adapters and platforms.

**Verification:** Rerun checks affected by fixes and the final core native smoke; avoid broad repeated test runs after results are stable.

**Files likely touched:** Specific fix targets, `HANDOFF.md`, `RESEARCH.md`, release/compatibility records, this checklist.

### Checkpoint — personal alpha complete

- [ ] G0–G3 and T24–T26 have evidence on the named build/platform.
- [ ] Angad can supervise his normal Cursor conversations and recover from common collection problems.
- [ ] Optional work remains explicitly separate; public publication is not inferred from local package completion.

## Phase G — optional, separately selected increments

### T27 — Qualify additional desktop platforms

**Owner:** Packaging/platform. **Dependencies:** Personal alpha complete and platform demand. **Scope:** M per OS/architecture.

**Description:** Build the helper and package for one additional named platform at a time. Validate runtime behavior rather than relying on cross-compilation success.

**Acceptance criteria:**

- [ ] Installation/launcher paths, quoting, permissions/ACLs, atomic publication, trust, and uninstall pass on the real target.
- [ ] The core native smoke and resource budgets pass or the platform’s reduced capabilities are explicit.
- [ ] Distribution metadata selects the correct binary and maintains reproducible checksums/notices.

**Verification:** Platform-specific CI plus a real Cursor smoke record on that OS/architecture.

**Files likely touched:** Platform launchers, build matrix, packaging tests, compatibility report.

### T28 — Qualify one remote workspace mode

**Owner:** Remote integration. **Dependencies:** Personal alpha complete, explicit remote demand. **Scope:** M per remote mode; split discovery from implementation.

**Description:** Probe the extension/plugin/tool execution placement in one of SSH, container, or WSL and implement environment-aware paths/storage only if supported.

**Acceptance criteria:**

- [ ] Collector/helper execute in the correct environment without assuming desktop `localhost` or absolute paths map to the remote host.
- [ ] Remote/native and local file identities remain separate and open the correct editor resources.
- [ ] Unsupported placement produces clear coverage status; disconnect/reconnect and storage cleanup preserve bounds.

**Verification:** Remote native read/edit smoke, disconnect mid-operation, changed remote root, and local/remote same-path collision tests.

**Files likely touched:** Host capabilities, remote adapter/routing, URI mapping, remote tests, compatibility report.

### T29 — Add cloud-run supervision to the same Cursor view

**Owner:** Cloud adapter. **Dependencies:** Personal alpha complete, explicit cloud scope. **Scope:** Several M tasks: discovery/auth, stream ingestion, UI/validation.

**Description:** Integrate the current public Cursor cloud API as an optional source. Keep durable agent/run identities and cloud file environments distinct from native IDE conversation identities.

**Acceptance criteria:**

- [ ] Credentials use editor secret storage; read-only listing/streaming requires no automatic agent creation or paid launch.
- [ ] Stream reconnect/expiry/status semantics are implemented from the selected current API version, with gaps and truncated tool payloads disclosed.
- [ ] File activity is shown only from measured supported fields; cloud paths never silently decorate unrelated local files.

**Verification:** API fixtures, disconnect/reconnect/retention-expiry tests, rate-limit handling, and an authorized cloud account smoke. Do not implement legacy webhooks against a v1 assumption.

**Files likely touched:** Cloud auth module, cloud adapter, SSE transport, cloud fixtures/tests, capability report.

### T30 — Evaluate narrow supported intervention controls

**Owner:** Controls/product. **Dependencies:** Personal alpha complete, explicit control workflow selection. **Scope:** Discovery task followed by separate M implementation slices if viable.

**Description:** Investigate the exact supported action Angad needs, such as denying a future supported tool or cancelling a specifically managed cloud run. Do not present those as a universal native-chat pause.

**Acceptance criteria:**

- [ ] Control capabilities are documented and tested by source/session type; unsupported native actions remain unavailable.
- [ ] Policy composition, timeout/failure defaults, alternate tool routes, and user feedback are explicit and verified.
- [ ] Control actions are logged as user actions distinct from observation events, and the original passive workflow remains usable.

**Verification:** Controlled fixture operations, failure/timeout tests, and source-specific native/API smoke under an implementation request authorizing the controls.

**Files likely touched:** Control capability profile, policy module, supported control transport, control tests, decision record.

## Completion evidence template

When completing each task, append a short record using this structure in the task’s section:

```text
Completed on: actual date
Build/platform: actual Cursor and operating-system versions
Change: concrete implementation or discovery result
Validation: actual commands/native scenario and observed outcomes
Limitations: any remaining uncertainty or explicitly excluded scope
```

The template describes the record to write later; it is not implementation code or evidence that any task has run.
