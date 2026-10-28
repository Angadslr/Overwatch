# T22 allocation diagnosis fix — 28 October 2026

Prepared for Angad. This is the active testing record for the allocation fix. The 27 October handoffs and packaged candidate are historical. This work does not require changing models. T22/G3 can close only when the unchanged resource and failure-containment criteria are met; T24 remains gated until then.

## Current verdict

The diagnosis-driven allocation fix is implemented and functionally verified. **T22 remains incomplete:** both final unprofiled runs fail raw loaded idle CPU, and one fails installed incremental RSS. Both evaluator runs exit 1. The isolated editor workload and resource targets are unchanged.

| Final unchanged build | Run A | Run B | Target |
|---|---:|---:|---|
| Expected events observed | 2,041/2,041 | 2,041/2,041 | All events, zero producer errors |
| Normal helper close p95 | 29.25 ms | 28.83 ms | <50 ms |
| Matching provider-row p95 | 199.97 ms | 210.89 ms | <1,000 ms |
| Burst helper close p95 | 27.88 ms | 27.22 ms | <50 ms |
| Raw loaded idle CPU | **1.213% FAIL** | **1.261% FAIL** | <1% of one core |
| Installed incremental peak RSS | **132.67 MiB FAIL** | 36.97 MiB PASS | <75 MiB |

Run A started at 213.48 MiB RSS and peaked at 346.16 MiB; run B started at 378.56 MiB and peaked at 415.53 MiB. The difference in starting baselines materially affects the incremental metric. Several intermediate samples passed memory, but this pair does not establish stable installed memory qualification. Disabled CPU controls were 0.839%/0.846%; those values cannot be subtracted to pass the raw gate.

Both reports bind extension SHA-256 `d6067842e6294f9f6d6580d505e8b6eb90ae2e51a73001a075dbd220ec8eb63c` and helper SHA-256 `1db897b5d21036204475b9cb8d91a500f9127ed55aca0519b804de1105fb944a`. See [run A](t22-diagnosis-editor-a.json), [run B](t22-diagnosis-editor-b.json), [gates A](t22-diagnosis-gates-a.json), [gates B](t22-diagnosis-gates-b.json), and [source hashes, command results and cleanup](t22-diagnosis-verification.json). Fifteen completed owned installed-test fixtures were inspected: publisher off, hook/lease/reset absent, broker configuration absent, inbox files zero. Physical endpoint removal is separately asserted in the process/installed lifecycle tests; individual performance-run endpoint paths were not retained.

## Implementation and trade-offs

The supplied diagnosis correctly identified repeated scoped-key serialization and derived projection allocation. The fix caches only detached, deeply frozen event snapshots branded by `eventValidation`; a caller's `Object.freeze` cannot establish provenance. Persisted flat JSON-array keys, escaping, namespace partitions and alias compatibility remain byte-for-byte equivalent.

- Namespace/event/actor keys use weak event ownership. Actor maps allocate lazily, retain at most four lookups per kind, and exclude oversized arbitrary lookup IDs. Replayed events can share derived strings through a separate journal-owned pool capped at 512 strings of at most 2,048 UTF-16 code units. Its owner is the journal's existing source-string pool; weak ownership releases it with that journal and its snapshots. There is no process-wide namespace interner. The separate pool avoids starvation when startup source validation has already filled the original 512-entry pool.
- File projection groups by exact scope/identity/locator maps and serializes a row key once per group. Reducers retain immutable per-operation summaries and file contributions until that bucket changes, uncertainty expires, replay liveness changes, or the clock moves backward. Public snapshots remain detached. This trades bounded retained derived data for substantially less repeated allocation.
- Decoration fingerprints compare exact child identities and group boundaries without serializing all long IDs; badge summaries are computed once per refresh. Existing unchanged-input checks remain before expensive projection. Privacy, disabled state, source membership and recency invalidation remain enforced.
- Source Health keeps stable row identities and emits changes only for changed rows. Queue samples and their actual timestamps continue at the original cadence; this does not suppress missing-activity diagnostics.

An initial eager-cache revision regressed full-retired replay RSS to 81.42 MiB and reload RSS to 78.77 MiB. Those failed reports are preserved as `t22-eager-cache-*-history.json`. Lazy actor maps and journal-owned derived-string sharing corrected that regression. The full recent 5,000-event projection, near-100 MiB source history and 100,000 retired identities were preserved.

