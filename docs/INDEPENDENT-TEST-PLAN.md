# Independent verification handoff — Overwatch T22/T23

Prepared for Angad, Gemini 3.8 High and Claude Opus 4.6 Thinking. Run against the checkout being reviewed; historical results are not evidence for later edits.

**Current 27 October continuation:** Angad requested a GPT-6.1 High/Opus handoff where needed. Use [the current investigation and exact reproduction commands](T22-T24-HIGH-REVIEW.md), [final verification](t22-final-verification.json) and [resource-gate failures](t22-final-resource-gates.json). Functional regression passes, but T22/G3 remain open on observed resource failures. Private engineering-candidate packaging and isolated synthetic smoke do not close qualified T24 or the T25 user pilot.

The repository checkpoint now includes the previously untracked T16 implementation and tests. Confirm the branch, working directory and `git status --short` before selecting a next task; older committed snapshots lack later completed work. Current task state is at the top of `HANDOFF.md`; older "next" statements below it are historical. Historical verification reports retain the HEAD and working-tree scope from their measurement time.

## Roles and scope

- Sol Medium: implement small slices, add executable regression tests, fix reproducible failures, and maintain this test map.
- Gemini: independently run the commands, reproduce measurements and inspect view/cleanup behavior. Add focused reproductions when coverage is missing.
- Claude: independently review authentication, privacy, durable acknowledgment, ownership and generation/reset races. Every finding needs a concrete interleaving or failing test.
- Reserve the final 10% of Codex quota for critical review and evidence/handoff work. Do not spend that reserve implementing features or repeatedly rerunning unchanged passing suites.

Start with `HANDOFF.md`, `todo.md`, `docs/performance.md`, `docs/privacy.md` and this document. Preserve accumulated unrelated changes, including `landing/`. Use only disposable invented fixtures. Do not publish, install globally, upload diagnostics, start ordinary Agent/model calls, or mutate unrelated hooks/conversations as part of these checks.

## Verified baseline and open gates

Before the next broker slice, strict checks/build, 172 unit tests, 23 process tests, Go tests and 40 installed Cursor checks passed. Evidence: `docs/t22-final-extension-host-verification.json`. This is a baseline, not a required fixed test count.

Production hooks now attempt an authenticated private Unix socket, then fall back to the durable spool with the same encoded event. The initial production transport-only run accepted 2,000/2,000 events with 26.46 ms helper-close p95 (`docs/t22-production-broker-burst.json`). Installed-editor regression/performance and the remaining acceptance cases still require qualification. A prior private socket prototype using the actual journal batch API persisted 2,000/2,000 synthetic records with about 28 ms helper-close p95: `docs/t22-batch-journal-api-prototype.json`. It does not qualify endpoint authentication, dynamic privacy, real Go transport/fallback, ownership transitions or reset cleanup.

T22 remains OPEN. Peak near-cap RSS still exceeds 75 MiB; installed-editor burst delivery reconciles all events, but burst helper p95 and idle CPU exceed their targets. G3/T24 cannot be marked complete using prototype results or changed budgets without an explicit scope decision from Angad.

## Reproducible commands

Run from the repository root, with Node 22+ and the qualified local Go toolchain or Go 1.26+ available. Record actual versions and platform.

```sh
npm run check
npm run build
npm run test:unit
npm run test:helper
npm run test:integration
git diff --check
```

`test:unit` does not accept arbitrary file arguments. To run a focused TypeScript test without changing the runner, bundle it with esbuild into `.local/`, then invoke Node's test runner on that bundle. The actual integration suite builds the extension and compiled Go helper first.

```sh
OVERWATCH_EXTENSION_RUN=independent-review npm run test:extension
```

The editor run creates a fresh invented fixture and isolated profile. Trust only that named fixture if prompted. A host exit without `passed: true` is unverified. Do not reuse a previous result or assume a timeout means success.

