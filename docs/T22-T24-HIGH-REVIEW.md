# T22 qualification and remaining tests — 27 October 2026

For Angad's next run with GPT-6.1 High or Opus if desired. No separate model review occurred. Preserve the accumulated working tree. A different model cannot override measured failures.

## Current verdict

T22/G3 remain open; T24 is gated. The final installed run delivered 2,041/2,041 events with normal helper p95 33.72 ms, provider p95 236.75 ms and burst p95 31.06 ms. **Raw loaded idle CPU 1.386% and incremental RSS 117.70 MiB fail the unchanged <1% / <75 MiB gates.** Disabled/empty controls were 0.773%/2.028%. A same-build replication is recorded separately when complete; do not select the better sample and discard the other.

Current evidence:

- `t22-current-installed-performance.json`, `t22-current-resource-gates.json`: final unprofiled measurement and failing evaluator.
- `t22-qualified-cold-history.json`: 53.53 MiB incremental RSS.
- `t22-qualified-retired-history.json`: 66.69 MiB with 100,000 retired identities, near-100 MiB source and full-capacity append refusal.
- `t22-qualified-warm-history.json`: 66.33 MiB for reload at full retired capacity, including refusal without changing history. Large histories explicitly skip the optional cache and stage source replay.
- `t22-current-extension-regression.json`: 41 installed checks passed.
- `t22-current-native-smoke.json`: ordinary native Read/edit completed in a fresh named profile using exact copied final binaries. A second native Read succeeded with the copied helper unavailable. Helper restored; publisher off; hooks, lease, reset marker and broker absent; inbox empty.
- `t22-current-verification.json`: current source/build hashes and functional evidence. Older `t22-final-*` and T24 package records are historical.

## Adopted changes and boundaries

Immutable source snapshots normalize once; compact exact UUID/digest collision chains replace the object index; retention-v1 JSON streams in 64 KiB chunks; string sharing is private to each journal and capped at 512 strings. Source history remains 100 MiB with 5,000 recent payloads. Retired identity capacity remains 100,000. Full-capacity refusal is preflighted before allocating another index or mutating the manifest.

The optional checkpoint accelerator is capped at 500 records/1 MiB. Larger histories retain all source evidence and explicitly use staged replay. Activity pages contain 100 events and start collapsed. Conversation/file detail children show the newest 100 plus an omission disclosure; the full retained display remains reachable through Activity and filters. Derived views are cached; active time-filter membership and uncertainty boundaries still update each second.

Canonical directory checks use native POSIX realpath. Pinned lease reads reject changed bytes/metadata, replacement, symlinks, hardlinks and unsafe permissions. Only concurrent in-flight ownership proofs share work. Healthy empty queue samples keep their actual timestamp and expire within 1.5 seconds. Background empty probes inspect directory metadata; any entry returns to the complete owned scan. Public scans, all payload admission/acknowledgment and retention mutations still prove ownership. Silent missed notifications and lease loss have executable regression cases.

## Work still required before closing T22

1. Attribute installed RSS peaks by phase: startup, normal traffic, burst, expiry transition and settled idle. Earlier same-build-family samples varied substantially; a single favorable RSS result is insufficient. Use heap allocation sampling and native/editor IPC evidence. Do not shrink fixtures, force GC during measured peaks, disable builtin extensions or reinterpret the raw idle target through subtraction.
2. Recheck settled CPU attribution for collector filesystem work, UI IPC and builtin/shared-host work. The final empty-probe change did not establish a resource pass. Preserve all failed runs and compare controls.
3. Repeat unprofiled installed qualification after an evidenced fix, preferably twice on unchanged binaries. Require all events, both helper p95 gates, provider coverage, raw idle CPU and installed RSS to pass. Repeat the three history cases if core/storage code changes.
4. The missing-helper native smoke confirms continued native usability, but **no automatic gap alarm was observed**: an absent helper cannot write its own loss marker. Preserve this limitation in release notes and diagnose missing activity using last receipt, explicit source-health/self-check results and actual native actions. Do not imply the collector knows every missing event.
5. Review B01–B16 in `INDEPENDENT-TEST-PLAN.md` against concrete executable cases. Current suites pass 213 unit tests, 35 process tests, 41 installed checks, five uncached Go race packages and Go vet, without skips. Titles alone do not prove every timing interleaving. Add deterministic barrier tests for any uncovered privacy/disable/config/lease substitution after sync, fallback retry, crash-before-ack, interrupted reset or cleanup substitution.

## Reproduction

Run resource workloads sequentially without another stress suite or profiler. The pinned local Go toolchain is already available.

