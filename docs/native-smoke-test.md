# Native probe smoke record

Run date: 21 October 2026, Pacific time. Cursor 3.25.9, macOS 26.5.2 arm64, trusted local Extension Development Host. This record covers the Phase A probe, not the alpha release gate.

## Completed actions

1. Built the development extension, opened `.local/native fixture with spaces`, and read its compatibility report. Observed editor API 1.128.0, extension-host Node 24.18.1, trusted workspace, and unavailable plugin registration API.
2. Ran **Overwatch Probe: Enable Project Hook Fallback in Fixture Workspace**. It published an exclusive, generated `.cursor/hooks.json`. No existing project or user hook configuration was modified.
3. In the already-open native Agent conversation, requested a file-tool read of `read.txt` and replacement of `cobalt` with `violet` in `edit.txt`. Native UI showed the read and edit, followed by “fixture complete”. The file on disk contained the invented violet text afterward. Ten projected hook events were captured from 10:15:41 through 10:15:44 PDT.
4. Ran **Developer: Reload Window**. The extension's normal shutdown removed its unchanged hook file. A native Read of `shared.txt` then completed successfully at about 10:17 PDT. The event count remained exactly 10, and `.cursor/hooks.json` was absent. This establishes no new probe delivery after removal for that tested operation.
5. Explicitly reenabled the fallback and created another native conversation. Its `sessionStart` had a different conversation key. Requested a failing Read of `missing.txt`, a Read of `read.txt`, and replacement of `violet` with `teal` in `edit.txt`. Read failure was reported with `postToolUseFailure`; the successful operations generated separate native records. See `reload.json` for exact receipt times.

The first prompt prohibited shell, MCP, subagents, and unrelated files. The second did likewise. Only invented fixture content was submitted in these smoke runs. Reads done internally by Cursor's editor tool were also visible and exposed call-ID reuse across Read and Write.

6. Built a local VSIX with `@vscode/vsce` 4.0.0 and inspected its ZIP contents. It contained both bundled entry points and excluded `.local`, source, tests and node_modules. Temporarily installed it through Cursor's supported extension CLI, closed the development host, and opened a regular fixture window. The report confirmed `extensionMode: production` and the generated command used the helper inside the installed extension directory.
7. Repeated native Read and Write, changing the invented color from teal to mint. The UI reported “packaged fixture complete”; ten more projected events were captured. Disabled the integration, verified owned hooks were absent, and uninstalled `angad-local.overwatch-native-probe` successfully. The initial packaged total was 36 events. This machine-specific discovery package is not the alpha release package. Checksum and build inputs are in `docs/probe-package-verification.json`.

8. Tested another native session after plain disable/uninstall. This unexpectedly emitted a 37th event, `sessionStart`, even though the config was absent. Recorded the failure as `cleanup-cache.json`; plain hot removal was not sufficient to clear Cursor's cached hook.
9. Added a collection marker and explicit **Disable and Reload Fixture Window** in 0.0.2, plus a child-process regression test proving a disabled helper does not persist data. Installed the corrected package, reloaded, enabled the fixture fallback, and repeated native Read/Write from mint to amber. Ten events were captured. Ran disable-and-reload and created another native session; the count stayed 47, and both config and marker remained absent. Uninstalled the corrected package. `corrected-packaged.json` records the final native replay.

## Repeat procedure

```sh
npm ci --ignore-scripts
npm run check
npm run test:unit
npm run test:integration
npm run probe:launch
```

In the fixture development window, inspect the compatibility report, then explicitly enable the fallback if registration is unavailable. Ask the ordinary native agent to read `read.txt` and modify the current invented color in `edit.txt` through file tools. Record the actual UI actions separately from the spool metadata. Never save raw stdin or tool output to capture a fixture.

The generated helper command contains absolute paths to the development Node and bundled helper. Their quoting is exercised by the fixture path with spaces. Production requires the later Go helper and measured launch overhead.

Use **Overwatch Probe: Disable and Reload Fixture Window**, record the event count, and perform one deliberate native action. Plain Disable stops metadata collection through the marker but requires a window reload to clear cached hook invocations. Verify that the hook file is absent and the event count stays unchanged. If cleanup reports `modified-preserved`, review the configuration and remove only entries belonging to this probe. A crash may leave owned configuration in this disposable fixture; normal shutdown cleanup is not crash recovery.

## T02/T03 completion run

On 21 October 2026 at approximately 15:11–15:25 PDT, the installed app had updated to Cursor 3.26.16 (commit `8fcb8ace5c73fa31f2e2707fd6783160e4ed3e40`, API 1.128.0, extension-host Node 24.19.0). The additional scenarios and exact fixture references are recorded in [phase-a-qualification.md](phase-a-qualification.md). These new results do not retroactively qualify all scenarios on 3.25.9.

Actions in order: native Read/missing Read/create/coral edit; Undo/Confirm; gold edit plus shell rename/delete/cat/redirection; Keep and manual silver buffer/auto-save; two overlapping same-model chats; two identical parallel explore children; local fixed-file MCP invocation after enabling that fixture server; packaged 0.0.3 owner and duplicate workspace windows; separate harmless denial gate; two physical Git worktrees; native sleep cancellation; secondary-window close; owner Read and deliberate telemetry outage mid-sleep; reload/reenable and native read/copper edit; Keep before cleanup; disable/reload on all fixture owners; final disabled Read; temporary MCP config removal and supported CLI extension uninstall.

The denial gate was separate from the always-observational probe and was removed by restoring exact original config bytes. A cleanup reload was initially rejected by automatic approval review due to a pending fixture edit; Keep resolved that review before cleanup. No approval blocker remains. Native UI showed each worktree completion and final disabled verification. Main inbox stayed 184 after the final disabled Read; worktree counts were 19 and 16. All hook configs/markers are absent.

## Evidence boundaries

Hook receipt times are not source start/finish times or UI latency measurements. Observing saved fixture bytes does not establish universal save timing. T02/T03 now compare Keep/Undo and dirty-buffer timing, denial/abort, concurrency, children, worktrees and duplicate windows. Missing child-to-tool joins and absent session-end delivery are recorded limits. Restricted-mode native testing and production helper failure containment remain later release work.

No extension mocks, CLI-agent runs, private database inspection, or invented native fixtures count as native delivery evidence.