Native filesystem watching, Unix sockets and the installed editor may be refused by a shell sandbox. Run those checks with the host's approved desktop/native permissions. A watcher-specific skip must be reported; also run the native-watcher branch outside the sandbox. Polling-only tests must remain active. No global security/trust setting needs disabling.

For Go race/vet checks, select the same executable/cache as `scripts/go-helper.mjs`; run `go test -race ./...` and `go vet ./...` from `helper/`. Record the executable and actual version, rather than assuming the module's declared version is the toolchain version.

## Existing executable coverage map

| Behavior | Tests to inspect and run |
|---|---|
| Strict normalized/source contracts, malformed bytes and source scope | `tests/unit/contracts.test.ts`, `tests/unit/transport.test.ts`, `tests/integration/transport.test.mjs`, existing contract tests under `tests/unit/` |
| Compact index, digest equivalence, chunk boundaries and slot reuse | `tests/unit/journal-index.test.ts` |
| Full validation outside the 5,000-payload tail, bounded disk pages, old duplicate/conflicting retries, retention and corrupt tails | `tests/unit/retention.test.ts` |
| Concurrent single/batch appends, duplicate sequences, preflight refusal, grouped rotation and retired retries | `tests/unit/retention.test.ts` |
| SIGKILL after append/batch sync before acknowledgment and after retention metadata before unlink | `tests/integration/transport.test.mjs` |
| Rolling fixed-length tail still projects fresh records; replay remains live-unknown | `tests/unit/supervision.test.ts` |
| Scope-partitioned deduplication | `tests/unit/scoped-events.test.ts`, reducer/lifecycle tests |
| History-page read buffers, split records, early-return file mutation, prefix digests and read-only torn-tail refusal | `tests/unit/journal-stream.test.ts`; compare `docs/t22-stream-history-control.json` and `docs/t22-stream-history-candidate.json` without treating one comparison as a stable RSS bound |
| Healthy watcher backoff, immediate publication wake, polling-only collection, ownership loss and substitution | `tests/unit/transport.test.ts` |
| Frozen time, clock-only filter expiry and unchanged incoming-event counts | `tests/unit/view-state.test.ts` |
| Privacy, independent file observations and redacted reports | `tests/unit/privacy.test.ts`, `tests/unit/file-observations.test.ts`, `tests/integration/transport.test.mjs`, `tests/extension/views.ts` |
| Exact reviewed export bytes, stale/cancelled previews and symlink refusal | `tests/unit/local-export.test.ts`, `tests/extension/maintenance.ts` |
| Scoped history reset, corrupt history, selected/unselected exports, multiple roots, interruption and old producer fencing | `tests/unit/history-reset.test.ts`, `tests/integration/history-reset.test.mjs`, `tests/extension/maintenance.ts` |
| Hook preservation and passive/owned windows | `tests/unit/hook-config.test.ts`, `tests/unit/workspace-lease.test.ts`, `tests/integration/ownership.test.mjs` |
| Actual editor views, focus, filtering, badge expiry, privacy invalidation and maintenance | `tests/extension/run.ts` and its imported suites |
| Resource qualification fails on latency/CPU/memory and missing/nonfinite/incomplete evidence | `tests/integration/resource-gates.test.mjs`, `scripts/qualify-resources.mjs` |
| Candidate allowlist, qualification disclosure, development-data rejection, helper executable mode/architecture | `tests/integration/candidate-inspection.test.mjs`, `scripts/verify-candidate.mjs` |
| Isolated installation and synthetic read/edit/self-check/disable using installed candidate bytes | `tests/extension/package-smoke.ts`, `scripts/test-candidate.mjs`; ordinary native Agent smoke remains separate |

## Required broker acceptance cases

The following are requirements for the production broker slice. They are not claimed as passed merely because this document exists. Add executable tests alongside implementation; map each ID to the actual test title/file in the result report.

