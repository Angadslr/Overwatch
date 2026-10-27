# T11 independent lifecycles and collector health

Implemented and reviewed for Angad on 24 October 2026. T11 is complete; T12 has not started. Native collection remains fixture-gated. No new ordinary native Agent turn, platform qualification or exhaustive observation claim is introduced.

## Behavior inside Cursor

Reload the Extension Development Host window, then explicitly enable collection in the trusted invented fixture. Resolve pending native edit reviews before reloading. The updated view shows:

- **Turn complete · source report** for a generation with a qualified stop report. The conversation stays in the tree and can acquire another generation; completed operations from the previous generation are not reopened.
- **Completion not observed** after a request has no matching terminal for 30 seconds. This changes presentation, not its source outcome. It does not say the action failed, succeeded or is stuck.
- **Live state unknown after reload** for replayed open operations. Replayed completed operations retain their terminal evidence. A fresh matching completion resolves a replayed request; unrelated fresh activity does not.
- **Collector ready · awaiting first native event · coverage partial** after enable. Loading history does not verify fresh native delivery. Fresh qualified source receipt changes that delivery dimension while coverage remains partial.

Conversation tooltips list qualified generation states, with at most 20 retained turn records displayed and a count for additional records. File/tool tooltips show source evidence, missing-start status and independent live state. Unknown file actor, persistence and acceptance remain explicit. Shell/MCP observations have tool labels and no inferred internal file targets.

## Projection semantics

`src/core/lifecycle.ts` owns bounded conversation and generation projections, keyed by the shared collector/environment/workspace/worktree namespace plus explicit source conversation/generation IDs. Source session start may establish open conversation evidence. A qualified generation stop can establish complete, failed or aborted turn evidence; it does not close the conversation or complete its operations. Missing generation IDs remain unscoped. Child lifecycle reports are excluded from parent generation termination and continue through T09's qualified child projection.

Late ordinary activity cannot regress a generation terminal. Same-outcome generation terminal reports retain that outcome; conflicting terminal categories expose ambiguity. Missing earlier activity is disclosed and can be enriched by a later matching observation. Reusing a generation ID does not reopen terminal state based on arrival order. Explicit conversation-end handling exists at the normalized contract level, but the current native adapter still rejects unqualified sessionEnd and does not install that hook.

`FileActivityStore` preserves requested/started/terminal source phases, retains ambiguity and supplies a separate `liveState`. A late request cannot regress an explicit start or terminal. Exact event-ID replay is idempotent. Distinct repeated operation terminals remain ambiguous because source-call reuse cannot be disambiguated safely. The 30-second threshold uses the earliest observed request/start receipt and an injected clock. Clock rollback does not invent a terminal outcome. After-file-edit remains an independent report and never becomes saved or accepted through these transitions.

`markLiveStateUnknown()` plus replay origin prevents an existing in-memory store from reviving recent activity on re-enable when duplicate replay is ignored. Matching terminal evidence still resolves the operation. Conversation records remain available for inspection even when live state is unknown; availability does not imply a native chat control or current execution.

The source journal remains authoritative and unchanged. Lifecycle/health/live-state projections are derived; no schema change, source-content retention or filesystem-based reinterpretation of historical identity is required.

## Readiness, delivery and coverage

`src/core/health.ts` separates transport state, publisher configuration, fresh source receipt, source gaps and fixed partial coverage. Publisher configuration means the owned executable integration and collector have been configured; it does not prove helper execution or native activity. Historical journal facts and self-check/diagnostic records cannot satisfy fresh source delivery.

The manager labels prior journal records as replay. Delayed spool records with immutable receipt timestamps predating collection enable are also historical. Receipt time is used for freshness only, never identity or actor assignment. This local freshness rule assumes the qualified same-machine clock; clock changes can conservatively classify a fresh record as historical. Source-provided IDs remain the sole correlation inputs.

Recognized source gaps stay distinct from transport failures/rejections. Transport degradation remains visible for the current collection even if another event arrives. A collection restart resets current delivery evidence; it does not erase retained source facts. A quiet source is not declared disconnected by a timer, and no absence manufactures a successful completion.

Failed disable/cleanup reports disconnected/unknown rather than off or ready. An already-enabled manager in that state refuses a false ready re-enable; general recovery remains later lifecycle work. No new automatic lease takeover or unsafe config replacement is introduced.

## Bounds and validation

The lifecycle projection retains at most 10,000 conversations, 10,000 generation records and 100,000 seen event identities, disclosing dropped coverage at bounds. Generation terminal categories are bounded; operation detail/deduplication bounds remain from T07. Report output caps conversations/turns at 100 each. All new core logic is editor- and Node-independent; filesystem/host APIs remain in the integration layer.

Implementation was split into core semantics and editor integration/verification because wiring replay origin, status and actual TreeItems exceeded the initial 3–4-file estimate. No dependency, Go source or wire-contract changes were needed. General native activation and the six-name fixture path bridge retain their prior boundaries.

## Actual verification and review

On 24 October 2026:

- Generated contracts, strict TypeScript and build passed.
- **89 unit tests passed.** New cases use a fake clock for exact 29,999/30,000 ms aging, late terminals, missing starts, explicit starts, duplicate IDs, generation/call reuse, namespace separation, abort before tool failure, clock rollback and reload/re-enable. Captured T08 native metadata replays a completed generation without proving current liveness. Health and manager tests cover delayed pre-enable spool input, self-checks, partial coverage, transport degradation and failed cleanup.
- **10 real helper-process integration tests passed.** The compiled helper response/privacy/spool/replay contracts remain intact.
- **14 checks passed in the installed Cursor extension host**, editor API 1.128.0 / extension-host Node 24.19.0. Real TreeItems show turn completion and replay live-unknown labels; a new generation preserves the old terminal, and a fresh matching completion resolves a replayed request. Correct file opening, privacy, aliases, child evidence and disabled publication remain covered. The saved [host result](t11-extension-host-verification.json) records `nativeDelivery: false`: input is synthetic and is not a new native Agent delivery claim. Ordinary native delivery evidence remains T08.

Manual review preserved explicit operation starts, bounded generation tooltips, separated delayed historical receipt from fresh delivery, and prevented failed cleanup from reporting ready. Synthetic test publication now uses complete atomic ready files; test cleanup disables collectors before removing their fixture directories. Both T11 host fixtures finished with publisher disabled, owned hooks/leases absent and zero ready files. No real-project/global hooks were changed and no release was created.
