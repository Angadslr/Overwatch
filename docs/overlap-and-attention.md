# T16/T17 — qualified overlap and local attention

Overlap advisories require independently established conversation attribution and the same canonical physical file key in the same collector/environment/workspace/worktree scope. Filenames, source path hashes, child lifecycle linkage, watcher timing and model names never supply that proof.

The current native fixture profile has source path hints and unverified file actors. Its captured shared-file journey correctly produces an informational qualification item, **not a physical conflict**. The rules are implemented for qualifying normalized records; expanding native evidence is a separate capability decision.

## Rules

- Concurrent edit activity: distinct proven conversations, valid unambiguous correlated operations, and explicit source start/end timestamps with overlapping intervals. Receipt proximity and missing completion do not establish execution overlap. The source end must be recent in the 30-second window.
- Recent edits by multiple conversations: qualifying successful edit completions or independent after-edit reports received within 30 seconds. This is explicitly not proof of simultaneous execution or saved bytes.
- Possible stale context: a successful read precedes another conversation's completed edit, followed by the original conversation's edit start. Explicit source timestamps establish this order. Read attempts or journal receipt order alone cannot establish a content baseline, and even the informational advisory does not claim the actual read/saved bytes are known.

Failed/denied/cancelled operations, ambiguous call reuse, conflicting duplicate identities and missing physical/actor evidence are refused. Default/custom exclusions apply before advisory formation. Duplicate delivery and reordered replay are deterministic. Bounds are explicit: 10,000 retained input events, 256 eligible facts per physical file, eight represented conversations per file and 200 advisory results; truncation is surfaced rather than interpreted as absence of overlap.

## Attention view

Attention exposes rule explanation, physical scope when proven, involved conversation identities, trigger event IDs and limitations. Inspect opens a read-only metadata note. Unknown completion/reload liveness, collection problems and observation gaps remain separate from overlap. Unqualified native inputs get an informational explanation without guessed conflict or actor ownership. Reads and ordinary success do not trigger notifications.

Acknowledge affects the current advisory episode. Mute affects its local condition/rule and survives reload through workspace mementos. Neither operation removes source history, locks a file or controls agents. Continuous conditions retain one episode identity when their sliding cause window changes; a disappeared/reappearing condition can form a new episode. Preference/detail bounds prevent unbounded local state, and malformed saved preferences fall back visibly.

`agentSupervision.notifications` defaults to false. When explicitly enabled, only eligible high/medium overlap items can notify, at most three per minute and once per continuous episode; acknowledgements/mutes suppress delivery. The limiter clamps clock rollback. Attention follows frozen presentation while collection and optional notifications remain independent. Privacy/workspace changes invalidate retained display/details; notifications do not silently enable collection.

Verification covers positive/negative physical scope, real native shared-file uncertainty replay, source order, duplicate/reordered input, privacy/analysis bounds, persistent controls, episode continuity and notification rate limits. The installed Cursor suite verifies informational native qualification, default-off notifications, acknowledge/mute persistence, read-only inspection and unchanged collection/history.