```sh
npm run check
npm run build
npm run build:helper
npm run test:unit
node --test tests/integration/*.test.mjs
OVERWATCH_EXTENSION_RUN=t22-review-regression node scripts/test-extension.mjs
OVERWATCH_EXTENSION_RUN=t22-review-resource OVERWATCH_PERFORMANCE_ONLY=1 node scripts/test-extension.mjs
OVERWATCH_HISTORY_OUTPUT=t22-review-cold.json node scripts/measure-history-cap.mjs
OVERWATCH_HISTORY_RETIRED=100000 OVERWATCH_HISTORY_REFUSAL=1 OVERWATCH_HISTORY_OUTPUT=t22-review-retired.json node scripts/measure-history-cap.mjs
OVERWATCH_HISTORY_RETIRED=100000 OVERWATCH_HISTORY_REFUSAL=1 OVERWATCH_HISTORY_WARM=1 OVERWATCH_HISTORY_OUTPUT=t22-review-warm.json node scripts/measure-history-cap.mjs
node scripts/qualify-resources.mjs --editor .local/t08-extension-tests-t22-review-resource/performance.json --history docs/t22-review-cold.json --retired-history docs/t22-review-retired.json --warm-history docs/t22-review-warm.json --output docs/t22-review-gates.json
```

Native sockets/watchers and installed Cursor require execution outside the restrictive shell sandbox. Profiler runs (`OVERWATCH_PROFILE_CPU=1`, optionally `OVERWATCH_RESOURCE_TRACE=1`) are diagnostic only and the evaluator rejects them. Provider visibility is a matching TreeDataProvider row, not paint. First launch is not forced cold OS cache. RSS samples occur every 100 ms; heap samples every second. The normal-load visibility probe stops before burst; complete burst delivery is checked independently. Reports bind actual extension/helper hashes.

For a new native smoke, `node scripts/launch-native-qualification.mjs --launch` creates a new invented Git-root fixture and copies the current binaries. Enable explicitly in that window. Use native Read/edit, fault only its helper copy, restore it, disable, and inspect cleanup. Never fault the user's installed helper or collect real project files incidentally.

## After T22/G3 passes

T24's existing VSIX and four-check installed-package smoke predate these fixes and are stale. Rebuild twice, compare checksums, inspect the exact archive and match runtime hashes to qualified binaries. Test clean-profile ordinary native read/edit/disable plus reload, upgrade, uninstall and recovery against that exact package. Keep the private fixture-only and partial-attribution limits explicit. Do not publish as part of packaging.

T25 requires Angad's actual pilot with one or two parent conversations and subagents: three file inspections, a missing-activity diagnosis and an uncertainty/qualified-overlap case. Exact child-to-tool ownership remains unsupported; parent linkage, timing and model names cannot fill that gap. T26 depends on the actual pilot findings.


Same-build replication: [report](t22-current-replication-performance.json) measured raw idle CPU **0.984%**, incremental installed RSS **234.75 MiB**, and burst p95 **33.50 ms**, with the same extension/helper hashes and all 2,041 events. Its [gates](t22-current-replication-gates.json) still fail installed RSS. Together with the first run (1.386% CPU / 117.70 MiB RSS), this does not establish stable CPU or memory qualification. A diagnostic-only allocation profile was started before wrap-up; its outcome is recorded in the current verification/test handoff.


Allocation diagnostic completed before wrap-up: [sampled sites](t22-current-allocation-diagnostic.json). Largest estimated allocation sites were `projectFiles` (~140 MB), `conversationKey` (~106 MB), decoration `refresh` (~74 MB), reducer `viewSnapshot` (~59 MB) and `filesOf` (~56 MB). These totals include collected objects and measure allocation volume, not retained heap or exclusive peak RSS. The next controlled experiment should examine repeated scoped-key construction and rebuilding file projections/decoration fingerprints across frames. Preserve immutable snapshot ownership, exact scope boundaries, filter/freeze/privacy invalidation, and current display completeness. Do not cache caller-mutable identity objects or infer attribution from shared keys. Production binaries were unchanged during this diagnostic, which is excluded from qualification.

The two unprofiled runs also had different initial RSS baselines (273,383,424 versus 142,491,648 bytes), with peak RSS 396,804,096 versus 388,644,864 bytes. This partly explains the large variation in incremental RSS and does not make either failing budget pass. Phase-specific baseline/peak attribution and repeated unprofiled validation remain required. All four final installed-test fixtures were inspected after completion: publisher off; hooks, lease, reset marker and broker absent; inbox empty. Native smoke cleanup is recorded separately.
