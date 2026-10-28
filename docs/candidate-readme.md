# Overwatch Supervision — engineering candidate

Private local macOS Apple Silicon candidate. **T22 resource qualification is incomplete. This is not a qualified personal alpha.**

The extension observes supported native Cursor hook metadata in an explicitly enabled, trusted, invented fixture workspace. It displays source sessions, file evidence, chronological activity, qualified attention and Source Health. It does not establish exact subagent file ownership, saved bytes, human acceptance, shell-internal file access or complete source coverage. General project collection, remote workspaces and cloud agents remain unqualified.

## Qualification workflow

Use Cursor 3.26.16 on macOS arm64. Install in a separate test profile. Create an invented fixture directory containing `.overwatch-probe-fixture` with the exact line `overwatch-invented-fixture-v1`, plus invented `read.txt`, `edit.txt` and `shared.txt` files. Do not use private project contents as fixtures. Enable with **Agent Supervision: Enable in Fixture Workspace**.

Inspect an ordinary native Agent read and edit separately from disk/editor observations. Use **Agent Supervision: Run Helper and Collector Self-check** to diagnose the helper/collector path; a passing self-check does not prove native Agent delivery. Use Activity filters and read-only details to inspect evidence and unknown attribution. Overlap rules require proven physical identity and actor attribution; an absence of advisories is not proof that agents did not overlap.

## Disable and recovery

Run **Agent Supervision: Disable and Reload Fixture Window** before uninstalling or replacing the package. Disabling stops publishing and restores/removes only the exact owned hook configuration. Modified or foreign hook files are preserved. Review `.cursor/hooks.json` if cleanup reports a conflict; never delete unrelated entries.

Metadata history lives under the fixture's `.local/supervision-storage`, with seven-day/100 MiB source retention and a recent 5,000-event presentation window. Diagnostic export is local and reviewed, with paths redacted by default. To remove owned history, use **Preview Clear Owned History**, inspect the scope, then **Clear Reviewed Owned History**. Saved exports are optional in that scope. An interrupted reset leaves collection off until reviewed reset completion. Do not delete an uncertain collector lease or reset marker to force collection.

Uninstalling the extension does not erase retained history, private original-hook backups or copied diagnostic exports. Preserve original backups until hook restoration is resolved. This candidate is private and unpublished; its bundled dependency and Go notices are included in `THIRD_PARTY_NOTICES.txt`.
