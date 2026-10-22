# Overwatch technical research ledger

Updated 21 October 2026. Detailed measured evidence is in [docs/compatibility.md](docs/compatibility.md).

## Measured environment

| Component | Observed |
| --- | --- |
| OS | macOS 26.5.2, Darwin arm64 |
| Cursor | 3.25.9 at `/Applications/Cursor.app` |
| Commit | `5d4df965746c5d09740842fc0f1331ba1c157830` |
| Editor API | 1.128.0, confirmed in the extension host |
| Extension-host Node | 24.18.1 |
| Development Node/npm | 24.21.0 / 11.19.0 |
| Go | Not found in PATH; not installed by this implementation |

## Documented capabilities

Cursor documents runtime plugin path registration/removal, event-specific JSON hook responses, and plugin hook discovery. These are documentation claims until tested against the installed build. [Extension API](https://cursor.com/docs/extension-api), [hooks](https://cursor.com/docs/hooks), [plugins](https://cursor.com/docs/reference/plugins).

There is no universal `permission: allow` response for every hook. Permission-bearing and observational handlers need their own schemas. The probe's configured permission hooks return `{"permission":"allow"}`; its observational hooks return `{}`.

## Native observations

The development host did not expose both required plugin registration functions. The probe declined this path without calling private APIs. Explicit project hooks worked in a trusted invented fixture, with no user/global or unrelated project configuration changes.

Three sequential source conversations delivered 47 projected events across development-host and installed-VSIX runs, including one cleanup-regression event: `sessionStart`, `preToolUse`, `beforeReadFile`, `postToolUse`, `postToolUseFailure`, `afterFileEdit`, and `stop`. Existing conversations received newly installed hooks. A second conversation after reload produced a distinct conversation key, a failed read, and successful read/edit. Normal reload removed owned hooks; a later native read completed without new telemetry. Deleting the hook file without a reload left a cached session-start hook active in one test. Corrected version 0.0.2 adds an enabled marker, removed before configuration cleanup, so stale invocations cannot persist metadata. **Disable and Reload Fixture Window** clears Cursor’s cached invocation. The corrected native package emitted ten file-operation events; after cleanup, creating a new native session left the count unchanged at 47. The local VSIX installed in a regular Cursor window (`extensionMode: production`), delivered ten additional native events using the installed helper, and was then disabled and uninstalled; the initial cached-hook failure and corrected replay are preserved as separate fixtures.

Native tools were named `Read` and `Write`. Path fields came from `tool_input` or specialized `file_path`. Raw inputs, contents, prompts, commands, outputs, email, transcript locations and reasoning were dropped before persistence. The fixtures preserve known field types, categories, hashed IDs and invented relative target names.

A call ID was reused between an internal Read and following Write in one generation. Correlation must include operation kind and retain ambiguity on further reuse. `beforeReadFile` shared its read ID; `afterFileEdit` lacked an ID. Reading a missing file produced `postToolUseFailure` with `failure_type: error`, without a successful-read signal.

## Proposed production design

The plan selects TypeScript UI/core, a standard-library Go helper, atomic per-event spool publication, and a bounded local journal. T04 now implements the event schema, generated TypeScript representation and validation boundary; helper/transport/UI components remain unimplemented. The discovery helper uses development Node, a 32 MiB input bound, and an approximate 500-file inbox cap, dropping telemetry at the limit. It does not yet have production gap counters, retention or crash recovery.

Earlier notes claiming under-2-ms native startup, universal 60–100-ms Node startup, or zero lag were unmeasured assumptions and are withdrawn. T22 must measure launch overhead and installed-runtime failure effects.

## Completed qualification and limits

T01–T03 and G0 are complete. T02/T03 used updated Cursor 3.26.16 (commit `8fcb8ace5c73fa31f2e2707fd6783160e4ed3e40`, API 1.128.0, extension-host Node 24.19.0). The host table above records the earlier T01 run. The [qualification report](docs/phase-a-qualification.md) records 159 new native events, timing samples, explicit missing-completion and out-of-order cases, and accepted project-hook ownership policy. Child lifecycle-to-file joins and session-end delivery remain unavailable. Remote/cloud, Tab, controls, retained contents, additional platforms and performance claims remain outside the qualified scope. T04 subsequently implemented the schema/TypeScript validation boundary; production helper/lease/journal/UI work has not begun. See [event contract](docs/event-contract.md).