| ID | Setup and action | Required result |
|---|---|---|
| B01 | Send a valid authenticated frame in the currently enabled collector generation | One source record is durably committed; acknowledgment identifies that exact event/digest and follows journal sync. |
| B02 | Missing/wrong token, wrong collector/environment/workspace/worktree, stale epoch | Refuse admission without persisting the supplied event or exposing raw values. A stale producer never adopts the new epoch. |
| B03 | Oversized frame, invalid UTF-8/JSON, extras, unsupported protocol, mismatched event IDs, multiple frames | Bound bytes and connection lifetime; refuse malformed input; no uncaught error, content log or event projection. |
| B04 | Split a valid frame at every boundary relevant to its framing and UTF-8 parsing | Accept exactly once only when complete; EOF/timeout before completion publishes nothing. |
| B05 | Slow clients and more connections/queued bytes than the documented bounds | Connections, queue bytes, batches and timers stay bounded; rejection/backpressure is explicit and content-free. |
| B06 | Send more than 32 valid frames concurrently while spool ingestion also runs | Serialize journal mutation, sync bounded groups, retain contiguous sequences and exact per-event results. |
| B07 | Retry an already committed event; repeat an ID with different bytes | Identical retry acknowledges the original effect; conflicting retry is refused. No second sequence or operation appears. |
| B08 | Kill collector after journal sync but before broker acknowledgment, then retry via spool | Recover one durable effect; retry deduplicates; no false native completion/delivery claim. |
| B09 | Socket missing, stale, unavailable, slow, reset or disconnected before/after write | Real Go helper retains its mandatory hook response/deadline; fallback uses the SAME projected event ID and bytes. Never re-project to mint a new identity. |
| B10 | Tighten privacy or disable collection while a request is queued or awaiting a journal turn | Current admission is rechecked at the defined admission point. Requests rejected before admission leave no excluded path-bearing record. Already admitted historical records stay explicitly historical. |
| B11 | Replace/revoke the lease or publisher configuration during flush | No new success acknowledgment under lost ownership. Preserve foreign leases/configuration; do not steal a live collector. |
| B12 | Broker start failure, concurrent windows, helper upgrade and editor reload | One proven owner; passive competitors; safe spool fallback; no stale endpoint falsely reported active. |
| B13 | Complete/cancel/interupt a T23 history reset with old clients and endpoint requests pending | Cancellation preserves history and leaves collection off. Commit rotates generation, removes owned transient endpoint state and prevents old clients or spool retries from restoring cleared history. Interrupted reset blocks normal replay. |
| B14 | Substitute symlink/foreign directory/socket at endpoint/config/cleanup boundaries | Refuse unsafe paths and preserve unrelated files. Check private ownership and canonical directories. Same-user malicious processes are not a cryptographic isolation boundary. |
| B15 | Stop/dispose while connections, queue and a sync are active | Stop admission, settle or reject every request, wait for in-flight writes, close timers/descriptors and release only owned endpoint/lease artifacts. No late acknowledgment or callback republishes after disposal. |
| B16 | Export/report after failures, backpressure, cancellation and reset using invented secrets in unknown fields | No prompts, contents, raw errors, bearer token or endpoint locator enters default diagnostics/export. Private routing config is outside export scope. |

Executable broker tests now live in `tests/unit/local-broker.test.ts`, `tests/integration/broker.test.mjs` and `helper/internal/spool/broker_test.go`. Test titles identify acceptance IDs. Some IDs have partial coverage: a shared ID on a test title does not establish every interleaving in its row. Real Unix-socket and compiled-Go tests are required, not only mocked callback tests. The existing spool path must keep its tests and remain usable when the broker is unavailable.

## Resource qualification

Run load measurements sequentially without another stress suite, profiler or build competing for the machine. Record hardware, Cursor/API/Node/Go versions, sample counts, input checksums, implementation checksums and the measured scope. Preserve failing results.

```sh
node scripts/measure-generation-burst.mjs --broker --output=t22-independent-broker.json
node scripts/measure-generation-burst.mjs
node scripts/measure-generation-burst.mjs --consumer-off --output=t22-independent-producer.json
node scripts/measure-history-cap.mjs
OVERWATCH_EXTENSION_RUN=independent-performance OVERWATCH_PERFORMANCE_ONLY=1 npm run test:extension
```

