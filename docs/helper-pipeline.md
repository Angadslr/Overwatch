# T05 — bounded Go hook pipeline

Implemented and reviewed for Angad on 22 October 2026. This records the standard-library-only T05 helper foundation. T06 now supplies [spool publication](local-transport.md); T07 supplies [normalized operation mapping](cursor-file-projection.md). No native hook configuration is installed or changed by these tasks.

## Build and run

Go 1.26 or later is required. This session used the official Go 1.27.3 darwin/arm64 archive, verified against SHA-256 `dd3908cf20959d798c1e06ebe5b72213f0505ce01373b40ce3110975a6cd99c2` from the [Go download manifest](https://go.dev/dl/?mode=json). The extracted toolchain is project-local and ignored at `.local/go-toolchain/go`; no global installation was performed.

For that local toolchain, run from the project root:

```sh
export PATH="$PWD/.local/go-toolchain/go/bin:$PATH"
export GOCACHE="$PWD/.local/go-cache"
export GOTOOLCHAIN=local
npm run build:helper
npm run test:helper
cd helper
go test -race -cover ./...
go vet ./...
go test ./internal/input -run '^$' -fuzz FuzzProject -fuzztime 10s -parallel 2
```

The npm Go wrapper now selects the local toolchain when present or Go on PATH, with a project-local cache, so the exports are needed only for direct Go commands. `build:helper` emits `dist/cursor-supervision-hook`. It is independent of the Node probe build and excluded from probe VSIX publication by an exact package exclusion. Invoke it as `cursor-supervision-hook beforeReadFile`, with raw Cursor JSON on stdin, for response-only behavior. T06 additionally supports `HOOK STORAGE` to publish through private extension-generated configuration. The only stdout output is the hook response; stderr remains empty. T08 now connects the native fixture tree and owned hook lifecycle; general installation/recovery remains later work. See [T08 verification](t08-vertical-slice.md).

## Response and time bounds

Five permission-bearing hooks return exactly `{"permission":"allow"}\n`: `preToolUse`, `beforeReadFile`, `beforeShellExecution`, `beforeMCPExecution`, `subagentStart`. The nine other discovery hooks return exactly `{}\n`. `sessionEnd` has response compatibility only and remains unqualified for installation. Unknown or missing launcher arguments return the empty benign shape; an extra argument never becomes a path or executable option.

The response is written once, before input parsing or a telemetry consumer runs. A short/failed stdout write is not retried, since a second response could corrupt the protocol. A failed output pipe cannot be made reliable by the helper; runtime crashes and launcher failures remain outside this response guarantee.

The process waits at most 1,500 ms for input and consumer work after writing the response. An open stdin pipe, or a stuck consumer, cannot keep the short-lived CLI alive indefinitely. The work goroutine uses a buffered result channel; a late result cannot block the process. `run` is for a single process invocation, not a reusable long-running service: callers that reuse it would need cancellation-aware readers/consumers. Consumers must own and close their resources, use bounded operations, and avoid spawning uncontained background work. T06 adds local file publication; no network, listener, shell execution or raw logging exists in the helper. A process deadline can end collection before its diagnostic can be published.

## Privacy boundary

`helper/internal/input/project.go` returns a `Result`: optional `Metadata`, plus content-free invocation counters. It is safe source metadata, **not an event-v1 spool record**. T06 wraps it in a source-envelope record; do not feed that wrapper to `parseEvent` or persist it under the event-v1 schema. T07 maps source facts without treating source session/child hints as proven file actor ownership.

Only fixed hook/tool/status/failure categories, numeric durations, interrupt booleans, bounded version numbers, receipt time, a UUID v4 and hashed identity/path hints survive. Source strings are SHA-256 hashed with separate domains. Parent and conversation IDs share their domain so a directly supplied relationship remains comparable. Other identity kinds stay distinct. IDs still require environment/root scoping before any joins; hashing is not anonymity or proof of a join.

Raw contents, prompts, commands, descriptions, tasks, tool arguments/results, email, reasoning, transcript paths and unknown field values/names never enter results or logs. T07 hashes the measured nested path aliases as well as top-level paths; conflicting aliases omit the hint. T06 hashes at most 16 workspace roots for routing. Raw roots and working directories are discarded. A path hash is a source hint, not a canonical file key or navigable path. T10 must supply containment, exclusions and an approved visible-path projection before file navigation can work. No arbitrary raw path array is copied or truncated.

Counters distinguish unknown fields, deliberately excluded sensitive fields, invalid known fields, and fixed gap codes. A malformed input or failed consumer is a coverage problem, never a native denied/failed outcome. `status`, `failureType` and `interrupted` preserve source reports separately; no completion, persistence, acceptance or child ownership is inferred.

## Resource and decoding bounds

| Dimension | Behavior |
| --- | --- |
| Raw input | Read at most 32 MiB + one detection byte; oversize returns a gap |
| Projected result | At most 16 KiB; checked before delivery |
| JSON nesting | At most 64, checked before standard decoding |
| Object fields | At most 512 per inspected object; keys at most 128 UTF-8 bytes |
| Duplicate fields | Reject in top-level/inspected tool-input objects, including escaped duplicate keys |
| Opaque source inputs | At most 256 decoded UTF-8 bytes; path hint at most 4,096 |
| Version | Three numeric dot-separated components, each at most eight digits |
| Duration | Finite number in 0–86,400,000 ms; zero preserved |
| Missing or mismatched hook declaration | Gap with no metadata |

One raw field is decoded at a time; no map of untrusted values is accumulated. Unknown values are discarded, though their raw JSON occupies bounded temporary memory while skipping. Total memory is bounded by the input cap and decoder copies, not the smaller projection cap. This is not a constant-memory streaming parser. Invalid UTF-8 and malformed/trailing JSON are rejected. Source strings containing U+FFFD are rejected conservatively to prevent Go's replacement of unpaired UTF-16 surrogates from aliasing distinct identities. Valid surrogate pairs remain supported.

## Shared contract generation

`npm run generate:contracts` now derives both `src/core/contracts.ts` and `helper/internal/contract/event_v1.go` from `schemas/event-v1.schema.json`. The generator produces formatted Go without requiring Go on PATH. `npm run check:contracts` detects drift in either language and performs no writes. Optional Go fields use pointers so zero metrics survive JSON round trips. Both generated files describe shapes, not runtime validation; the authoritative TypeScript boundary still enforces enum, bounds, stage and evidence rules. The Go fixture round-trip test proves shape parity without claiming equivalent Go runtime validation.

## Review and actual verification

A manual high-rigor review covered response isolation, privacy, decoder ambiguity, allocation bounds, identity/evidence semantics, package contents and task scope. Findings fixed during review:

- Unpaired UTF-16 escapes could collapse identities under Go decoding: conservatively reject replacement characters, with regression tests.
- Generated Go needed deterministic formatting without adding a Go requirement to existing TypeScript checks: align columns in the generator and verify against `gofmt`.
- The probe package would otherwise include new helper sources/binary: exclude `helper/**` and `dist/cursor-supervision-hook` from the probe VSIX.

Actual validation on macOS arm64:

- Go tests, race detector and `go vet ./...` passed; helper build passed.
- Each of the 14 response kinds ran as a real compiled child process with valid input, malformed JSON, a non-object, invalid UTF-8, oversized input and unreadable stdin. Tests assert exact stdout, empty stderr and exit 0. An open stdin test proves response-before-EOF and bounded process termination.
- Injected consumer errors, panics, timeout, failed reads, identity-source failure and partial stdout writes have focused tests. Consumer failure injection uses `run` in-process; it does not add test switches to the production CLI.
- A 10-second fuzz run passed 468,699 executions, covering arbitrary input without projection panic or forbidden marker leakage.
- Existing strict TypeScript/contract checks, 23 unit tests, build and 5 probe process tests passed.

No new native Cursor delivery or platform qualification is claimed. T06 now implements spool ownership/retries, root routing and a durable source journal. Native UI/installation, retention, automatic ownership recovery and physical path policy remain later tasks.