Attention analysis already runs when source/display input changes rather than on every idle decoration tick. The measured idle trace had no `store.viewSnapshot`, conversation refresh or attention update. No additional overlap-result cache was added: evidence-map membership, privacy and time-dependent overlap boundaries must not become stale merely because the operation snapshot reference is unchanged.

## Functional verification

The final implementation passed strict contract/type checks, build/helper build, **218 unit tests, 35 process tests, 42 installed Cursor checks, five uncached Go race-tested packages and Go vet**, without skipped core checks. The additional tests exercise exact key bytes and zero repeated serialization, mutable/frozen caller getters, independent/bounded journal pools and hostile pool values, operation reuse across unrelated arrivals, exact expiry/rollback, terminal/ambiguous evidence, decoration membership/order/grouping, and fresh health timestamps without whole-tree refresh.

An earlier process-suite run overlapped another native test workload and hit its compiled-helper three-second timeout. The unchanged process suite passed sequentially afterward, including the final rerun. The failed log remains `.local/t22-key-cache-integration.log`; it is not silently counted as a pass or presented as an explained production fault.

Final standalone history results:

| Case | Incremental peak RSS | Source/evidence conditions | Verdict |
|---|---:|---|---|
| Cold | 55.89 MiB | 104,856,734 source bytes; latest 5,000 projected | PASS |
| Full retired capacity | 55.73 MiB | 104,857,220 source bytes; 100,000 retired identities; append refusal leaves history unchanged | PASS |
| Reload at full capacity | 69.00 MiB | Same full source/retired capacity; refusal unchanged; actual second reader process | PASS |

All history runs show staged loading while validating retained source records and projecting the recent window. Completion takes more than two seconds; qualification uses the existing explicit staged-loading alternative. No forced GC occurs during measured peaks. The reader's existing pre-baseline GC is disclosed in each report.

## Diagnostics and limitations

The original allocation diagnostic sampled about 1.190 GB including collected objects. Key/group changes alone reduced sampled volume to about 698.7 MB in a separate diagnostic run; this is allocation volume, not retained heap or an exclusive RSS speedup. Subsequent per-bucket/decorations changes are included in the final production measurements. Profiled runs never qualify resource gates.

The idle view trace retained 2,041 events, recorded 299 inexpensive decoration checks, 30 health refreshes, one age refresh, and unchanged local-observation exclusion counts across 60 seconds. It did not show periodic whole-projection rebuilding. Disabling only the measurement memory sampler for a second diagnostic idle interval did not improve CPU. A native OS sample was mostly waiting and used stripped runtime symbols; it did not establish a new production root cause. None of those hypotheses justified weakening ownership checks or slowing freshness guarantees.

The final [same-data disabled control](t22-diagnosis-disabled-control.json) measured 2.482% raw loaded CPU, disabled collection, waited 31 seconds, then measured 1.413% raw CPU over another 60 seconds. All 2,041 evidence records remained in memory and the collector stayed disabled. This demonstrates that ongoing collection alone does not explain that run's CPU failure; retained extension views, GC/runtime work and builtin/editor activity still require attribution. Different time windows do not establish exclusive CPU ownership. This report is explicitly diagnostic and is rejected by resource qualification. An added strict type check passed after introducing this test-only control; production binaries were unchanged.

A named-profile diagnostic was unsuitable for qualification: it had two external extensions, one active, raw idle CPU 13.17% and incremental RSS 229.17 MiB. The original isolated-profile workload remains the qualification procedure. The normal application was not terminated, credentials were not copied, and the owned diagnostic window closed after testing. Official extension-test mode refused to run against the already-running main Cursor instance; that failed experiment is retained locally.

The latest ordinary native Read/edit and missing-helper Read smoke remains the **27 October** report, `t22-current-native-smoke.json`. Its helper hash is unchanged. It was not repeated on the new extension bundle, so it is not presented as final-bundle native UI qualification. No automatic missing-helper loss alarm was observed: an absent helper cannot publish its own loss marker. Diagnose missing activity from explicit readiness/self-check results, the last source receipt, and actual native actions; absence of telemetry is not proof of inactivity.

## Remaining verification before T22/G3 and T24