Prototype-only reproduction, which cannot close a production gate:

```sh
node scripts/measure-batch-prototype.mjs --journal-api
```

Required targets remain:

- Warm helper completion p95 below 50 ms; distinguish response bytes, process exit and durable telemetry admission.
- Matching provider-row p95 below one second at 20 events/second; disclose that this is not browser paint.
- Production burst absorbs 200 events/second for ten seconds: reconcile all 2,000 burst events plus separately counted warm/normal events, with no undocumented drops or exceeded bounds.
- Idle CPU below 1% on the qualified machine. Report disabled, empty-enabled, transition and settled samples separately; shared-host subtraction is an estimate and must not hide raw values.
- Incremental peak extension RSS below 75 MiB. Generate near-cap fixtures outside the measured reader. Include a recent projection and the compact index/tombstone limits; do not use forced GC to make measured peaks pass.
- Retained-history reload below two seconds at the configured 100 MiB cap, or an explicit responsive staged-loading state. Validate all authoritative source bytes even outside the memory tail.

Also inspect queue size/bytes/age, orphan temporaries, source-loss markers, journal/cache/export caps and refresh cadence. Every count must distinguish attempted, durably accepted, rejected, duplicated, expired and unobserved events. Empty ready queues do not prove no telemetry was lost.

## Cleanup and reviewer output

For each owned editor fixture, record publisher disabled, hooks absent/restored, lease absent, no pending reset, empty pending inbox, broker endpoint closed/removed and all owned child processes/windows stopped. Preserve user files, modified foreign hooks, original backups and unselected exports. Do not recursively delete an unverified directory.

Return a report with actual commands, exit codes, passed/failed/skipped test titles, B01–B16 mapping, performance values/targets, cleanup evidence and limitations. Use PASS / FAIL / BLOCKED / NOT IMPLEMENTED, never infer success from missing logs. For each finding include severity, file/line, trigger/interleaving, expected versus observed behavior and a minimal reproduction. Put any proposed fix in a separate change.

Copyable review request:

> Read docs/INDEPENDENT-TEST-PLAN.md and the latest HANDOFF.md. Independently verify the current T22 broker slice. Run the relevant executable tests, implement focused reproductions for missing B01–B16 coverage, and report actual evidence without changing budgets or declaring prototype results to be production qualification. Preserve unrelated changes and private/user data. Do not publish or run paid/native Agent calls. Return findings and a coverage matrix before making production fixes.

## Broker implementation checkpoint — 26 October 2026 (Pacific)

The initial broker implementation and executable tests exist. Final native regression passed 183 unit tests, 30 process tests, Go tests/race/vet and strict checks/build, with no skips. Evidence: `docs/t22-production-broker-verification.json`. Installed regression passed 40 checks, and an installed performance run observed all 2,041 expected events. An earlier installed regression failed during local observations and did not reproduce on the second run; retain that failure, and do not treat it as explained. The final run also passed all 40 checks, including actual token/path exclusion and reset endpoint removal.

