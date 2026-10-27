# T15 activity inspection, filters and frozen display

Agent Supervision now has an **Activity** view alongside Conversations and Files. It shows individual source/local events ordered by immutable receipt time with a stable scoped tie-breaker. Source-session aliases, source event, phase, activity evidence and receipt age remain visible. Conversation and file trees continue grouping source operations; an event count is not an operation count.

## Inspect an activity

Select an Activity row or a source/local operation in either tree. The extension resolves an internal scoped event handle, checks the current workspace/trust/privacy policy, opens the eligible current file and shows a read-only **Activity details.txt** document. The document includes source/version, event/operation/call IDs, conversation/generation/actor identity, receipt/source time, journal sequence, environment/workspace/worktree, target evidence, and independent activity/attribution/completion/persistence/correlation fields. Model use, saved byte version, human acceptance and child-to-file ownership remain explicitly unknown or unverified.

Current file availability is sampled at selection time and is separate from the historical event. A missing/deleted file opens metadata details without recreating the resource or changing a completed source observation. Unsafe/unresolved files remain unavailable. Operation aggregates are labelled as covering all retained facts and may include facts outside the active event filters.

The details document uses an extension-owned opaque URI and plain text, without payload-defined commands or HTML. It is memory-only, reused rather than accumulating tabs, and contains no file contents. Current privacy changes clear both frozen snapshots and open details, including requests already in flight. Default collection reports omit details text and file locators; they include only display state, counts and filter facet names.

## Details placement toggle

`agentSupervision.detailsBeside` defaults to `true`. With it enabled, details open beside the source editor while focus stays on the source file. With it disabled, details use the source editor group. Changing placement applies on the next selection, and the extension closes only its own misplaced read-only details tab.

Use **Agent Supervision: Toggle File Details Beside Editor** from the Command Palette or the Activity toolbar. From this repository checkout:

```sh
npm run supervision:details -- toggle --workspace "/absolute/path/to/the/fixture"
npm run supervision:details -- beside --workspace "/absolute/path/to/the/fixture"
npm run supervision:details -- current --workspace "/absolute/path/to/the/fixture"
npm run supervision:details -- status --workspace "/absolute/path/to/the/fixture"
```

For the original development fixture, from the repository root:

```sh
npm run supervision:details -- toggle --workspace ".local/t08-native fixture with spaces"
```

The terminal command edits only the chosen workspace's `.vscode/settings.json`, using the pinned JSONC parser already present in the dependency lock. Comments, trailing commas and unrelated settings are preserved. Malformed/duplicate/wrong-typed settings, symlinks, concurrent locks and detected substitutions fail without replacing the settings. Status is read-only. A crash can leave `.vscode/.overwatch-details.lock`; confirm no toggle process owns it before removing that lock. This is a development-checkout command, not an installed alpha CLI.

## Shared filters and follow latest

Use **Agent Supervision: Filter Activity** to select Conversation, Operation, Time or Evidence. Filters combine, and **Clear Activity Filters** restores all events in the retained display window. Default time range is all retained events; presets include 15 minutes, one hour and 24 hours. Evidence choices are source-reported, filesystem-observed, buffer-observed, self-check and ambiguous. Conversation filters use the complete installation/environment/workspace/worktree identity, not just an alias or source ID.

The chronological list and grouped trees use the same matching event handles. An operation remains visible if any of its facts match; its displayed file locator comes from a matching fact, and its aggregate status remains qualified. Local observations never gain a source conversation. Explorer decorations remain based on eligible live evidence and are not filtered by the views.

`agentSupervision.followLatest` defaults to `false`. **Toggle Follow Latest Activity** enables scrolling to new Activity rows without moving editor focus or tree selection. It does not open details automatically and does not operate while frozen.

## Freeze display

**Agent Supervision: Freeze or Resume Display** captures a bounded immutable presentation snapshot of all three views, including their ages and lifecycle/evidence labels. Collection, journaling and independent filesystem/editor observations continue. A banner states that collection continues (or is currently off), reports all incoming event arrivals before filters, and explicitly states that Explorer stays live while collecting. Badges therefore keep their normal freshness/expiry behavior.

Filters remain usable against the held snapshot. Resume switches to the latest retained data and reports how many events arrived; it never claims the agent was paused or resumed. Privacy and workspace changes invalidate a frozen snapshot rather than preserving excluded data. Display history is bounded to the newest 5,000 retained events; omitted older events are disclosed. Collection's own retention/coverage bounds remain independent.

## Verification and review

Pure tests cover combined predicates, scoped conversation matching, chronology, filter clearing, immutable freeze, arrival deduplication, resume, frozen time reference, privacy invalidation and display bounds. Real process tests exercise the terminal command's JSONC preservation, placement modes, read-only status and fail-closed settings handling. Installed Cursor tests replay the existing multi-conversation journey, inspect metadata, compare filtering across all three views, deliver a new event while frozen, verify focus/follow-latest-off behavior, exercise terminal and editor placement toggles, and inspect missing/deleted files without recreation. They also verify privacy invalidation of the frozen display and details.

Review tightened filtered locator selection, retained operation aggregate qualification, cancellation of in-flight details on privacy changes, accurate open-failure availability, and reuse of one friendly details tab. See `t15-extension-host-verification.json` for measured checks. Hook input remains synthetic and explicitly does not claim a new ordinary native Agent turn. Native collection remains the same fixture-only profile; T16 overlap advisories are not implemented here.
