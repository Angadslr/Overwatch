# T09/T10 identity and local path implementation

Implemented and reviewed for Angad on 23 October 2026. T09 and T10 are complete; T11 has not started. The native collection surface remains the qualified invented fixture. No new ordinary native Agent turn or production collection support is claimed by this work.

## Conversation and child identities

`src/core/identity.ts` owns the shared identity namespace: collector, environment, canonical workspace ID and optional worktree ID. Conversation source ID is appended separately; generation does not change conversation identity. File-operation joins use the same namespace. Model labels, task descriptions, timestamps and process IDs never participate in identity.

`ConversationIdentities` assigns local **Session N** aliases, bounded to 10,000 identities. Its versioned `aliasState()` contains only scoped keys and assigned numbers. The editor saves it in extension workspace mementos, serializes writes and awaits outstanding saves before explicit disable/reload. Restoring state preserves aliases even if replay order changes. Duplicate keys/numbers, malformed scope and unsupported versions are rejected. Invalid state fails activation rather than silently assigning previous labels to different sessions. A failed save reports a fixed message and permits retry; it does not claim durability.

Qualified child lifecycle evidence requires a Cursor lifecycle event, child attribution, explicit child ID and explicit parent ID. The tree renders those rows beneath the proven parent session. A stop with no join does not attach to a recent child or session. Conflicting explicit parents or terminal reports disclose ambiguity. A lifecycle child ID remains separate from file-tool conversation IDs. The captured two identical child descriptions therefore produce two lifecycle rows while their unjoinable file-tool sessions remain independent. Displaying a session does not assert it is a top-level chat or establish its file actor.

`src/ui/conversations.ts` provides presentation without editor imports. The native tree incorporates those session/child rows, preserves file evidence labels, and exposes full source identity/scope in tooltips. Replaying lifecycle facts is idempotent; state transitions and aging beyond these evidence labels remain T11.

## Local path API and policy

`src/core/paths.ts` contains pure validation, containment and exclusion policy. `src/adapters/localPaths.ts` owns filesystem observation and hashing. It reads metadata and canonical paths, never file bytes. Create a service with `LocalPaths.create(environmentId, roots, exclusions)`, then call `resolve(input, baseRootId?)` or `rename(from, to, baseRootId?)`.

Each configured root is canonicalized, checked as a directory and pinned by device/inode. Conflicting declarations of the same physical root fail. Existing nested roots use longest-root containment; relative input with multiple roots requires an explicit base workspace ID. Root identity stays compatible with the existing workspace hash; file keys additionally include environment, canonical root, optional worktree ID and canonical file location. Same relative names in different physical worktrees or environments stay separate. Worktree IDs are explicit scope, not guesses from branch names or repository scripts.

Existing files/directories receive a schema-valid workspace `target` with an opaque location key and canonical relative path. Atomic replacement at the same canonical location preserves the location identity; it does not prove byte-version equality or saved state. The private result separately retains the lexical display locator. Internal symlink aliases share their canonical location key. External, dangling, cyclic and cross-root aliases are refused; canonical destinations are checked again for exclusions and schema safety. Roots and targets are rechecked before returning an identity. These checks reduce accidental substitution; they are not an OS security boundary against a process running as the same user.

For new/deleted/missing targets, the deepest existing parent is canonicalized. The private result preserves the safe relative locator, while the event target is unresolved and has no physical key. Missing names do not merge with known files. Rename source/destination resolutions are independent. A destination in another root remains unresolved in the combined event target because the current target grammar cannot express its separate root scope.

The supported path syntax is local POSIX. Empty/oversized strings, controls, backslashes, URI schemes and every parent-traversal segment are rejected; ordinary dot components normalize safely. Existing canonical spelling comes from the filesystem; there is no unconditional lowercasing of identities. Actual case-insensitive macOS behavior is qualified by tests. Deterministic filesystem fixtures verify both case rules; they do not qualify an untested OS or filesystem. Missing targets use a conservative non-merging fallback.

Default exclusions cover `.git`, `.local`, `.cursor`, secret directories, `.env` variants, private-key/certificate containers, SSH private-key names and credential/secret names. Up to 100 custom glob patterns of 256 characters are supported, with `*`, `?` and `**`. Matching uses bounded dynamic programming rather than potentially exponential regex backtracking. Both the lexical and canonical paths are checked; an innocent alias to an excluded target stays redacted. Excluded and external targets contain no relative path or file key. These defaults do not detect arbitrary secrets inside normally named files.

Persist only the narrow `result.target`. The full successful resolution includes private absolute paths/root metadata for current resource opening and must not be logged or exported as telemetry. The service does not infer actors, edits, tool success, persistence or acceptance.

## Native integration boundary

The existing six-name `FixtureTargets` bridge uses `LocalPaths` when opening current resources and retains its stricter no-symlink rule. It does not discover arbitrary native files. Source-envelope hashes are irreversible; resolving today's filesystem does not prove historical physical identity. The journal stays unchanged, historical targets remain hints, and no source event is retroactively enriched from current disk state. General local resolution is available to callers with independently supplied paths; native multi-root collection and general hook activation have not been enabled by this task.

## Verification and review

- `npm run check`: generated contracts and strict TypeScript passed.
- `npm run build`: current TypeScript bundles passed; no new dependencies.
- `npm run test:unit`: 68 passed. New identity tests replay captured T03 concurrency/child fixtures, serialize/restore aliases in a different order, partition scopes, reject corrupt alias state and preserve unknown joins.
- Path tests cover spaces, Unicode, nested roots, explicit base roots, traversal, external siblings, internal/external/dangling/cyclic aliases, missing descendants, create/delete, secret/custom exclusions, independent rename targets, worktrees/environments, canonical spelling and substitution. Real filesystem fixtures are supplemented by deterministic sensitive/insensitive and substitution fixtures.
- `npm run test:integration`: all 10 real helper-process tests passed, including compiled pipeline replay and disabled publication. Go source and the hook response contract were unchanged.
- `npm run test:extension`: nine checks passed inside installed Cursor, API 1.128.0 / extension-host Node 24.19.0. Real TreeItems include scoped aliases and a completed child lifecycle row with file ownership explicitly unverified. Correct file opening, missing reporting, privacy and cleanup remain covered. Input is synthetic; [the saved result](t09-t10-extension-host-verification.json) records `nativeDelivery: false`. T08 remains the ordinary native delivery evidence.

Manual review corrected canonical destinations that could violate the event path grammar, cross-root rename scoping, target substitution after initial canonicalization, namespace duplication and regex-based wildcard matching. Repeat host runs now receive fresh fixture storage so recycled test installation state cannot collide with a previous collector scope. The added child test also checks the actual permission-bearing `subagentStart` response. All temporary test collectors finished with publishers disabled, owned hooks/leases absent and inboxes empty. No real-project/global hooks, dependency changes, alpha packaging or release were introduced.