| Acceptance IDs | Current executable evidence | Independent work still needed |
|---|---|---|
| B01/B04 | `local-broker.test.ts`: delayed submission blocks acknowledgment, split valid frame, incomplete frame expires; `broker.test.mjs`: actual compiled helper durable journal | Exhaustive framing boundaries and disconnect interleavings |
| B02/B03 | Unit malformed/auth/oversize/multiple packet tests; compiled-helper integration refuses collector/environment/workspace/worktree/root mismatches and stale epochs | Duplicate JSON-key interpretation and broader malformed-input fuzzing |
| B05/B06 | Unit connection saturation and 80-request bounded batches; 40 concurrent compiled helpers; 2,000-event production burst | Global byte-cap/pending saturation under deliberately slow disk; simultaneous novel spool and broker writes |
| B07/B08 | Real journal retry/conflict; SIGKILL production broker after sync; same-byte helper fallback deduplicates after recovery | Additional crash points before sync/partial frame and retention during recovery |
| B09/B12 | Missing broker fallback, acknowledgment timeout, SIGKILL disconnect, stale endpoint cleanup, fresh token on restart; existing window ownership tests | The real-socket Go test now covers wrong event/digest, non-durable/unsupported/extra-field and multiple-frame acknowledgments. Injected endpoint-start failure and helper upgrade remain review targets |
| B10/B11 | Queued admission recheck, ownership lost after submit, actual production writer admission after privacy tightening | Publisher substitution after sync is now covered by compiled-helper fallback/preservation assertions. Storage failure injection remains. |
| B13/B15 | Installed maintenance reset/cancellation with broker enabled; disable/restart; close waits for blocked sync and sends no acknowledgment | Interrupted destructive reset while broker clients are pending, repeated disposal under overload |
| B14 | Unknown entries preserve proof/data; wrong token cannot clean endpoint; symlink substitution preserves its target; proof substitution during cleanup preserves the changed proof/socket | Foreign socket/directory substitution and additional mutation boundaries remain review targets |
| B16 | Existing export allowlist and fake-secret tests; installed maintenance test now checks actual broker token/path exclusion | Verify every error/backpressure path leaves no credentials in diagnostic artifacts |

These remaining items are explicit review targets, not PASS claims. Do not close T22/G3/T24 from this checkpoint.

The next cold-replay change validates compact identities first and hydrates the recent 5,000 afterward. Run retention tests against this path, especially corruption outside the window, age pruning before hydration, torn-tail recovery and old/conflicting retries. `docs/t22-history-index-first.json` records a 122 MiB incremental RSS sample; it still fails 75 MiB. The earlier installed performance report predates this cold-load change.

Final index-first regression passed 183 unit tests, 30 process tests and 40 installed-editor checks, with no skipped core tests. Go tests, race detection, vet and strict checks/build also passed. The newer real-socket Go acknowledgment test contains seven cases. `docs/t22-production-broker-verification.json` records current hashes and cleanup; prior performance artifacts retain their original implementation scope.

## Copyable model-specific assignments

**Gemini 3.8 High — independent runner:** Read this document and `HANDOFF.md`. Run strict checks, all native unit/process/Go suites and the isolated editor suite. Reproduce the production broker burst and near-cap replay sequentially. Prioritize B01/B03–B06/B09, framing/capacity boundaries, queue reconciliation and cleanup. Report exact versions, commands, failures/skips and implementation hashes. Preserve unexplained failures and do not substitute profiled CPU for an unprofiled measurement. Return a coverage matrix and minimal reproductions; do not change release budgets or production code before reporting.

**Claude Opus 4.6 Thinking — critical reviewer:** Read this document, then review `localBroker.ts`, `spoolIngester.ts`, `journal.ts`, `broker.go`, publisher configuration, ownership and reviewed reset. Prioritize B02/B07/B08/B10–B16: durable acknowledgment, identical retry bytes, admission timing, lease/config changes, proof substitution, unknown-file preservation, shutdown and generation fencing. Inspect the executable tests, add a focused reproduction for each missing invariant and return severity/file/trigger/expected/observed evidence. Review the first unexplained installed local-observation failure. Keep proposed production fixes separate from findings.

**Sol Medium — implementation after review:** Take one reproduced finding at a time, preserve unrelated edits, fix the behavior, run the targeted regression and broaden only as the change requires. Keep T22/G3/T24 open while the unchanged memory/CPU/latency gates fail. Preserve the final 10% of Codex quota for critical review and handoff.

## Fresh local rerun — 26 October 2026 (Pacific)

[Local rerun evidence](t22-local-retest-verification.json) qualifies the current working directory, including untracked T16 implementation/tests. Strict checks/build, all 183 unit tests, all 30 process tests, uncached Go tests/race, vet and all 40 installed-editor checks passed. There were no skipped core tests. All nine overlap tests passed, so T16 is complete locally; T22 remains the open task. The current execution summary now leads `HANDOFF.md` to prevent historical next-task statements from selecting an older phase.

