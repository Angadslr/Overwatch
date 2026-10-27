# Overwatch

Local, observation-only supervision for native Cursor Agent Chat. T01–T21, T23 and engineering checkpoint G2b are complete. T22 resource targets remain open, so G3/T24 packaging is still gated. The current implementation includes the contract, Go helper, private journal, scoped identities, lifecycle evidence, independent filesystem/editor observations, privacy policy, Conversations/Files views and Explorer badges. Native collection is still limited to six invented fixture names on local macOS Apple Silicon. See [todo.md](todo.md) and [measured compatibility](docs/compatibility.md).

## Development and verification

Requires Cursor in `/Applications/Cursor.app`, Node.js 22+ and Go 1.26+ (the wrapper prefers the ignored local toolchain). Run `npm run check`, `npm run test:unit`, `npm run test:helper`, and `npm run test:integration`. `npm run test:extension` launches a disposable installed Cursor host with fresh fixture storage. For interactive keyboard/high-contrast review, use `OVERWATCH_EXTENSION_MANUAL=1 OVERWATCH_EXTENSION_RUN=review npm run test:extension` and mark that test profile's `manual-reviewed` file only after reviewing its window.

Use `npm run supervision:launch`, explicitly enable collection, and open the **Agent Supervision** activity-bar icon. **Conversations** shows source-session/lifecycle evidence; **Files** groups the same activity by file evidence. Explorer shows recent `!`, `W`, `R` or `?` badges with qualified tooltips. Badges expire after 30 seconds without erasing completion history. See [view behavior](docs/supervision-views.md).

Set `agentSupervision.pathExclusions` for additional relative path globs. Changing it stops collection; enable again to resume. The helper checks a versioned hash allowlist before publication, and default reports omit file locators. See [privacy enforcement](docs/privacy.md). Collection remains partial; source session participation does not prove file actor, disk persistence, acceptance or model use.

Use **Agent Supervision: Preview Local Diagnostic Export** to review a redacted local snapshot, then **Save Reviewed Local Export** to save those exact bytes. **Preview Clear Owned History** reviews this workspace’s deletion scope before a separate confirmation; saved exports are retained by default. Cancellation preserves history and leaves collection off. See [reviewed export and deletion](docs/privacy.md) and [open resource findings](docs/performance.md).

The old Node discovery launcher is now response-only, and its old enable commands route to the policy-enforced supervisor. Historical Phase A evidence and packages remain documented in [qualification](docs/phase-a-qualification.md). They are not the current collection implementation. Development mode is required for the Go supervision slice until later alpha packaging.

## Activity inspection and display controls

The **Activity** view adds chronological events, shared conversation/operation/time/evidence filters, and **Freeze or Resume Display**. Freeze holds the three views while collection continues; Explorer remains live. Selecting activity opens a read-only metadata inspector, including missing/deleted-file evidence. Follow latest defaults to off.

Details open beside the source editor by default. Toggle **Agent Supervision: Toggle File Details Beside Editor**, change `agentSupervision.detailsBeside`, or run:

```sh
npm run supervision:details -- toggle --workspace ".local/t08-native fixture with spaces"
```

Use `beside`, `current`, or `status` instead of `toggle` for explicit placement/status. The command preserves workspace settings comments and updates the next selection in the running editor. See [activity inspection and terminal controls](docs/activity-inspection.md).

## Run the T08 native supervision slice

```sh
npm run supervision:launch
```

In the resulting trusted invented-fixture window, run **Agent Supervision: Enable in Fixture Workspace**. Ask ordinary native Agent Chat to read `read.txt` and edit `edit.txt`. The Agent Supervision sidebar shows source-session identity, relative paths, evidence and age. Selecting a row opens its current fixture file. Use **Agent Supervision: Disable and Reload Fixture Window** when finished; resolve any pending invented edit review before reload.

`npm run test:extension` runs the installed Cursor extension host in an isolated test profile. It uses synthetic metadata and is separate from the completed ordinary native smoke run. No global extension installation or real-project hooks are required. See [T08 verification and limits](docs/t08-vertical-slice.md). The UI reports source completion and edit reports; disk persistence, acceptance and child file ownership remain unknown.

T09 aliases appear as **Session N**, with the source identifier available in tooltips. Proven child lifecycle rows appear beneath their source parent; child file ownership remains unverified. T10 resolves eligible local paths with root/environment/worktree separation and secret-path exclusions, and the current-file opener uses those checks. It does not reverse hashed historical paths or enable collection outside the invented fixture. See [identity/path usage, review and verification](docs/identity-and-paths.md).

T11 keeps conversations, turns and operations independent. A reported turn completion leaves pending file requests unresolved. After 30 seconds, an unfinished request says **Completion not observed**; replayed open requests say **Live state unknown after reload**. The status distinguishes **Collector ready · awaiting first native event** from fresh source activity and always discloses partial coverage. Reload the development window and explicitly re-enable collection to load the updated view. See [T11 lifecycle/health verification](docs/lifecycle-and-health.md).

T12 adds a separate **Local file observations** group for eligible disk notifications, unsaved buffer changes and editor-save reports, all labelled **actor unknown**. These facts do not increase agent read counts or verify native delivery. Opening a row safely opens its current local file. Watcher coverage is partial and local records are bounded to this host's memory; they are not automatically saved to the source journal. Reload the development window and re-enable collection to load the updated bindings. See [T12 verification and limits](docs/file-observations.md).

## Attention and Source Health

**Attention** exposes qualified advisories, uncertainty, and local acknowledge/mute controls. Notifications default off. The current native source profile still cannot prove physical overlap; it is labelled accordingly. **Source Health** separates registration, helper response, ingestion, ownership and native source evidence. Run **Agent Supervision: Run Helper and Collector Self-check** to test the local pipeline without starting an agent or making a model call. See [attention](docs/overlap-and-attention.md) and [troubleshooting](docs/troubleshooting.md).

Previously enabled collection resumes after a normal Cursor reload. Another window on the same physical checkout stays passive; use the owning window. See [window ownership and recovery](docs/window-ownership.md).

Existing project hooks are refused by default. Review them before opting in with `agentSupervision.allowExistingHooks`; exact backup and conditional restoration are described in [setup and cleanup](docs/setup-and-cleanup.md).

For independent Gemini/Claude verification, use [the executable test map and acceptance checklist](docs/INDEPENDENT-TEST-PLAN.md). Current broker/replay results and open resource gates are recorded in [performance findings](docs/performance.md).
