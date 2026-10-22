# Phase A qualification — T02 / T03

Run: 21 October 2026, approximately 15:11–15:25 PDT. G0: passed for a reduced local observation profile. This is discovery evidence, not the alpha release gate.

Host: Cursor **3.26.16**, commit `8fcb8ace5c73fa31f2e2707fd6783160e4ed3e40`, editor API 1.128.0, extension-host Node 24.19.0, macOS 26.5.2 arm64, trusted local invented fixtures. Earlier T01 runs on 3.25.9 are historical and are not used to claim these additional scenarios on that version. Development probe 0.0.2 and installed fixture package 0.0.3 were used. The preferred plugin API remains unavailable.

## Operation and boundary matrix

| Deliberate native action | Captured evidence | Qualified interpretation |
| --- | --- | --- |
| Read existing file | `preToolUse(Read)`, `beforeReadFile`, `postToolUse`, matching scoped call key | Completed tool read, not model usage |
| Read nonexistent file | `postToolUseFailure`, `failure_type: error` | Failed read; no successful read inferred |
| Create `created.txt` | Failed internal Read, then Write and `afterFileEdit` | Write-created in the deliberate trace; no universal create verb |
| Edit existing file | Read cycle, Write cycle, unjoined `afterFileEdit` | Reported edit; no acceptance/persistence inference |
| Rename/delete | Agent used shell `mv` and `rm`; shell pre/post hooks | Native rename/delete tools unavailable in this run; file semantics unavailable from retained shell payload |
| Shell read and redirected write | `preToolUse(Shell)`, before/after shell, `postToolUse`; no target | Tool activity only; no reconstructed internal file reads/writes |
| Fixed-file local MCP read | before/after MCP and generic pre/post; common call key | Tool activity; no inferred target. The server was initially disabled, then explicitly enabled and the call succeeded |
| Denied harmless shell | Separate fixture gate denied; observer returned allow; failure `permission_denied` | Observed denial; no retry/bypass. Temporary gate removed and original bytes restored |
| Cancel `sleep 60` | shell end, `stop: aborted`, then generic failure with `is_interrupt: boolean` | Turn aborted before tool failure receipt. The projection records interrupt field shape, not its boolean value |
| Disable observation during `sleep 20` | Start hooks persisted; terminal absent after collection disabled at 22:19:50.499Z | Telemetry outcome unknown although native UI showed exit 0; a concrete missing-completion capture |
| New chat / turn end | Session start and completed/aborted stop | Conversation and turn are different lifecycles |
| Close secondary window while owner remains enabled | No `sessionEnd`; config and marker remained | Session-end capability unavailable in this profile |
| Read/edit after reload | Native pair succeeded, silver → copper | Repeat verification passed; no CLI substitute |

`operations.json`, `failures.json`, `lifecycle.json` and `field-profile.json` retain exact observed hashed identifiers and field shapes. No invented source records stand in for unsupported scenarios. Receipt order is recorded, not asserted to be a source transaction clock. The abort trace supplies an actual out-of-order lifecycle/tool example.

## Edit/buffer timing

Fifteen metadata samples in `timing.json` compare dirty/version state and SHA-256 buffer/disk bytes without retaining content. At 22:11:49.668Z the sampled buffer differed from disk despite dirty=false; by .673Z it matched. Native Write completion followed at .735Z. Disk already contained coral while Keep/Undo remained visible.

Undo then Confirm removed the newly created file; the existing edit remained coral. This is a measured group-review result, not a universal Undo rule. No agent hook described that user action. A later native gold edit reached disk before Keep. The manual silver buffer was dirty and differed from disk at 22:13:09.701Z; auto-save matched disk at 22:13:10.715Z and a save event followed at .717Z, without agent file hooks. Copper was explicitly kept before final cleanup.

These are best-effort samples of separate editor/disk states. Keep/Undo, buffer dirty flags, saved bytes and tool completion cannot substitute for one another.

## Concurrent attribution and scope

Two top-level Composer 2.5 chats overlapped: A's shell interval was 22:13:24.762Z–22:13:50.174Z and B's was 22:13:29.318Z–22:13:54.678Z. Their source keys remain distinct across reads, shell work and stops. Exact hashes are in `concurrency.json`; model labels are UI context only.

Two parallel explore children used identical descriptions/instructions. Task and lifecycle keys join explicitly. The two file-tool conversation keys differ from the lifecycle subagent keys and do not include a retained parent/subagent join. Child-to-tool attribution is therefore unavailable; these source sessions remain unlinked. No identity depends on task/model/PID/time.

Two real Git linked worktrees read and edited `shared.txt` independently, to scarlet and azure. `worktrees.json` records distinct canonical-root hashes and distinct disk hashes. Shared Git ancestry is not physical file identity.

A regular folder window and a separate one-folder workspace window used the same checkout. Second enable refused an existing config; all 14 hook arrays still had exactly one command. One deliberate secondary Read produced one cycle in the shared inbox. Closing the secondary preserved the owner's config/marker; the owner's next Read succeeded. The probe report filename is shared and secondary activation overwrote its activation snapshot; successful owner cleanup and config preservation are the retained ownership evidence. Production must separate health reports by collector instance.

The [accepted decision](decisions/native-integration.md) selects project hooks, a root-wide producer/inbox, one collector owner and passive secondary windows. Crash-safe ownership/merge/recovery code remains later work.

## Responses, privacy and verification

Five permission hooks return exactly `{"permission":"allow"}`: generic pre-tool, before-read, before-shell, before-MCP and child-start. The other nine discovery hooks return `{}`. All 14 have real child-process tests for one stdout response, exit 0 and empty stderr on malformed input and unavailable storage. Oversized input, spool bounds, symlink rejection, concurrency and disabled-marker behavior also pass. Thirteen hook kinds delivered natively; `sessionEnd` has process-level response verification only and is not an advertised alpha capability. [Official hook response contract](https://cursor.com/docs/hooks)

159 new unique native events were captured in this run: 124 in the original fixture and 35 across worktrees. Fixtures contain reviewed scenario subsets, projected before persistence; source text, commands, prompts, results, reasoning and email values were never retained. `tool_output`/`result_json` appear only as field-type labels. Unknown MCP tool names were redacted in the development capture; the 0.0.3 helper additionally classifies the documented `MCP:` prefix without storing tool names.

Actual verification: `npm run check`, `npm run build`, 15 unit tests, 5 child-process integration tests, `npm run package:probe`, VSIX contents inspection, temporary supported CLI installation and uninstall. No test mocks count as native delivery proof. The 0.0.3 VSIX SHA-256 is `ff19eb43f7ee96673869f19714ceea05dc41b50ef2d4abeb1f2faec364ea0836`; it was built before these final documentation edits. Repackaging updates documentation bytes and changes that checksum.

All three fixture hook configs and collection markers are absent. The temporary fixed-file MCP config is removed. A final native Read succeeded after disabling/reloading, with main inbox unchanged at 184; worktree inboxes remain 19 and 16. The temporary extension was uninstalled. No real project or user/global hooks were changed. Fixture windows remain available for evidence inspection.

## Release boundary

G0 proves enough native evidence for a useful local source-session/file view. It does not qualify a production schema, Go helper, collector lease, journal, supervision UI, remote/cloud/Tab support, other platforms or performance targets. T04 is next and was not executed by this request.
