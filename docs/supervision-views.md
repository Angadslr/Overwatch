# T14 Conversations, Files and Explorer decorations

The Agent Supervision activity-bar container has **Conversations** and **Files** views. The existing view ID `overwatch.supervision.files` remains the Conversations view for command/layout compatibility; `overwatch.supervision.byFile` is the new Files view.

Both consume the same operation rows. Conversations retain stable scoped aliases, independently measured generation/child lifecycle, operation evidence and receipt age. Source operation counts exclude child lifecycle rows. Files groups those rows by namespace, display locator and identity evidence. File rows show operation counts, distinct source-session participation, local observation counts and age. Each workspace group includes workspace hash, environment and an explicit worktree label; an absent worktree is `unspecified`, never guessed as the main checkout.

Source path hints and current physical filesystem samples remain separate groups even if their filenames match. Missing local targets have no physical file key. Local observations retain unknown actor and never acquire the nearest source session. File-operation children name their source-session alias, while tooltips retain raw opaque source IDs, phase, live-state qualification, receipt and explicit persistence/acceptance unknowns. Unresolved native files and shell/MCP internals remain qualified in Conversations and are not given invented file groups.

## Explorer badges

| Priority | Text | Meaning |
|---|---|---|
| 1 | `!` | Recent failed, cancelled, ambiguous or live-unknown evidence requiring attention |
| 2 | `W` | Recent edit/delete source activity; save and acceptance unverified |
| 3 | `R` | Recent read source activity; model use unverified |
| 4 | `?` | Recent local observation with unknown actor |

Badges use theme-provided colors and explanatory text/tooltips. Their session count includes only source sessions represented in the recent 30-second window, not proven actors. Future receipts do not create live emphasis. At 30 seconds, the badge disappears; completed historical operations stay completed. Replayed open operations retain unknown live state. Only currently resolvable eligible workspace files receive decorations.

Decoration work is batched at most five times per second, suppresses unchanged projections and publishes only URI arrays containing changed/removed decorations. Local path checks are skipped for identical evidence/policy/recency signatures. Disable, privacy changes and disposal clear decorations; checks in flight cannot republish under an outdated privacy policy. Updates never reveal/select a tree row or focus an editor. Explicit Enable and user file-opening commands may focus their requested view/resource.

T22 separates new-data refreshes from clock-only work. New events retain the existing immediate/batched data path; age-label-only tree refreshes occur at most once every ten seconds while visible. Hidden views skip those clock refreshes and rebuild when shown. Time-filter reference clocks and pending-operation uncertainty boundaries are still checked each second, and frozen presentation retains its held reference time. Badge results reuse unchanged row references until the next receipt/expiry boundary; future receipts and exact current-policy checks remain separate. Settled-idle and expiry-transition CPU are measured separately; the overall resource gate remains open.

Tree items provide accessible text labels, icons and tooltips without relying on color. The real Cursor suite uses 200 source sessions, checks exact operation counts across both views, checks badge text and stable update suppression, and verifies background updates preserve the editor. Pure tests cover worktree/environment partitioning, multiple source participants, physical/source identity separation, priority, exact aging, clock rollback, completion preservation and affected-URI diffs. Manual keyboard/high-contrast review is separately recorded in the host verification result.

Activity inspection/filter/freeze (T15) and physical overlap advisories (T16) remain separate future tasks. A multi-session badge is not a conflict claim.
