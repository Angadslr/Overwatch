# Native integration decision

Date: 21 October 2026. Status: accepted for G0; production ownership/recovery implementation remains T06/T20/T21.

Select **explicit project hooks** for Cursor 3.26.16 on trusted local macOS arm64. Both the development and installed extension host lack the preferred plugin registration API. Earlier 3.25.9 read/edit evidence is retained separately. Do not use private APIs or substitute a CLI agent.

Use one hook configuration and one inbox per canonical physical root. A second regular window over the same checkout must remain passive: in the native test, second enable refused the existing config byte-for-byte, its Read delivered once to the owner's inbox, and closing it preserved the owner's config and enabled marker. An owner-window Read still worked afterward. Different Git worktrees use separate physical roots and inboxes, even when they share a Git common directory.

Production must elect exactly one collector with an exclusive root-scoped storage lease, installation/instance identity and heartbeat. Passive windows read shared projections or explain where supervision lives; they never append a second producer or ingest concurrently. Do not steal an active lease. Owner shutdown disables the root-wide marker before compare-and-restore config cleanup; takeover requires conservative stale-owner recovery and explicit reenable. The discovery probe proves exclusive config publication and routing, **not** crash-safe leases, merging into existing hooks, or automatic takeover. Those remain later implementation acceptance criteria. No daemon is needed.

Preserve these identity/evidence limits:

- Pair generic tool observations using physical environment/root, conversation, generation, operation kind and call ID. Reused same-kind IDs remain ambiguous; no timestamp deduplication.
- Task pre/post and child lifecycle records share explicit IDs. Child file-tool records use other conversation/session IDs and lack a retained join to those lifecycle IDs. Keep them unlinked; never assign by model, task text, PID, or recent start time.
- `afterFileEdit` has no call ID in these traces. Keep the report separate from Write completion, saved disk samples and Keep/Undo.
- A native canceled turn emitted `stop: aborted` before `postToolUseFailure`. Turn state cannot discard later operation evidence.
- Shell/MCP hooks describe tool activity without proven internal file targets. Session-end delivery was not observed on secondary-window close and is outside the qualified profile.

Disable removes the collection marker first. Reload is required to clear cached project-hook launches, based on the earlier measured cleanup regression. The 0.0.3 fixture package, owned config cleanup, disabled native read and uninstall passed. See [qualification](../phase-a-qualification.md), [native action trace](../native-smoke-test.md), and [fixtures](../../tests/fixtures/cursor/).
