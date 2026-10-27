# T18 — Source Health and self-check

Open **Agent Supervision → Source Health**. Its rows deliberately separate owned integration registration, the last helper response check, observation of the unique self-check record in the collector, collector lease ownership, native source evidence and permanently partial source coverage.

Run **Agent Supervision: Run Helper and Collector Self-check**. Collection must already be explicitly enabled in the qualified trusted local fixture. The command does not enable collection, start an agent, call a model, register another producer or use a workspace-defined executable. It uses the extension-owned helper pinned during enable, returns its normal empty observation response, and publishes a diagnostic record carrying a trusted-launcher UUID. Raw native payload fields cannot mint this marker. The record normalizes to `self-check/selfCheck`, not native activity, a file operation or a source gap.

A successful response and successful ingestion are different results. A valid helper response with no observed diagnostic record is `delivery-timeout`; launch/response failures have separate categories. Checks and child lifetimes are bounded; error strings/stdout/stderr contents are not retained. Repeated requests share the in-flight check. A new enable resets the check evidence, and disable/ownership generation changes prevent a false passed result.

| Evidence / diagnosis | Action |
|---|---|
| Integration/collector off | Explicitly enable the qualified fixture; inspect foreign hooks/ownership rather than overwriting them |
| Unsupported environment | Use the qualified trusted local macOS arm64 fixture; remote/virtual modes remain unsupported |
| Helper launch/response failed | Rebuild the owned helper and verify executable mode; do not substitute a workspace script |
| Helper responded, record absent | Inspect publisher state, private storage/inbox permissions, capacity and collector ownership |
| Strict schema rejection | Check helper/extension protocol compatibility; rejected raw data is omitted |
| Scope/profile rejection | Use the qualified Cursor build and enabled physical root; do not broaden routing |
| Privacy-policy gap | Disable and explicitly re-enable to compile policy; review exclusions without bypassing them |
| Queue backlog | Keep the collector active, inspect ingestion/storage errors and respect partial sampling |
| Torn final journal tail | Inspect the disclosed recovery gap; complete/middle corruption is not silently repaired |
| Native source awaiting | A self-check cannot prove native delivery. An ordinary authorized Agent file action is needed separately |

Queue diagnostics sample at most 256 directory entries every two seconds while collecting. They report a lower-bound ready count, age of the oldest observed ready-file metadata and sample time. They do not read payload content or claim a complete backlog audit. Schema/scope/privacy rejection counters and transport failures remain separate. Health stays live while activity presentation is frozen.

Default diagnostics contain only bounded safe readiness metadata, counts and categorized actions. No paid model call or new ordinary Agent action was used to verify these self-checks. Native source evidence remains a separate measured capability.