Keep all failed CPU/RSS samples visible. Resource qualification must use fresh unprofiled runs on unchanged binaries, all 2,041 expected events, both helper p95 limits, provider-row coverage, raw loaded CPU below 1%, installed incremental RSS below 75 MiB, and all three history cases. Loaded-minus-disabled CPU remains an estimate and cannot replace the raw gate. Do not shrink the workload, force collection during peaks, disable bundled extensions, or pick only favorable baselines.

The broker suites were rerun successfully, but their titles do not prove all interleavings. The following review targets from `INDEPENDENT-TEST-PLAN.md` remain explicit:

| IDs | Existing executable evidence | Additional deterministic coverage required |
|---|---|---|
| B01/B04 | Delayed durable submit, one split boundary, incomplete-frame expiry, real helper/journal | Relevant byte/UTF-8 boundaries and disconnect before each completion boundary |
| B02/B03 | Wrong authentication/scope/epoch, malformed/oversize/extras and multiple packets | Duplicate-key interpretation and broader malformed-frame corpus |
| B05/B06 | Connection cap, 80-request bounded batches, 40 helpers, full 2,000-event burst | Slow-disk global byte/pending caps; simultaneous novel broker/spool writes |
| B07/B08 | Identical/conflicting retry; real SIGKILL after sync; exact-byte fallback deduplication | Before-sync/partial-frame crash points and retention during recovery |
| B09/B12 | Missing endpoint, timeout/disconnect, stale endpoint cleanup, fresh restart token; real-socket Go acknowledgment cases | Injected endpoint-start failure and helper upgrade while old clients exist |
| B10/B11 | Actual queued privacy tightening, ownership loss, publisher substitution after sync | Storage failure injection at admitted write/ack boundaries |
| B13/B15 | Cancel/commit reset, interrupted-reset replay fence, disable/restart and blocked-sync shutdown | Destructive reset with pending old broker clients; repeated disposal under overload |
| B14 | Unknown entries, wrong token, symlink and proof substitution preserve foreign data | Foreign directory/socket replacement at additional cleanup boundaries |
| B16 | Actual broker credential/path export exclusion and fake-secret assertions | Every error/backpressure diagnostic path audited for credential exclusion |

After the remaining resource/failure gaps are resolved, repeat ordinary native Read/edit, copied-helper failure, reload and cleanup against the final bundle. Rebuild and inspect T24's exact package twice, compare hashes, then test its native and install/upgrade/uninstall lifecycle. T25 still requires Angad's real pilot; child-to-file ownership remains unsupported and cannot be inferred from timing or parent linkage.

## Reproduction

Run resource workloads sequentially, outside the restricted socket/watcher sandbox, without another stress suite or profiler:

```sh
npm run check
npm run build
npm run build:helper
npm run test:unit
npm run test:integration
OVERWATCH_EXTENSION_RUN=t22-cache-regression node scripts/test-extension.mjs
OVERWATCH_EXTENSION_RUN=t22-cache-resource-a OVERWATCH_PERFORMANCE_ONLY=1 node scripts/test-extension.mjs
OVERWATCH_EXTENSION_RUN=t22-cache-resource-b OVERWATCH_PERFORMANCE_ONLY=1 node scripts/test-extension.mjs
OVERWATCH_HISTORY_OUTPUT=t22-repeat-cold-history.json node scripts/measure-history-cap.mjs
OVERWATCH_HISTORY_RETIRED=100000 OVERWATCH_HISTORY_REFUSAL=1 OVERWATCH_HISTORY_OUTPUT=t22-repeat-retired-history.json node scripts/measure-history-cap.mjs
OVERWATCH_HISTORY_RETIRED=100000 OVERWATCH_HISTORY_REFUSAL=1 OVERWATCH_HISTORY_WARM=1 OVERWATCH_HISTORY_OUTPUT=t22-repeat-warm-history.json node scripts/measure-history-cap.mjs
node scripts/qualify-resources.mjs --editor .local/t08-extension-tests-t22-cache-resource-a/performance.json --history docs/t22-repeat-cold-history.json --retired-history docs/t22-repeat-retired-history.json --warm-history docs/t22-repeat-warm-history.json --output docs/t22-repeat-cache-gates-a.json
```

Use the pinned Go toolchain with a project-local `GOCACHE` for `go test -race -count=1 ./...` and `go vet ./...` from `helper/`. First launch is not forced OS-cache cold start; provider-row visibility is not browser paint. Every measurement must be bound to its actual implementation hashes.
