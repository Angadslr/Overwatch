# T07 — Cursor source facts and file evidence

Implemented and reviewed for Angad on 22 October 2026. `src/adapters/cursorHooks.ts` maps validated source envelopes to event-v1; `src/core/reducers.ts` maintains a bounded, replayable file-evidence projection. Neither module installs hooks or editor UI.

## Mapping and replay

`normalizeCursorEnvelope` validates transport shape, measured source version and hook capability, then returns a normalized event plus an optional hashed path hint. `normalizeJournalRecord` preserves the durable source-journal ingestion sequence. Each source observation retains its immutable event/operation identity; grouping happens in the reducer without rewriting journal evidence. The adapter validates its output against event-v1.

T07 adds a required envelope receipt timestamp, matching metadata receipt time when metadata exists. Diagnostic envelopes receive a timestamp once before publication so replay does not invent a new receipt time. This refines the unreleased T06 transport contract; no production data or installed collector required migration. Normalized events are derived from the durable source journal rather than written to a second journal.

| Qualified source observation | Normalized fact |
| --- | --- |
| Generic pre-tool / before-read | Requested; unknown outcome |
| Generic post-tool | Source-reported completion/success for that tool category |
| Generic tool failure | Failed/error or denied; interrupted boolean true means cancelled/aborted |
| After-file-edit | Observed edit report; unpaired, with unknown completion/persistence |
| Before-shell / before-MCP | Tool request, with no inferred file targets |
| After-shell / after-MCP | Observation; no success inferred from output grammar |
| Session start | Conversation-scoped lifecycle start |
| Stop | Generation-scoped lifecycle report, never conversation closure |
| Child lifecycle | Child-scoped fact; direct supplied child/parent relationship may be retained |
| Parse/coverage diagnostic | Self-check transport gap; unknown action outcome |

Unknown generic tool categories stay unknown. Raw outputs are never parsed for success, file contents, edits or model use: the generic post-hook itself supplies the tool-completion report. A successful source report does not prove saved bytes, model consumption or acceptance. Session-end metadata remains unsupported. Source invalid-field counters produce an explicit partial-coverage limitation.

File facts keep actor scope unknown and retain source conversation/generation IDs only as source-session context. A child lifecycle relationship never becomes a child-to-file ownership join. No PID, model, description or arrival-time heuristic is used.

## Paths

The helper now hashes the measured nested `file_path`, `path` and `target_file` aliases as well as top-level paths. Matching aliases yield one hint; conflicting aliases omit the hint and increment invalid-field coverage. No raw argument value or path is persisted.

Current normalized targets are unresolved. The reducer labels these identities `source-hint`, scoped by collector/environment/workspace/worktree, rather than presenting them as physical file keys. Same spelling through a symlink or alternate absolute/relative path can therefore remain separate. T10 must implement safe visible paths, containment, exclusions and physical identity before navigation or canonical file equivalence can be claimed. The reducer also supports already-qualified workspace targets for later adapters, but this Cursor adapter does not fabricate them.

## Reducer semantics and bounds

`FileActivityStore.apply` validates and copies normalized facts, deduplicates immutable event identity within its namespace, and retains file-related observations. `snapshot` exposes operations, file evidence, transport-gap count and dropped-detail coverage. Read completions, completed edit tools and edit reports have separate counters. Persistence and acceptance remain explicitly unknown.

Source-call grouping requires collector/environment/workspace/worktree/conversation/generation/operation-kind/call ID. A generic read start and specialized before-read may corroborate one request. A completion arriving first has missing-start evidence until an explicitly matching start arrives. A start alone retains missing-completion evidence and never becomes completed.

Missing call IDs remain separate observations. Missing scope is ambiguous and cannot pair. Repeated requests with distinct call IDs remain distinct. Same-kind call reuse, multiple terminal reports, repeated same-hook observations or conflicting targets make the entire bucket ambiguous; every event ID remains present, with no claimed unique-completion count. Read and Write reuse of the same source call ID stays separate by operation kind. `afterFileEdit` always remains unpaired, even if an unexpected call field is supplied.

The store retains at most 10,000 detailed observations and 100,000 seen event identities, aligned with the transport's bounded journal. Old detail is evicted by complete bucket, increments coverage loss, and retains an identity tombstone. Retired source-call buckets remain ambiguous if later evidence arrives, preventing eviction from restoring false certainty. Recent file counters describe retained evidence, not lifetime totals. Reaching the identity limit stops applying new observations with visible coverage loss. Retention/checkpointing, physical file identity, overlap advisory logic and UI remain later tasks.

## Review and verification

Review focused on evidence claims, scope/call reuse, ordering, child attribution, decoder/path privacy, replay determinism and detail-bound behavior. Fixed findings:

- Diagnostic envelopes needed an immutable receipt time rather than replay-time timestamps.
- Generic nested paths needed the same hashed-hint policy as specialized hooks, without choosing between conflicting aliases.
- Detail eviction needed retained call-ambiguity tombstones as well as event deduplication.
- Collector shutdown needed to stop queued rescans before closing resources; concurrent close calls now share one shutdown operation.

Actual final checks: generated-contract freshness, strict TypeScript, build, 41 unit tests, 10 process integration tests, Go tests/race detector and `go vet` passed. Unit cases include captured T02/T03 metadata, supported read/edit variants, missing scope, repeated legitimate reads, same-kind call reuse, completion-before-start, denial/interruption, unknown tool/output categories, child/file separation, worktree/environment isolation, invalid-field coverage and detail eviction. The process test runs real Go hooks through spool and durable journal, normalizes/reduces them, reopens the collector and proves identical replay with no content markers or duplicate effect.

At T07 completion, no new native delivery claim was made. T08 subsequently connected and qualified the [native fixture tree](t08-vertical-slice.md); general visible/canonical path handling remains T10.

## T09/T10 follow-through — 23 October 2026

Reducer joins now share the core identity namespace used for persistent source-session aliases and qualified child lifecycle rows. T10 provides a canonical local path service used by the fixture opener and available to local adapters. Historical source hints remain unresolved: the current source envelope cannot reconstruct arbitrary paths, and replay does not reinterpret old activity using current disk state. See [identity/path implementation](identity-and-paths.md).

## T11 lifecycle follow-through — 24 October 2026

FileActivityStore now derives separate operation live-state labels with a fake-clock-testable 30-second boundary. Source phases/outcomes stay unchanged. Replay marks open state unknown while matching terminal evidence remains terminal. Shell/MCP requests retain operation-level unknown completion without file targets or internal file attribution. Separate conversation/generation projections and collector/source health are described in [T11 verification](lifecycle-and-health.md).

## T12 local observations — 24 October 2026

Independent disk/editor facts now use LocalObservationStore rather than the agent operation reducer. They retain unknown actor and outcome, and cannot verify native delivery or increment source read counts. Missing paths may carry a checked display locator without a physical identity. Watcher/editor lifecycle, dirty-state ordering, exclusions and host-memory limits are recorded in [T12 verification](file-observations.md).
