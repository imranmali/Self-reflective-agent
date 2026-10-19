# Design

## Context

Each `SelfReflectiveAgent.run(task)` keeps all loop state in locals; the offline provider keys its only state (last draft index) by `task.id`; `RunLogger` writes each event with a single `appendFileSync` call. So one agent and one provider can serve several tasks at once without changes to the loop.

## Decisions

**D1 — Worker-pool helper, no dependency.** `mapPool` starts `min(limit, n)` workers that pull the next index from a shared counter and write into a pre-sized results array, so output order matches input order regardless of completion order. On the first failure it stops handing out new items and rejects. *Alternative:* `p-limit` — an extra dependency for ~20 lines.

**D2 — Default concurrency 1.** Keeps current behaviour, log order and API load; parallelism is opt-in.

**D3 — Interleaved but valid event log.** Lines from concurrent tasks interleave; each is a complete JSON object with `taskId`, and per-task iteration order is preserved. No per-task log files.

**D4 — Concurrent judge samples via `Promise.all`.** Samples are independent; `Promise.all` preserves index order so aggregation (first sample's summary, rationale order) is identical to the sequential version.

**D5 — SDK retries, separate from schema retries.** The existing `maxRetries` option counts schema-validation re-asks; SDK backoff for 408/409/429/5xx is a new `apiRetries` option (default 4) plus `timeoutMs` (default 120 000), applied only when the provider builds its own client so injected fake clients are untouched.

## Risks / Trade-offs

- [Rate limits at high concurrency] → SDK backoff; users lower `--concurrency`.
- [Interleaved console trace is harder to read] → each line is prefixed `[taskId#iteration]`; use `--quiet` and `report.md`.
- [Duplicate task ids would share offline provider state] → ids are expected to be unique within a suite.