Fresh sequential resource runs reconciled 2,000/2,000 transport-only burst events (24.28 ms helper-close p95) and 2,041/2,041 installed warm/normal/burst events. Installed normal helper p95 was 26.63 ms and provider-row p95 201.48 ms. Budget failures remain: burst helper p95 53.35 ms, loaded idle CPU 3.15%, shared-host incremental peak RSS 291.8 MiB, and near-cap incremental RSS 123.3 MiB. The disabled/empty CPU controls were 0.97%/2.90%; all measurements retain their stated shared-host/standalone scopes. No ordinary native Agent call was added. See the three `t22-retest-*.json` performance reports.

## Shared immutable snapshot follow-up

The b252ec5 checkpoint was committed and pushed before this step. Production retains the standard `JournalIndex` map: an experimental binary collision-chain replacement saved only 4.8 MiB in its comparison and was rejected to avoid adding journal lookup complexity for a small gain. Its measurement is explicitly marked exploratory.

The follow-up validates/detaches normalized event data once, deeply freezes that snapshot and shares it across identity, lifecycle, file projection and manager evidence. A private `WeakSet` recognizes only snapshots produced by this module. Caller-frozen objects cannot bypass validation. Consumed checkpoint entries are released after projection; derived call-reuse ambiguity gets separate evidence instead of mutating shared source facts.

Required verification:

| Case | Expected result and executable coverage |
|---|---|
| S01 | Caller mutations after admission cannot change a snapshot; nested objects/arrays reject mutation. `tests/unit/contracts.test.ts`, validated-snapshot test. |
| S02 | Caller-frozen objects and changed nested extras are still validated; cyclic, extra-field and oversized inputs fail safely. `tests/unit/contracts.test.ts`, caller-freezing test. |
| S03 | Reusing an owned immutable snapshot returns the same object but still enforces spool/journal stage. `tests/unit/contracts.test.ts`. |
| S04 | Retired/reused call evidence remains ambiguous without changing the shared source event. Extended detail-eviction test in `tests/unit/cursor-projection.test.ts`. |
| S05 | Warm checkpoint replay still projects every event and fresh arrivals, with replay liveness unknown. Retention/supervision unit tests and installed replay/maintenance suites. |
| S06 | Privacy changes invalidate display/details; exports retain exact reviewed bytes; reset rotates generation and removes owned artifacts. Installed regression and existing process suites. |
| S07 | Re-run near-cap memory and installed load sequentially. Preserve raw CPU/memory controls, all 2,041 expected events, and unchanged budget failures. No forced GC during measured peaks. |

Review snapshot ownership, recursive freezing, input aliasing and derived-evidence copies. A schema-valid but merely caller-frozen object is not a trusted snapshot. Do not substitute successful functional tests for resource-budget qualification.


## Current T22 checkpoint — 27 October, 3:50 pm wrap-up

Use [current qualification and remaining tests](T22-T24-HIGH-REVIEW.md) before the historical reports above. Current functional coverage is 213 unit / 35 process / 41 installed checks with no skips, plus uncached Go race tests and vet. Native final-build read/edit and a Read with the copied helper unavailable completed. Helper restored and collection disabled. History memory and full-capacity refusal pass; installed raw CPU and RSS fail. Required next tests are phase-specific installed allocation/CPU attribution, unchanged-build repeated unprofiled qualification after a demonstrated fix, B01–B16 interleaving coverage audit, then exact-package lifecycle qualification. No High/Opus review, qualified T24 release or Angad T25 pilot is claimed.

The final diagnostic allocation capture completed; see `t22-current-allocation-diagnostic.json` for sampled sites and the current handoff for interpretation. It is excluded from resource qualification. Repeated file projection/scoped-key construction is an evidenced next investigation target. Current verification records cleanup of all four final installed fixtures and the native smoke.
