# Implementation plan: Cursor Agent Supervision

Prepared for Angad · 20 October 2026 · Version 1.0 · Proposed implementation, not a shipped extension.

Execution update · 22 October 2026: T01–T08, G0 and G1 are complete for the reduced local observation profile on Cursor 3.26.16/macOS arm64; historical T01 read/edit evidence also covers 3.25.9. Explicit project hooks are selected because the plugin API is unavailable. Child-to-tool joins and session-end delivery remain unavailable; saved bytes and Keep/Undo are separate evidence. See [qualification](docs/phase-a-qualification.md), [decision](docs/decisions/native-integration.md), and [todo.md](todo.md). The Go privacy pipeline, [T06 durable local transport](docs/local-transport.md), and [T07 file-evidence projection](docs/cursor-file-projection.md) are implemented. The [T08 native fixture tree](docs/t08-vertical-slice.md) is implemented and qualified in development mode. A six-name fixture bridge supports current-file opening; general physical/visible path handling remains T10. T09 stable conversation aliases are next.

## 1. Outcome and scope

Build a supervision extension that lives inside Cursor and shows what Angad’s native Cursor agents are doing to files. A normal Cursor Agent conversation remains the place where Angad submits work. The extension supplies a persistent view of activity, identity, overlap, and telemetry health alongside that conversation.

The main question the product answers is: “Which conversation is working on this file, what action did it report, how recently, and what should I inspect?” It should answer in a few seconds without requiring Angad to reread several chats.

The initial deliverable is a local, observation-only personal alpha. Native Agent Chat is the required runtime. A standard editor extension is the delivery mechanism; a companion VS Code window is not part of the product. CLI, SDK, ACP, and cloud adapters remain separately scoped increments.

### Primary jobs

- While several conversations work, inspect the files each has requested or edited.
- Select a file and see all conversations associated with it, with evidence and timestamps.
- Notice overlapping edits to the same physical file and decide whether to inspect the work.
- Distinguish active tool execution, recent activity, completed turns, and missing telemetry.
- Review a bounded local history after a turn finishes or the editor reloads.
- Know when the extension cannot observe a workflow or identify an actor.

### MVP acceptance scenario

Angad enables supervision in a trusted Cursor workspace, starts two ordinary Agent conversations, asks one to read and edit a fixture file, and asks the other to inspect a different file. The sidebar separates their identities, file entries show evidence labels, and selecting an activity opens the correct file and details. A shared-file edit produces an overlap advisory. An unrelated formatter write appears as unattributed. Reload preserves recent history without implying that old operations are still running. Disabling supervision removes its integration and does not break Agent Chat.

## 2. Product principles and non-goals

Trustworthy uncertainty is part of the interface. A missing completion is unknown; a watcher change has no actor; a pre-read is an attempt; a completed edit is not human acceptance. Persist these distinctions in the model so UI copy cannot accidentally erase them.

Use local metadata as the default data product. Do not store raw file contents, prompts, shell commands, tool output, email addresses, transcripts, assistant responses, or reasoning. Source data may contain them, so projection must happen before it reaches a spool or database.

The first release does not provide a new agent runner, automate task assignment, replace Cursor’s conversations, replay agent prompts, estimate billing, read Cursor’s private state databases, or guarantee exhaustive model-context visibility. It also does not claim to pause a native chat, intercept every write, restore files automatically, or prove that overlapping edits caused a merge conflict.

No SaaS account, backend, public port, analytics service, or additional model call is required for the core workflow.

## 3. Evidence and research boundary

