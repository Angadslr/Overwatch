# Native compatibility evidence

Recorded 21 October 2026, America/Los_Angeles. This is a discovery report, not a release support promise.

## Observed host

| Property | Observed value |
| --- | --- |
| Cursor | 3.25.9 |
| Application commit | `5d4df965746c5d09740842fc0f1331ba1c157830` |
| Embedded editor API | 1.128.0, confirmed inside the extension host |
| Extension-host Node | 24.18.1 |
| Development Node / npm | 24.21.0 / 11.19.0 |
| OS / architecture | macOS 26.5.2 / arm64 |
| Workspace | Local, trusted, invented fixture; paths include spaces |
| Go compiler | Unavailable in the current PATH; production helper not built |
| Extension type definitions | Pinned to 1.105.0, using APIs available in that baseline; host 1.128.0 satisfies the engine range |

## Documented versus observed

Cursor documents runtime plugin directory registration through `vscode.cursor.plugins.registerPath` and removal through `unregisterPath`. Both functions must be present for the preferred integration to qualify. They were **not both available** through the actual `vscode` API object in either the development host or the installed VSIX host. The probe reports `plugin-registration-api-unavailable`; it does not invoke private commands or claim successful plugin discovery. [Official extension API](https://cursor.com/docs/extension-api)

The explicit `.cursor/hooks.json` fallback **did deliver hooks from ordinary native Agent Chat**. The first chat existed before installation, so delivery to an existing conversation was observed. Creating a second chat after reload and reenabling produced `sessionStart`. The configuration loaded without a window reload. Hook processes launched successfully with quoted absolute paths and a workspace/storage path containing spaces. Each captured hook reported its working directory as the fixture root. [Official hook configuration and response contract](https://cursor.com/docs/hooks)

These are project-hook results. They establish nothing about registered-plugin scope, registration/unregistration propagation, or other versions and platforms.

## Native operation findings

| Scenario | Observed evidence | Limit |
| --- | --- | --- |
| Read existing file | `preToolUse` with tool `Read`, `beforeReadFile`, `postToolUse`; matching scoped call key | Reports tool completion, not subsequent model use |
| Edit existing file | Internal `Read` cycle, then `preToolUse`/`postToolUse` with tool `Write`, plus `afterFileEdit` | Edit reporting is not human acceptance or saved-byte causality |
| Read nonexistent file | `preToolUse` and `postToolUseFailure`, `failure_type: error` | No successful-read inference; specialized read hook was absent |
| New conversation | `sessionStart`; distinct conversation/session key | Generation is empty at session creation in this trace |
| Turn completion | `stop` with status `completed` | Conversation remains available |
| Existing conversation / after reload | Native file operations still work; explicit fallback reenable required after cleanup | Automatic reenable is not implemented in this probe |
| Disable/reload cleanup | Generated file removed; a later native read succeeded with the event count unchanged at 10 | Only unchanged, owned fixture configuration tested natively |
| Two top-level conversations | Distinct stable opaque source keys across captured traces | The two observed runs were sequential, not a simultaneous attribution test |

### Correlation correction required before T04/T07

The same `tool_use_id` appeared on a **Read followed by a Write within one conversation and generation**. This occurred in both read/edit smoke traces. A key made only from environment + conversation + generation + call ID would incorrectly collapse them.

Include measured tool/operation kind in the correlation partition. If the same scoped key and kind is reused for multiple cycles, preserve separate observations or mark correlation ambiguous; do not infer a unique occurrence from timestamps. In these traces `afterFileEdit` has no `tool_use_id`, so retain it as a separate edit report rather than deduplicating it against a nearby write. `beforeReadFile` does share a call key with its corresponding read and can enrich that read when the source profile proves the match.

### Cached-hook removal finding

A later verification of the first package found a real cleanup failure: after plain disable deleted `.cursor/hooks.json` and the extension was uninstalled, creating a native chat emitted one more `sessionStart`. File deletion alone did not clear Cursor's cached invocation. The earlier reload-based disabled Read test remains valid; it did not test plain hot removal.

Version 0.0.2 adds an enabled collection marker that the helper checks before publishing and that disable removes before config cleanup. Plain disable stops metadata persistence; clearing cached process launches additionally requires **Disable and Reload Fixture Window**. The corrected installed package passed native read/edit and disable-and-reload; creating another native session afterward left the event count unchanged at 47, with both config and marker absent. The extension was then uninstalled. This is the measured normal lifecycle, not crash recovery.

`cleanup-cache.json` preserves the failed observation; `corrected-packaged.json` preserves the corrected native replay. The final count is 47 events across three source conversations, including the one cached-hook regression event.

## Completed T02/T03 qualification

T01 is complete on the historical 3.25.9 host. T02/T03 and G0 passed on the updated Cursor 3.26.16 host (API 1.128.0, Node 24.19.0, same macOS arm64 platform). The plugin API remained unavailable. The [qualification report](phase-a-qualification.md) contains the operation/response matrix, exact scenario limits, timing comparison, native action trace, and 159 newly captured events. The [integration decision](decisions/native-integration.md) is accepted for this reduced profile.

New observations include native create/edit/failure, shell rename/delete, MCP activity, permission denial, aborted turn arriving before tool failure, and missing completion caused by deliberate observation loss. Simultaneous same-model chats stayed distinct. Child lifecycle keys join Task events but not child file-tool sessions; those remain unlinked. Physical worktrees stayed distinct. Two windows shared one project config/inbox and did not install duplicate producers. Production collector leases remain later work.

Session-end delivery was not observed on secondary-window close. Shell/MCP file internals, exact acceptance inference and production performance remain unavailable/unqualified. Only local Cursor 3.26.16/macOS arm64 is qualified for the complete Phase A scenario profile; broader UI/helper work remains proposed.

## Evidence files

- `tests/fixtures/cursor/probe.json`: first native read/edit trace, projected before persistence.
- `tests/fixtures/cursor/reload.json`: second native conversation, failed read, and read/edit after reload.
- `tests/fixtures/cursor/packaged.json`: ten native events from the initial installed VSIX.
- `tests/fixtures/cursor/cleanup-cache.json`: cached hook after plain disable, with config absent.
- `tests/fixtures/cursor/corrected-packaged.json`: ten native events from version 0.0.2 before verified disable-and-reload cleanup.
- `docs/probe-package-verification.json`: package checksum, contents inspection result, and install/cleanup record.
- `tests/fixtures/cursor/environment.json`: measured application and extension-host properties.
- `docs/native-smoke-test.md`: actions, cleanup, and repeat procedure.

Source payloads are not stored. IDs are SHA-256 hashes, relative targets are restricted to invented fixture names, and known field types are retained without field contents. These fixtures are a measured **probe contract**, not a fabricated normalized event-v1 schema.
