# Tasks

## 1. Concurrency primitive

- [x] 1.1 Implement `mapPool(items, limit, fn)` in `src/util/pool.ts` (order-preserving, capped in-flight jobs, rejects on limit < 1, stops on first error); verify `test/pool.test.ts` (order, cap via in-flight counter, limit > items, empty input, invalid limit, error propagation)

## 2. Runner

- [x] 2.1 Add `--concurrency N` (default 1, `$CONCURRENCY`) to `src/cli.ts`, validate it as a positive integer (exit 2), record it in the run config, update `--help`, and run tasks through `mapPool`; verify `test/cli.test.ts` (`--concurrency 2` succeeds, `0`/`-1`/`1.5`/`x` rejected)
- [x] 2.2 Verify a shared agent and offline provider produce the same per-task trajectories at concurrency 4 as sequentially, and that `events.jsonl` stays valid JSONL with per-task iteration order; covered in `test/loop.test.ts`

## 3. Judge

- [x] 3.1 Request judge samples concurrently in `src/agent/judge.ts` with unchanged verdict order and summed usage; verify `test/judge.test.ts` (max in-flight equals samples, aggregation order unchanged)

## 4. Anthropic provider

- [x] 4.1 Pass SDK `maxRetries` (default 4) and `timeout` (default 120 000 ms) when the provider builds its own client; add `--api-retries` and `--api-timeout-ms` flags; verify `test/provider.test.ts` and existing fake-client tests

## 5. Integration

- [x] 5.1 Run `npm run typecheck`, `npm test`, `npm run spec:validate` and `npm run demo -- --quiet --concurrency 4`; verify pass rate 0% → 75%, identical to the sequential run