Official documentation supports hooks and extension registration of plugin directories. The proposed combination is an engineering design that must pass the installed-build probe. The research ledger separates documented capabilities from unresolved runtime behavior. [Cursor extension API](https://cursor.com/docs/extension-api), [Cursor hooks](https://cursor.com/docs/hooks)

Phase A resolved the initial integration scope: explicit project hooks, tested build 3.26.16/macOS arm64, tool-kind-partitioned call joins, no retained child-to-tool source join, and no inferred acceptance/persistence. Child file tools can carry independent conversation IDs; render these as unlinked source sessions rather than asserting they are top-level chats or assigning them to a nearby parent. Native stop(aborted) can precede a tool failure; shell completion hooks alone do not prove success. Only the captured field profile is qualified. Production performance is unmeasured.

All defaults, limits, schemas, file layouts, and schedules below are proposed product choices. They may change when discovery produces evidence, but any change must preserve the primary native-chat workflow and the evidence distinctions.

## 4. Release scope and capability matrix

| Capability | Personal alpha | Later increment | Required limitation |
|---|---|---|---|
| Ordinary native local Agent conversations | Required | Maintain | Feature-test on named Cursor build |
| Several top-level conversations | Required | Maintain | Separate conversation keys |
| Child lifecycle | Show when evidenced | Improve hierarchy | Creation request and actual running state differ |
| Exact child file attribution | Conditional | Upstream/API dependent | Parent-only or unknown when join evidence is absent |
| File attempts and tool completions | Required where surfaced | Broaden fixtures | No generic shell-internal read audit |
| File tree and activity list | Required | Optional heatmap | Native tree is sufficient for alpha |
| Overlap advisory | Required | Better stale-context detection | Advisory, not a filesystem lock |
| Tool-edit metadata and current file opening | Required | Snapshot-backed historical diff | No invented before state |
| Persistent metadata history | Required | User-selected export | Bounded and locally stored |
| Multiple distinct workspace windows | Conditional on scope probe | Broader routing | No cross-window identity guessing |
| Two windows on one physical checkout | Diagnose/decline duplicate collection | Shared collector if demanded | Never silently double-count |
| Remote SSH, WSL, containers | Explicitly unqualified | Separate gate | Collector must run next to agent tools |
| Cloud agents | Outside alpha | In-Cursor adapter | Separate auth, identity, transport, evidence |
| Native chat stop/focus controls | No unverified controls | Only documented, tested APIs | No guessed internal commands |
| Approval/blocking policies | Outside alpha | Narrow, tested hook controls | Not a security boundary |
| Inline Tab activity | Off by default | Separate actor class | Never label as Agent Chat |

Provisional first platform: macOS Apple Silicon. Confirm Angad’s development machine in T01. Cross-platform packaging is a later gate, not an assumption that binaries work everywhere.

## 5. User experience

### 5.1 Entry point and layout

Contribute one Activity Bar container titled “Agent Supervision.” Its primary tree has three roots: Conversations, Files, and Attention. Provide an optional activity list in the bottom panel, implemented as another native tree for the alpha. Share the same projection store so filtering and counts agree.

```text
Agent Supervision                             Coverage: Partial
  Conversations
    Agent A · Turn complete · seen 12s ago
      Read completed       src/auth/session.ts
      Edit reported        src/auth/session.ts
    Agent B · Tool running · seen 1s ago
      Read requested       src/api/client.ts
      Child activity       2 children, file attribution partial
  Files
    src/auth/session.ts    W · A, B · inspect overlap
    src/api/client.ts     R · B
  Attention
    Shared-file edits     1
    Unknown completion    1
    Unattributed changes  2
```

The example is a layout contract, not measured behavior. If only read attempts are available, it must say “Read requested” rather than “Read completed.”

### 5.2 Conversation identity

Use a local alias such as Agent A, Agent B, and a short stable identifier. Allow Angad to rename an alias without modifying the actual Cursor conversation. Reuse the alias across turns of the same conversation. Display the workspace or worktree when ambiguity exists.

Conversation titles are not required. Do not harvest prompt text to make titles. A model badge is optional metadata, not a unique identity. Two agents using the same model stay distinct.

### 5.3 File details

Selecting a file shows its relative path, physical workspace/worktree label, recent actors, exact evidence categories, last observation time, operation status, and source health. Show “Actor unknown” where necessary. The detail must disclose if the path was normalized, mapped from another environment, excluded, or no longer exists.

File click opens the current resource in Cursor. Delete events open details rather than recreating a missing file. A failed open should preserve the event and show a concise reason. Do not let an event payload construct an arbitrary command URI.

### 5.4 Explorer decorations

Use short badges and accessible text: `R` for read activity, `W` for edit activity, `!` for attention, and `?` for uncertain attribution. Tooltip includes the specific evidence and actor count. Priority is attention, edit, read, then uncertainty, with full detail in the supervision view. Update only affected URIs.

Use theme colors and text/icons together. Do not promise arbitrary animation or one independent color per actor in the built-in Explorer. Use actor labels in the custom tree. Standard tree and decoration interfaces provide the underlying editor affordances. [Tree views](https://code.visualstudio.com/api/extension-guides/tree-view), [Extension API reference](https://code.visualstudio.com/api/references/vscode-api)

### 5.5 Activity and attention behavior

Filter by conversation, operation, evidence, workspace, and time range. Pin a conversation locally. Group repeated file activity visually while retaining individual event identities. Follow newest activity only when enabled; new events should not steal keyboard focus or change an inspected file.

Attention items are actionable explanations: “Two conversations reported edits to this physical file within 30 seconds,” “Tool completion not observed,” or “Collector storage is full.” Show the evidence behind the advisory on selection. Do not show a generic red error because ordinary agent activity is quiet.

Notifications default to none for reads and successful edits. Offer optional notifications for a new overlap advisory or broken collection. Deduplicate by advisory identity and suppress repeated notifications while the condition remains unchanged.

### 5.6 Commands

| Proposed command ID | Result |
|---|---|
| `agentSupervision.enable` | Enable integration for eligible workspace and run readiness checks |
| `agentSupervision.disable` | Remove owned integration and stop collecting new events |
| `agentSupervision.open` | Reveal supervision view |
| `agentSupervision.inspectFile` | Show file evidence and current resource |
| `agentSupervision.filterConversation` | Apply conversation filter |
| `agentSupervision.renameAlias` | Change local display alias |
| `agentSupervision.freezeDisplay` | Freeze view updates while collection continues; show banner |
| `agentSupervision.resumeDisplay` | Apply buffered projection updates |
| `agentSupervision.clearHistory` | Delete extension-owned history after showing exact scope |
| `agentSupervision.exportDiagnostics` | Produce a local metadata-only diagnostic bundle |
| `agentSupervision.runSelfCheck` | Exercise extension/helper/spool readiness without starting a paid agent |

“Disable collection,” “Freeze display,” and “Stop agent” are different concepts. Only the first two are alpha features. Native stop/focus actions must wait for a documented interface and tests against the target Cursor build.

## 6. Architecture and trade-offs

Use a TypeScript editor extension, a hook-bearing Cursor plugin, and a small Go helper. The helper uses only the Go standard library and ships as an executable for each supported platform. This adds a build step, but avoids requiring an unrelated Node or Python installation in the environment that Cursor uses to run hooks. Start with one platform package; add targets when demand justifies them.

```text
Native Cursor Agent conversations
        |
        | documented hook invocations
        v
Bundled/generated Cursor plugin
        |
        v
Native helper: validate -> project metadata -> atomic event file
        |                                     |
        | valid hook response                  v
        +--------------------------> Local spool directory
                                              |
                                              v
Cursor extension: ingest -> normalize -> journal -> projections
                                              |
                      +-----------------------+--------------------+
                      v                       v                    v
              Conversation/file trees  Explorer decorations   Activity/details

Filesystem/buffer notifications -> separate observational adapter -> same model
```

The spool decouples a short-lived hook invocation from extension availability. No hook waits for a dashboard refresh, database query, network service, or human response. An HTTP collector is unnecessary for the first release. If performance later requires a daemon or IPC transport, preserve the same normalized contract.

### Responsibilities

| Component | Owns | Must not own |
|---|---|---|
| Host capability detector | Cursor feature detection and platform qualification | Claims based solely on app name |
| Plugin integration manager | Generate/register/unregister owned integration | Agent orchestration or foreign hook edits |
| Native helper | Validate bounded input, project safe metadata, publish spool event, valid hook response | UI state, code history, arbitrary command execution |
| Spool ingester | Directory scan, claim, validation, retry, quarantine, acknowledgments | Guessing source meaning |
| Cursor adapter | Map supported source variants into normalized facts | Inventing child identity or completion |
| File observation adapter | Disk/buffer observations with unknown actor | Read tracking |
| Journal | Durable event append, recovery, rotation, retention | Changing evidence |
| Reducers | Conversation, operation, file, overlap, and health projections | Filesystem mutation |
| UI providers | Render existing state and route user actions | Inferring agent success |

The core package must not import `vscode`; this allows deterministic replay tests. Keep source-version-specific parsing in adapters. Use explicit interfaces at these boundaries without creating a general multi-vendor framework for an unvalidated product.

## 7. Native integration strategy

### Preferred path

Feature-detect plugin registration on the installed Cursor extension API. Materialize an extension-owned plugin under extension storage, with absolute, platform-correct launcher paths. Register the containing plugin directory and unregister it on disable/disposal. Include a manifest so ownership and version are explicit. Cursor documents plugin packaging and runtime registration. [Extension API](https://cursor.com/docs/extension-api), [Plugin format](https://cursor.com/docs/reference/plugins)

Generation must use proper JSON serialization and platform-specific command quoting, not direct interpolation of workspace text into shell commands. Plugin command parameters are limited to trusted extension-generated paths and event categories. Hook payload fields are data and never become executable command fragments.

Before any production implementation, T01 proves hook discovery, effective command working directory, path resolution, registration scope, reload behavior, existing conversation coverage, and removal. Generate the smallest hook set that satisfies the measured contract. Generic lifecycle events are the primary operation source; specialized file events add evidence where available. Do not install every possible hook by default.

### Compatibility fallback

If plugin registration is absent or hooks fail to load, evaluate explicit project-level hook integration. This is an intentional onboarding path with an exact diff, not a silent rewrite. Read and preserve every existing key and array entry. Back up the exact original bytes in extension storage, then add only owned entries and validate the result before replacing the file atomically.

Uninstall removes entries by recorded ownership and exact structural identity, preserving later user edits. Restore a full backup only when the file still matches the extension-owned post-install hash; otherwise produce a proposed cleanup diff. Unknown top-level schema or invalid JSON stops automated changes and provides manual instructions. Do not loosen existing permission controls.

If neither supported path observes native sessions, record a blocked integration result. A CLI wrapper is not an acceptable fallback for this product.

### Observation responses

The helper must emit exactly one schema-valid response for each configured event, even when telemetry fails. Permission-bearing observation handlers allow the action; other handlers return the minimal accepted observational response established in T01. Never write progress logs to stdout. Never inject follow-up prompts or context.

Treat malformed telemetry input as a collection problem, not grounds to deny a native action. The response path must be independent of spool writes. A helper crash or launcher failure remains possible, so the dashboard cannot guarantee zero effect on Cursor until failure behavior is measured. Include response fixtures and a failure test for every installed hook. [Hook response behavior](https://cursor.com/docs/hooks)

## 8. Proposed normalized event contract

T04 implements a versioned JSON Schema, generated TypeScript shape types and a strict validation/projection boundary; see [event contract](docs/event-contract.md). T05 adds matching generated Go shape types. T06 validates/journals a separate source envelope; T07 derives normalized facts with the durable source sequence. The following names are internal product fields, not a promised copy of Cursor payloads.

| Field | Type and rule |
|---|---|
| `schemaVersion` | Integer, initially `1` |
| `eventId` | Random immutable identifier assigned by helper/source adapter before first publish |
| `collectorId` | Local installation/collector identity; no user email |
| `source` | `cursor-hook`, `filesystem`, `editor-buffer`, `self-check`, later `cursor-cloud` |
| `sourceVersion` | Cursor build or adapter fixture version when known |
| `sourceEvent` | Original event category from an allowlist |
| `receivedAt` | Helper receipt timestamp in UTC; do not imply original tool timestamp |
| `sourceOccurredAt` | Optional, only when source explicitly supplies it |
| `ingestSequence` | Collector-assigned durable ordering; not present in helper spool input |
| `environmentId` | Local/remote host namespace, explicit even when only local is supported |
| `workspaceId` | Opaque canonical workspace identity |
| `worktreeId` | Optional physical worktree identity |
| `conversationId` | Source conversation identifier when present |
| `generationId` | Source turn/generation identifier when present |
| `actorId` | Specific source actor only when proven |
| `actorScope` | `conversation`, `child`, `unknown` |
| `parentActorId` | Optional proven relationship |
| `operationId` | Opaque normalized operation/observation identity; unpaired facts use a local identity |
| `sourceCallId` | Optional opaque source call key; required for source-call or ambiguous correlation |
| `lifecycleScope` | Conversation, generation or child for lifecycle facts; stop is generation-scoped |
| `operation` | `read`, `edit`, `create`, `delete`, `rename`, `search`, `shell`, `mcp`, `lifecycle`, `unknown` |
| `phase` | `requested`, `started`, `completed`, `failed`, `cancelled`, `observed` |
| `outcome` | `success`, `error`, `denied`, `aborted`, `unknown` |
| `targets` | Bounded array of file/directory target records; empty for tools with no known paths |
| `evidence` | Structured provenance and limitations described below |
| `metrics` | Optional safe counts/duration, never raw output |

Target records carry `fileKey`, `relativePath`, `pathScope`, `pathKind`, and optionally a rename destination. An absolute external path is not stored by default. Maintain private path resolution in extension storage only when necessary to open an allowed resource; export uses relative paths or redacted aliases.

Example of the product’s own normalized event:

```json
{
  "schemaVersion": 1,
  "eventId": "17db1d2a-84e3-4fe7-a70b-b51a6520c80d",
  "collectorId": "local-01",
  "source": "cursor-hook",
  "sourceVersion": "fixture-profile-01",
  "sourceEvent": "preToolUse",
  "receivedAt": "2026-10-20T19:00:00.000Z",
  "environmentId": "local-01",
  "workspaceId": "workspace-a1",
  "worktreeId": "worktree-main",
  "conversationId": "fixture-conversation-a",
  "generationId": "fixture-generation-2",
  "actorScope": "conversation",
  "operationId": "fixture-read-operation-7",
  "sourceCallId": "fixture-call-7",
  "operation": "read",
  "phase": "requested",
  "outcome": "unknown",
  "targets": [
    {
      "fileKey": "file-027",
      "relativePath": "src/auth/session.ts",
      "pathScope": "workspace",
      "pathKind": "file"
    }
  ],
  "evidence": {
    "activity": "source-reported",
    "attribution": "conversation",
    "completion": "not-observed",
    "diskPersistence": "not-observed",
    "correlation": "source-call-id",
    "limitations": ["model-use-not-established", "child-identity-not-established"]
  },
  "metrics": {}
}
```

### Evidence is multidimensional

Avoid a single numerical confidence score. It hides which property is uncertain. Maintain independent values for activity provenance, actor attribution, operation completion, disk persistence, and correlation quality. Show the relevant dimensions in details.

An edit can have source-reported conversation attribution and unknown disk persistence. A disk write can have observed persistence and unknown actor. A successful read tool can establish reported completion without establishing that the model relied on those bytes. These cases must remain distinguishable after export and replay.

## 9. Event mapping and correlation

Use the measured fixture profile to map source categories into product events. The table specifies intended handling, not an assertion that all payload fields are available.

| Source category | Product handling | Evidence limit |
|---|---|---|
| Session start | Create observed conversation if identity present | Existing chats may be discovered later |
| Generation/prompt boundary | Start or discover turn using source generation | Drop prompt content |
| Generic pre-tool | Record requested/started operation according to measured timing | An invocation request is not proof of execution |
| Generic post-tool | Complete matching operation when call ID and success semantics are valid | Missing/unknown result grammar stays unknown |
| Generic tool failure | Mark error, denied, or aborted only from recognized fields | Failure text need not be retained |
| File pre-read | Add a read-request evidence record | No completion from this event alone |
| File after-edit | Add reported edit evidence and safe counts | No user-acceptance inference |
| Child start/stop | Add lifecycle evidence and proven hierarchy edges | Ambiguous stop events do not complete a guessed child |
| Turn stop | Complete the matching generation when identity exists | Conversation may accept another turn |
| Session end | Close the observed session using explicit reason | Does not imply task validation success |
| Disk/buffer change | Add independent observation with unknown actor | No reads or causality from watcher alone |

Pair operations by environment + conversation + generation + measured tool/operation kind + source call ID, not call ID alone. Native discovery on 21 October 2026 found the same call ID reused for a Read and following Write within one generation. If a scoped ID and kind is reused for multiple cycles, retain separate observations or mark correlation ambiguous rather than guessing occurrence identity from arrival order. Preserve call IDs as opaque strings. If generation is missing, do not pretend turn scoping is known; use a source-specific unscoped partition and expose that limitation.

Generic and specialized hooks may report the same activity. Keep both raw normalized facts and combine them into one displayed activity only with a proven shared ID in the appropriate operation partition. The measured `beforeReadFile` shared its read ID; `afterFileEdit` lacked a call ID and remains separate. If no ID exists, show “Related observations” or group visually; do not deduplicate repeated legitimate reads by path and timestamp.

Handle completion-before-start by creating an operation with missing-start evidence. A later matching start enriches it without regressing terminal state. Duplicated `eventId` is ingestion-idempotent. Semantic deduplication across different event IDs requires a source-provided unique key; otherwise retain the events.

## 10. Identity, hierarchy, and file keys

Conversation identity is the minimum viable actor. Do not use a helper process PID as the agent ID: hook invocations are short-lived processes. Do not use model name, task text, or arrival order to join agents.

Child lifecycle support does not automatically prove child tool attribution. Generic operation payloads may expose only the parent conversation. If there are two similar child tasks, do not assign tools to whichever child started most recently. Keep the event at conversation scope and show the child lifecycle separately. The initial spike must explicitly test this ambiguity.

File identity includes environment, canonical physical worktree/root, and normalized relative path. The same repository-relative path in two worktrees is not the same physical file. Two worktrees can receive a logical “same repository path” comparison, but that must not create a physical-edit conflict.

Normalize separators and `.`/`..`; reject traversal out of the permitted root. Use longest containing root for multi-root workspaces. Resolve existing symlinks and real parent directories for new/deleted paths; preserve the displayed lexical path as well as canonical identity. When physical resolution is impossible, mark it unresolved rather than merging uncertain identities. Detect case sensitivity per supported filesystem or use a conservative non-merging fallback. Never lowercase every path globally.

Opaque file/workspace IDs may use a local keyed digest to avoid exporting absolute paths. Generate and store the key in extension-owned storage, never in a repository. Export does not include the key. Repository origin/branch labels are optional and must not be obtained by running untrusted repository scripts.

## 11. Lifecycle and health state machines

Keep three independent state machines.

| Entity | States | Key rule |
|---|---|---|
| Conversation | discovered, open, closed, unknown | Turn completion does not close conversation |
| Generation | discovered, activity-observed, complete, failed, aborted, unknown | Terminal state requires corresponding source evidence |
| Operation | requested, started, completed, failed, denied, aborted, completion-unknown | Aging clears live UI emphasis but does not manufacture success |

Maintain collector health separately: disabled, awaiting-first-event, healthy, degraded, disconnected, unsupported. A healthy local spool does not prove every agent action is observable. Show source coverage and transport health independently.

If no completion follows an operation for 30 seconds, change the UI to “Completion not observed” and keep the original start fact. Long-running shell/MCP activity can remain visibly age-labelled; do not declare it stuck. After an editor reload, previously open operations become “Live state unknown after reload” until fresh source evidence resolves them.

A self-check can prove helper execution, spool access, and ingestion, but cannot prove native agent delivery without a real native event. Readiness copy must distinguish “Collector ready” from “Native events verified.”

## 12. Spool transport, storage, and recovery

### Helper publication

Read hook input from stdin with a bounded decoder. Discard content-bearing fields while projecting only allowlisted metadata. Proposed raw input cap is 32 MiB and projected event cap is 16 KiB. When input exceeds the cap, emit the event-specific observation response and a small content-free coverage diagnostic if possible. Do not persist truncated raw payloads.

T06 publishes each event through a unique temporary file in an extension-owned inbox, syncs/closes it, atomically hard-links a no-replace ready name on the same filesystem, removes the temporary name and syncs the directory. This refines the proposed rename step to prevent overwriting an existing event. Restrict directory permissions on supported platforms. Retry publication with the same event ID within the invocation budget. Use no shared append file across concurrent helpers.

The spool path and publisher identity are extension-generated. Inputs cannot choose destinations. Validate the destination’s ownership and reject symlink substitution to an unrelated location. The threat model is accidental corruption and untrusted payloads; a local process running as the same user is not a cryptographically isolated adversary.

### Extension ingestion

Watch the inbox and perform a bounded rescan because notifications can coalesce or be lost. Validate filename shape, file type, size, schema, source profile, and allowed workspace before processing. Never execute data from a spool file. Move malformed files to a size-limited metadata-only quarantine or delete them according to documented retention; do not show their full contents in logs.

Append each accepted event to a journal before acknowledging/removing its ready file. Assign a durable ingestion sequence at that point. Batch disk sync with a defined maximum window; proposed bound is one second. Document that an abrupt machine/power loss can lose data inside that window. Extension crash recovery should replay acknowledged journal segments and reingest unacknowledged ready files idempotently.

### Store design

Use rotating append-only NDJSON journal segments plus small atomic projection checkpoints for the personal alpha. This keeps dependencies and native ABI requirements low. The ingester is the single writer to its journal. Checkpoints contain the last applied sequence and projection schema version; they are rebuildable from retained events.

Torn final lines are recoverable: keep the valid prefix, disclose recovery, and do not silently repair a damaged middle segment as if coverage were complete. Record gap markers. Build an event-ID index from retained segments/checkpoint metadata. Move to SQLite only if measured scale/replay time exceeds the budgets; do not add a database daemon.

### Bounds

| Resource | Proposed default | Behavior at bound |
|---|---:|---|
| Ready spool | 25 MiB or 10,000 files | T06 drops new telemetry at the approximate cap; preserves unacknowledged evidence, no agent blocking |
| Journal segment | 5 MiB | Rotate |
| Retained history | 7 days or 100 MiB, whichever first | Prune complete oldest segments, adjust projections and dedup index |
| In-memory recent events | 5,000 | Evict oldest UI details; persisted query remains available |
| Active operation records | 10,000 | Compact aged unknown records, show coverage degradation |
| Targets per event | 100 | Truncation count and coverage warning |
| UI refresh cadence | At most 5 refreshes/second | Batch affected nodes |
| Error log | 5 MiB rotating, metadata only | Rotate |

Per-invocation helpers enforce a cheap approximate spool cap. The ingester performs authoritative cleanup; concurrent publication can temporarily exceed the target. If disk is full or the collector is absent, telemetry loss is preferable to blocking agent work. Do not label the transport lossless.

Disabling collection must also disable/unregister its producer. Otherwise a disabled UI would continue receiving hook invocations. History deletion removes journal, projections, spool, and export staging for the selected installation/workspace, while preserving package binaries and unrelated configuration.

## 13. Window, workspace, and environment routing

The qualified project-hook route has one config and inbox per canonical physical checkout. Native activity from two windows over that checkout reached the same inbox without a second config. Start with one collector owner and passive secondary windows; collection covers enabled checkout activity, not only chats opened in the owner window. Hooks do not prove a source window identity. Keep plugin feature detection for future qualification; its scope remains unmeasured on this build because the API is absent.

For the personal alpha, use an extension-storage lease keyed by canonical workspace identity to detect duplicate collection. A lease contains owner, instance identity, heartbeat age, and schema version; create it exclusively and recover stale leases conservatively. A second window shows “This checkout is supervised in another window” with instructions to move supervision. It must not silently collect duplicates.

The lease alone cannot deduplicate multiple globally registered producers. The implementation gate must prove that the generated plugin/dispatch path results in one effective producer for the supervised workspace. If it cannot, use the explicit single project-hook fallback or leave the configuration unsupported. Do not build an unplanned shared daemon simply to obscure this uncertainty.

Separate worktrees are separate physical collection roots. Restrict generated plugin activity to enabled workspace roots after canonicalization. A global hook invocation for an unrelated project should emit its benign response without persisting telemetry for that project.

For remote support later, collect in the host where agent tools execute and map paths to editor resource URIs. Local `localhost`, local storage paths, and remote absolute paths are not interchangeable. An environment change invalidates prior collector health. [Remote extension architecture](https://code.visualstudio.com/api/advanced-topics/remote-extensions)

## 14. Overlap advisories

Call these advisories, not confirmed conflicts. They help Angad decide where to inspect without pretending to lock files.

| Condition | Proposed advisory | Severity |
|---|---|---|
| Two distinct conversations have explicit overlapping edit intervals on one physical file | Concurrent edit activity | High attention |
| Two distinct conversations report edits to one physical file within 30 seconds, no proven intervals | Recent edits by multiple conversations | Medium attention |
| A known successful read precedes another actor’s completed edit, then original actor edits | Possible stale context | Informational; evidence dependent |
| Watcher changes a file with no reliable actor link | Unattributed file change | Informational |
| Same relative path in different worktrees | Parallel worktree changes | Separate optional comparison; no physical conflict |

Advisory IDs include file key, involved actor set, category, and activity window. Refresh existing advisories instead of spamming new ones. Acknowledge/mute changes the local attention projection, not the underlying event history. Do not invent child conflicts when several ambiguous operations are attached to the same parent conversation.

An agent read attempt alone does not establish its content baseline. “Possible stale context” requires a successful read signal and ordering evidence; without those, show generic multi-actor activity. Even with ordering, do not claim the read bytes equal the later saved bytes.

## 15. File changes and diff policy

MVP details expose edit metadata and open the current file. A general watcher cannot identify every writer and cannot recover previous content. Editor buffer events and disk events remain separate because unsaved buffers can differ from the filesystem.

Do not reconstruct an authoritative historical diff from search/replace strings: matches can be ambiguous, line ranges may be absent, and subsequent edits can change the file. If Cursor reports safe edit counts, show them as reported counts rather than independently verified line deltas.

Historical diffs are an optional later mode with explicit content retention. Capture immutable before/after snapshots only when timing is proven, file is allowed, size is within limits, and no concurrent mutation invalidates attribution. Label the baseline and capture times. Missing baseline produces “Historical diff unavailable.” Current Git comparison can be offered separately as “Working tree versus selected revision,” never as one agent’s exact patch.

Use a read-only virtual document for retained snapshots and the editor’s diff command, without writing snapshots into the repository. [Virtual documents](https://code.visualstudio.com/api/extension-guides/virtual-documents)

## 16. Privacy and trust requirements

The helper projection allowlist is the primary privacy boundary. It includes source IDs, relative file paths, event categories, operation status, durations, counts, version, and opaque environment identity. Drop all unknown fields by default. Some known fields are deliberately omitted, including prompt text, task summaries, file content, tool arguments, outputs, user email, transcript locations, and reasoning.

For a read tool, extract the target path from the supported grammar and discard the rest. For shell/MCP tools, store category and safe operation identity, not the command, arguments, connection URL, environment variables, or result text. Exception messages can contain secrets; map them to error categories before logging.

Relative paths can still be sensitive. Export is an explicit user action with a path-redaction option enabled by default. Never upload diagnostics automatically. File identifiers do not make arbitrary data anonymous. Product analytics stays off; local counters for quality can be inspected and cleared.

Require a trusted workspace before registering executable integrations. In restricted mode, allow a static help/readiness view and inspection of previously retained metadata only if its workspace is explicitly selected. Enforce trust checks in command handlers. [Workspace Trust guidance](https://code.visualstudio.com/api/extension-guides/workspace-trust)

Exclude secret-like filenames and user-selected globs from visible path persistence by default. A safe exclusion event may increment a counter and state “Activity excluded by settings”; do not persist the sensitive path to explain why. Exclusions and upstream absence are separate coverage reasons.

Content retention, if later enabled, requires separate limits, explicit scope, and deletion behavior. It cannot silently turn on because a user asks to see a diff.

## 17. Failure behavior

| Failure | Required product behavior | Required agent behavior |
|---|---|---|
| Helper cannot write spool | Content-free error counter/health warning when detectable | Valid observation response, no intentional block |
| Extension not running | Spool bounded; disclose gap after restart | Work proceeds |
| Malformed payload | Reject telemetry and count schema mismatch | Response remains valid for installed hook |
| Unknown tool variant | Generic unknown operation, preserve safe IDs | No content-based parsing guesses |
| Missing completion | Completion-unknown label | No automatic interruption |
| Duplicate delivery | Same event ID applied once | No agent effect |
| Completion arrives first | Terminal fact retained with missing-start marker | No agent effect |
| Journal damaged | Recover valid retained data and disclose coverage gap | Work proceeds |
| Existing hook file invalid | Stop setup and explain exact issue | Preserve configuration |
| Child identity absent | Conversation-level grouping | No fabricated child ownership |
| Unsupported Cursor build | Readiness explanation and compatible fallback only | No internal patching |
| Disk/buffer mismatch | Show separate evidence and current state | No overwrite or restore |
| Second window same checkout | Explicit collection ownership conflict | No duplicate integration |

“No effect on agents” is a release test goal, not a claim established by this document. Launcher and hook-response failures must be exercised in the actual runtime.

## 18. Proposed settings and defaults

| Setting | Default | Meaning |
|---|---|---|
| `agentSupervision.enabled` | `false` until enabled | Workspace-scoped collection intent |
| `agentSupervision.showExplorerBadges` | `true` | Lightweight file indicators |
| `agentSupervision.followLatest` | `false` | Avoid focus movement |
| `agentSupervision.showReadAttempts` | `true` | Preserve attempts while labeling them |
| `agentSupervision.historyDays` | `7` | Retention ceiling |
| `agentSupervision.maxHistoryMiB` | `100` | Storage ceiling |
| `agentSupervision.recentActivitySeconds` | `30` | UI recency, not proof of ongoing execution |
| `agentSupervision.overlapWindowSeconds` | `30` | Advisory aggregation window |
| `agentSupervision.notifications` | `off` | Optional `attention` mode |
| `agentSupervision.pathExclusions` | Secret patterns plus user globs | Drop excluded path data before storage |
| `agentSupervision.captureContents` | `false` | Reserved for later snapshot increment; not exposed as functional in alpha |
| `agentSupervision.includeTab` | `false` | Separate optional producer class |

Validate ranges and reject nonsensical or excessive values. Limit settings that select executable paths to trusted user-level configuration; do not execute workspace-provided arbitrary helper commands.

## 19. Proposed source structure

```text
cursor-supervision/
  HANDOFF.md
  RESEARCH.md
  tasks/
    plan.md
    todo.md
  package.json
  tsconfig.json
  src/
    extension.ts
    host/capabilities.ts
    integration/pluginManager.ts
    integration/hookConfig.ts
    integration/workspaceLease.ts
    transport/spoolIngester.ts
    transport/journal.ts
    transport/retention.ts
    adapters/cursorHooks.ts
    adapters/fileObservations.ts
    core/contracts.ts
    core/identity.ts
    core/paths.ts
    core/reducers.ts
    core/overlap.ts
    core/health.ts
    ui/conversations.ts
    ui/files.ts
    ui/activity.ts
    ui/attention.ts
    ui/decorations.ts
    ui/details.ts
    commands.ts
  helper/
    go.mod
    cmd/cursor-supervision-hook/main.go
    internal/input/project.go
    internal/output/respond.go
    internal/spool/publish.go
  schemas/event-v1.schema.json
  cursor-plugins/agent-supervision/.cursor-plugin/plugin.json
  tests/
    fixtures/cursor/
    unit/
    integration/
    extension/
  docs/compatibility.md
  docs/native-smoke-test.md
  docs/privacy.md
```

These are responsibility boundaries, not a demand to create empty files. Create a module only when the corresponding implementation exists. Keep build-time plugin templates separate from generated runtime plugin files containing resolved launcher paths.

Use strict TypeScript, a small bundler, one test runner, and Go tests for the helper. Choose exact package versions after inspecting the target extension host. Do not set the extension engine requirement from the newest VS Code release without checking Cursor’s embedded API level. Use lockfiles and package inspection for reproducibility.

## 20. Delivery sequence and checkpoints

The full task list is [todo.md](todo.md); it is the source of execution status. This index avoids a second, diverging checklist.

| Phase | Tasks | User-visible result | Gate |
|---|---|---|---|
| Discovery | T01–T03 | Proven native integration and truthful support matrix | G0 |
| First vertical slice | T04–T08 | Native read/edit to a file view inside Cursor | G1 |
| Identity and evidence | T09–T13 | Separate conversations, lifecycle, honest file observations | G2a |
| Supervision workflow | T14–T18 | Activity inspection, overlap, details, filters, health | G2b |
| Reliability and onboarding | T19–T23 | Reload, bounded history, failure containment, clean disable | G3 |
| Personal beta | T24–T26 | Installable package and measured usefulness | G3 complete |
| Optional expansion | T27–T30 | Cross-platform, remote/cloud, or narrow controls | Separate gates |

Checkpoint reviews mean inspect concrete evidence and revise the plan if necessary. They are not mandatory user permission prompts for ordinary implementation work already requested. Only a material product scope change or new external action needs a new decision.

### Rough effort budget

| Work | Planning estimate |
|---|---:|
| Native compatibility and attribution discovery | 2–3 focused days |
| First usable vertical slice | 3–5 days |
| Identity, evidence, and supervision interactions | 4–6 days |
| Reliability, onboarding, packaging, personal beta | 6–10 days |
| Total personal alpha | 15–24 days after integration path is viable |

The estimate assumes one experienced engineer, one qualified initial platform, and no private Cursor API work. Discovery can invalidate it. Cross-platform expansion and active policy controls are additional scope. Use observed task completion time to revise the estimate after G1.

## 21. Verification strategy

### Contract and unit tests

Use sanitized captured fixtures and synthetic edge cases. Test schema projection, content exclusion, recognized tool variants, missing/extra fields, source correlation, path identity, worktrees, lifecycle reducers, overlap rules, and retention. Golden fixtures should express expected normalized facts, not snapshot every incidental UI label.

Keep malformed, oversized, and secret-containing fixture data invented. Assert that forbidden values do not occur in spool output, journals, logs, diagnostic exports, or projection checkpoints. A tool error containing a fake API token must not leak it.

### Integration tests

Launch the bundled helper as a real child process with fixture stdin. Assert exact stdout schema, exit behavior, publication, and error containment. Spawn concurrent helpers to stress atomic publication. Kill the ingester between journal append and spool acknowledgment and prove idempotent recovery. Corrupt the final journal line and a middle segment separately.

Drive the extension against synthetic event streams to validate views, URI opening, dirty-file behavior, and settings changes. Do not require paid Cursor runs for every test. Native delivery is covered by a small named smoke suite on the qualified Cursor build.

### Native smoke matrix

| Scenario | Expected observation |
|---|---|
| Explicit file read | Attempt appears; completion only if corresponding evidence arrives |
| Agent edit | Reported edit appears; disk/buffer state separately labelled |
| File create/delete/rename | Correct supported mapping or honest unknown; no reconstructed action from watcher alone |
| Failed/nonexistent read | Failed or unknown completion; never completed success |
| Denied operation | Denied if evidenced; no success count |
| Shell `cat`, redirected write, and script | Tool activity observed; internal reads remain outside proven coverage |
| MCP tool touching files | MCP activity; file targets only from supported payload contract |
| Two conversations, same model | Distinct stable aliases and file histories |
| Two simultaneous similar children | No heuristic child assignment |
| Different worktrees, same relative file | No physical overlap false positive |
| User edit/formatter write | Unattributed observation |
| Keep/Undo/unsaved edit | No incorrect acceptance claim |
| Extension reload mid-tool | History retained; live state marked unknown |
| Disable/upgrade/uninstall | Owned integration removed or intentionally upgraded |
| Restricted workspace | No helper/plugin execution |
| Collector unavailable/full | Native actions continue; degradation disclosed |

Record actual, missing, and unexpected results with version/date labels. Unsupported scenarios can remain outside release scope, but product copy must match the matrix. A claimed capability requires a passing fixture and native evidence.

### Performance targets

Proposed budgets on the first qualified machine: helper p95 under 50 ms after process launch, hook-to-visible metadata p95 under one second at 20 events/second, burst absorption at 200 events/second for ten seconds without exceeding limits, idle CPU below 1% on the test machine, incremental extension memory below 75 MiB, and retained-history reload below two seconds at the configured 100 MiB cap or a visible staged loading state.

Measure process startup separately. Include cold and warm runs, file-count/storage conditions, and hardware in reports. Targets are not product claims until measured. If cold launch overhead makes the native workflow noticeably slower, reduce hooks or revise transport before adding visual polish.

## 22. Operational and support runbook

If no activity appears, check host support, workspace trust, enabled scope, registration success, producer self-check, inbox permissions, ingestion progress, and whether a fresh native conversation has emitted an event. Explain the first failing layer. Never suggest deleting Cursor’s state database.

If a file has the wrong actor, inspect the evidence/correlation fields and source fixture profile. Disable that mapping if necessary; preserve unknown attribution. Do not patch it with timestamp heuristics.

If the UI is slow, inspect event rate, refresh count, queue age, memory, journal replay time, and the number of visible nodes. Disable decoration updates first as a reversible diagnostic; continue bounded collection.

If an agent is unexpectedly blocked, first disable the extension’s owned producer and verify native behavior. Inspect event-specific helper responses and launch errors using invented fixtures. Do not change other hooks or switch them to permissive settings.

Diagnostics include extension/Cursor versions, platform, enabled capability flags, counters, source health, queue sizes, and categorized errors. They exclude raw source payloads and absolute paths by default. Angad can review a local export before sharing it.

## 23. Lean validation and success metrics

Validate the personal problem before building a broader agent platform. Recruit Angad as the first design user and later 5–10 Cursor users who routinely run multiple conversations. Observe normal work instead of asking only whether they like the idea.

Proposed North Star: weekly supervised native Cursor sessions in which a user opens file evidence or an overlap advisory and reports that it helped decide what to inspect or change. An open panel alone is not demonstrated value.

Track locally: time from enable to first native event, fraction of sessions with file-evidence inspection, unknown attribution share, overlap advisory precision from reviewed samples, setup failures, helper overhead, and whether users return after the first week. Do not use raw event volume as the success metric.

Predeclare pilot thresholds as hypotheses: setup succeeds for at least 8 of 10 qualified testers; first useful event within two minutes of a deliberate fixture action; at least half inspect evidence on three separate days; fewer than one in five reviewed overlap advisories is judged misleading. Revise from evidence rather than treating small samples as statistical proof.

If users mainly value conversation status, simplify the file view. If child-level identity is essential but unsupported, pursue an upstream integration request with concrete missing fields and fixtures. Do not spend weeks hiding incomplete attribution behind elaborate visuals.

## 24. Risks and mitigation

| Risk | Impact | Response |
|---|---|---|
| Native hooks differ from docs | Product feasibility | Front-load installed-build probe and capability profiles |
| Child tools lack reliable identity | Incorrect ownership | Conversation-level fallback; upstream request |
| Hook duplication across windows | Inflated activity | Scope test, ownership lease, one effective producer requirement |
| Shell/index reads invisible | Misleading completeness | Persistent coverage explanation |
| Hook output corrupts permission flow | Agent disruption | Exact response tests and immediate disable path |
| User code leaks into telemetry | Trust failure | Projection before persistence, deny-by-default fields, leak tests |
| File changes race with snapshots | False patch attribution | Metadata-only alpha; conservative snapshot qualification later |
| Large repositories overload watchers/UI | Editor degradation | Scoped watchers, batching, bounds, measured stress tests |
| API/platform changes | Compatibility drift | Named support matrix, retained fixtures, conservative unknown handling |
| Overlap warnings become noise | Low retention | Evidence details, review precision, mute/group advisories |
| Configuration fallback damages hooks | Workflow disruption | Exact diff, ownership record, compare-before-restore |
| Feature scope expands to orchestration | Delayed validation | Preserve native-supervision MVP and separate increments |

## 25. Optional increments and decision gates

### Cross-platform

Bundle and verify helpers for each named OS/architecture. Test launch quoting, executable permissions, Windows ACLs/path rules, atomic rename behavior, restricted environments, and clean uninstall. Do not advertise platforms based only on successful cross-compilation.

### Remote workspaces

Probe execution placement and plugin registration in a remote extension host. Qualify a single remote mode first. Add environment-aware path mapping and storage; avoid implicit forwarding or sending file metadata off-host. Stop if the required Cursor APIs are not available there.

### Cloud agents inside Cursor

A future adapter can add remote Cursor runs to the same view using their own identities and capability profile. Store credentials in editor secret storage, use the current API version, and consume run events/status with documented reconnection behavior. Tool file metadata is conditional on actual payload coverage. Do not imply cloud files map directly to the local working tree. Current official v1 documentation describes run SSE and cancellation, but labels the API public beta. [Cloud API](https://cursor.com/docs/cloud-agent/api/endpoints)

### Narrow controls

Only after observation is trustworthy, evaluate explicit deny rules for supported hook surfaces. Separate “Block the next matching supported tool” from “Stop the native agent.” Prove failure defaults, bypass routes, policy composition, latency, and cancellation semantics. A tool hook is not an OS sandbox and cannot guarantee that shell/MCP alternatives cannot access the same file. Human approval UI must have bounded waits and a documented timeout decision; do not bolt it onto the alpha spool path.

### Rich visual map

Only add a webview heatmap/network view after the tree workflow demonstrates demand. Reuse existing projections, virtualize large datasets, validate messages, disable arbitrary navigation, and use a strict content policy. Animation must not imply continuous activity from a single past event.

## 26. Definition of done

The personal alpha is complete when G0–G3 pass on a named Cursor build/platform; Angad can supervise normal native conversations without changing how they are launched; evidence labels and unknown states survive replay; sensitive source contents never enter default persistence; resources remain bounded; and enable/reload/disable/upgrade work without disturbing unrelated hooks.

Required handoff evidence: compatibility matrix, sanitized fixtures, focused test results, native smoke record, measured performance report, package inspection, privacy summary, known limitations, and a short recovery guide. A polished screenshot or synthetic demo is insufficient proof of native integration.

## 27. Open decisions with working defaults

| Decision | Working default | Revisit when |
|---|---|---|
| Exact child attribution required for first beta? | No; honest conversation-level view is usable | Angad says child ownership is indispensable |
| Remote/cloud in first beta? | No; native local first | Local workflow proves useful or those sessions dominate usage |
| Controls versus observation? | Observation first | A concrete intervention workflow is validated |
| Metadata history duration? | 7 days/100 MiB | Usage and privacy preference suggest otherwise |
| Public open-source contribution versus private tool? | Keep implementation distributable; no publishing decision inferred | Angad chooses a repository and release model |

These defaults keep the plan implementable without treating optional questions as blockers. A later implementer should update this table with Angad’s answers and the observed capability report.
