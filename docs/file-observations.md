# T12 independent disk and editor-buffer observations

Implemented and reviewed for Angad on 24 October 2026 (Pacific). T12 is complete; T13 has not started. Collection remains restricted to the trusted local invented fixture and its owning window. This task adds no general native activation, actor inference or content snapshots.

## What appears in Cursor

Reload the Extension Development Host window and explicitly re-enable collection. Resolve any pending native edit reviews before reload. A separate **Local file observations** tree group shows:

- **Buffer changed · unsaved · actor unknown** when the editor reports dirty state for a changed document version.
- **Buffer changed · dirty state unverified · actor unknown** when text changed without positive dirty evidence. The adapter does not assume that a transient false flag proves a clean buffer.
- **Editor save reported · actor unknown** for the editor save event.
- **Disk create/change/delete notification · actor unknown** for a filesystem notification, with current file/missing presence sampled separately during processing.

These records do not identify who made the change, prove that disk bytes match a buffer/tool edit, or establish human acceptance. Notifications can coalesce and do not reconstruct a successful create/delete/rename operation. A create notification may be processed after the path is already missing. Opening an editor resource is not observed as an agent read or as a buffer change.

Rows show safe relative paths and age. Selecting a row resolves its current file with trust/workspace/root/exclusion checks, or reports a missing/unavailable result without recreating it. The group is separate from native source sessions; local facts do not increase agent read counts or verify native delivery.

## Data and ownership boundaries

`src/host/fileObservationBindings.ts` owns the recursive fixture watcher and file-scheme document change/save/close subscriptions. It has no document-open subscription and never calls getText or copies contentChanges text. It passes only path, category and dirty metadata into `src/adapters/fileObservations.ts`.

The installed Cursor host exposed a relevant ordering detail: a content-change notification can arrive while isDirty is still false, followed by a metadata-only dirty-state notification. A bounded path/version tracker records the later positive dirty transition only for an already changed, accepted document version. Opening a document creates no tracking entry. Save/close clears entries; disposal clears the tracker. Capacity eviction is disclosed as a potential coverage gap, not a count of known lost disk writes.

The queue filters lexical scope/default/custom exclusions before retaining a path, then uses T10 LocalPaths to check the canonical destination. External, excluded, unsafe and replaced-root targets do not enter observation records. Secret/integration paths are checked on both sides of aliases. Missing targets may expose an independently checked relative display locator with unresolved scope and no physical key; they do not merge with known physical identities.

`LocalObservationStore` is separate from the agent operation store, conversation identity and lifecycle projections. It validates source/category, observed phase, unknown outcome/actor, unpaired evidence and safe relative targets. Actor/conversation/generation/call IDs, claimed operation success and rename destinations are rejected. Schema validation and allowlisted record assembly omit unknown data. The queue retains no document object, file contents, change text, raw exception or stack trace.

PluginManager starts subscriptions only after trusted collection ownership is established. It stops and drains local observation work before cleaning up the native publisher, including when that cleanup later fails. A collection generation guard rejects stale callbacks after disable/re-enable. A local watcher setup failure is disclosed separately without manufacturing a native tool or source failure.

## Coverage and bounds

Coverage is always **partial**. FileSystemWatcher exposes no native activation acknowledgment or OS overflow/error stream. There is no initial scan or complete audit, and events may coalesce or be missed. Only file-scheme buffers in the owning window are observed; other windows' unsaved buffers, untitled documents, remote resources and exhaustive filesystem history are not claimed. Tests allow watcher registration time but do not establish a startup latency guarantee.

The queue holds at most 256 pending records plus one in flight. Adjacent matching notifications may coalesce, with a bounded represented-notification count. Up to 256 changed document versions are tracked by path for dirty transitions. Capacity gaps, processing failures, exclusions, coalescing and cancellation have metadata-only counters. These counters do not measure all notifications the OS may have lost.

The local store retains at most 2,000 recent records and 100,000 seen scoped event IDs. History eviction/capacity loss is disclosed. The tree displays the last 100 records and reports additional retained detail; manual collection reports include at most 100 records. Manager refresh sampling uses its existing cadence rather than refreshing the UI for every keypress.

Local history is bounded **host memory only**, retained while this extension host remains alive. It is not automatically appended to the Cursor source-envelope journal or restored after reload. Source history remains separately durable. Manual report output is explicit metadata export into private fixture storage; future retention/checkpoint work remains separate. Default/custom path exclusions here do not complete T13's helper policy synchronization or comprehensive persistence/error-path privacy audit.

## Actual verification

Verified on 24 October 2026 (Pacific); saved UTC timestamps cross into 25 October:

- Strict generated contracts/types and current build passed, without new dependencies, schema changes or Go-source changes.
- **101 unit tests passed.** New cases cover independent dirty/save/disk facts, unknown actor enforcement, no agent lifecycle/delivery effects, pre-resolution exclusions, canonical aliases, missing/create/delete notifications, malformed metadata, queue overflow/coalescing, in-flight cancellation, error scrubbing, scoped deduplication, immutable policy capture, history bounds, owned disposal and stale callbacks after re-enable.
- **10 helper-process integration tests passed.** The actual compiled helper response/privacy/spool/replay behavior remains intact.
- **21 checks passed in the installed Cursor extension host**, API 1.128.0 / extension-host Node 24.19.0. T12 used real editor/workspace/filesystem APIs to open a resource, make an unsaved edit, save, obtain/apply a registered formatter's edit, independently rewrite disk, create/delete five files, edit excluded paths, open a local TreeItem and verify disposal through later disk/buffer edits. The test fixture disables auto-save before launch; user/global settings were not changed. Invented content markers were absent from observation metadata.

The [saved host result](t12-extension-host-verification.json) records nativeDelivery false because the separate native Agent hook regression still uses injected metadata. T12 filesystem/buffer events were real, not API mocks. No new ordinary native Agent/model turn is claimed; T08 remains that delivery evidence.

Runtime verification found and fixed dirty-state ordering; review also hardened canonical exclusions, immutable policy capture, scope-qualified record keys, missing-target invariants, unsupported rename rejection, pinned-root current-file opening and stale callback suppression. Partial coverage is explicit rather than hidden behind successful setup. All temporary T12 collectors finished disabled with owned hooks/leases absent and zero ready files, and stopped observers delivered no later changes. No real-project/global hooks or release were introduced; unrelated workspace edits were preserved.
