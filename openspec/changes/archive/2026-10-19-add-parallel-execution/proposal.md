# Proposal

## Why

Tasks in a suite are independent, yet the runner executes them one at a time, and multi-sample judging waits for each verdict before requesting the next. Wall-clock time grows linearly with suite size and judge samples, which makes larger suites and real-model runs slow. Running in parallel also raises the rate of API calls, so the Anthropic provider needs SDK-level retry/backoff and a request timeout to survive 429s and slow responses.

## What Changes

- New bounded-concurrency helper `mapPool(items, limit, fn)` that never runs more than `limit` jobs at once and returns results in input order.
- Runner gains `--concurrency N` (default 1, also `$CONCURRENCY`), validated as a positive integer and recorded in the run config; tasks run through the pool.
- Judge samples are requested concurrently; verdict order and summed usage are unchanged.
- Anthropic provider builds its SDK client with `maxRetries` (default 4) and `timeout` (default 120 000 ms), exposed as `--api-retries` and `--api-timeout-ms`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-runner`: bounded concurrent task execution and API retry/timeout configuration.
- `answer-evaluation`: multi-sample judge verdicts are requested concurrently.

## Impact

- New `src/util/pool.ts`; changes to `src/cli.ts`, `src/agent/judge.ts`, `src/llm/anthropic.ts`; new and extended tests.
- Default behaviour (concurrency 1) is unchanged. With concurrency > 1, console trace and `events.jsonl` lines from different tasks interleave; every event still carries `taskId`.
- Higher concurrency multiplies request rate against the Anthropic API; SDK retries absorb transient 429/5xx.
