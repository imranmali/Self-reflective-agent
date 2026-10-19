# Self-Reflective Agent with Auto-Eval

[![CI](https://github.com/imranmali/Self-reflective-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/imranmali/Self-reflective-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933)

Execute → **LLM-as-judge** → **critique reasoning** → **regenerate with constraints** → repeat, logging improvement metrics per iteration and per suite.

```
            ┌──────────────────────────── constraint ledger (accumulates, deduped) ◄─────────┐
            ▼                                                                                │
 task ─► EXECUTE ─► JUDGE (rubric, blind) ─► hard checks (code) ─► pass? ─yes─► return best  │
          ▲  (from best attempt)                 │                    │ no / plateau / budget │
          │                                      ▼                    ▼                       │
          └────────────── REGENERATE ◄──── CRITIC: root cause ─► constraints ─────────────────┘
                                               │
                                     events.jsonl · runs.json · summary.json · report.md
```

## Quick start

```bash
npm install
npm test                      # 141 tests, fully offline
npm run test:coverage         # same, with Node's built-in coverage + thresholds (writes lcov.info)
npm run demo                  # full loop on tasks/suite.json with the offline provider
ANTHROPIC_API_KEY=sk-... npm start -- --judge-samples 3 --concurrency 4   # real models
```

| Option | Default | Notes |
|---|---|---|
| `--provider offline\|anthropic` | `anthropic` if `ANTHROPIC_API_KEY` is set, else `offline` | |
| `--tasks <file>` / `--only id1,id2` | `tasks/suite.json` / all | suite is schema-validated; duplicate ids are rejected |
| `--max-iters` `--threshold` `--patience` `--min-delta` | `5` `8.5` `2` `0.25` | stop rules |
| `--judge-samples N` | `1` | N verdicts averaged, requested concurrently |
| `--gen-model` / `--judge-model` | `claude-sonnet-5-5` / `claude-opus-5-5` | also `GEN_MODEL` / `JUDGE_MODEL`; judge model also runs the critic |
| `--concurrency N` | `1` (or `$CONCURRENCY`) | tasks in flight at once |
| `--api-retries N` / `--api-timeout-ms N` | `4` / `120000` | SDK retries with backoff on 429/5xx; per-request timeout |
| `--out <dir>` / `--quiet` | `runs` | |

## Spec-driven development (OpenSpec)

Requirements live in [`openspec/specs/`](openspec/specs) — one spec per capability:
`reflection-loop`, `answer-evaluation`, `reasoning-critique`, `improvement-metrics`, `eval-runner`.
The change that introduced them (proposal, design, tasks) is archived under [`openspec/changes/archive/`](openspec/changes/archive).

```bash
npm run spec:validate         # openspec validate --all --strict (also runs in CI)
npx openspec list --specs
```

New work: `/opsx:propose "<idea>"` → `/opsx:apply` → `/opsx:archive` (Claude Code commands in `.claude/`).

## CI

`.github/workflows/ci.yml` runs on every push and on PRs from forks. No API key is needed — everything runs offline.

| Job | What it does |
|---|---|
| `typecheck · test` | Node **22 and 24** matrix: `npm ci` → `tsc --noEmit` → `npm test` |
| `coverage` | `npm run test:coverage`; fails below 80 % lines / 75 % branches / 90 % functions; summary in the job page, `lcov.info` uploaded |
| `openspec validate` | `openspec validate --all --strict` |
| `offline demo` | full reflection loop on the suite; `runs/` uploaded as an artifact |

Same-repo PRs reuse the push run instead of running twice; runs on `main` are never cancelled. Dependabot (`.github/dependabot.yml`) opens weekly grouped updates for npm and GitHub Actions.

## Layout

| File | Role |
|---|---|
| `src/agent/loop.ts` | `SelfReflectiveAgent` — orchestration, stop rules, best-attempt tracking |
| `src/agent/executor.ts` | First draft / constrained regeneration |
| `src/agent/judge.ts` | LLM-as-judge (structured verdict), weighted scoring, multi-sample averaging, deterministic hard checks |
| `src/agent/critic.ts` | Reasoning critique → constraints; constraint ledger merge; hard-check → constraint mapping |
| `src/agent/prompts.ts` | All prompts (generator / judge / critic) |
| `src/llm/anthropic.ts` | Anthropic provider; JSON via **forced tool use** + Zod validation + retry-with-error-feedback |
| `src/llm/offline.ts` | Deterministic provider for CI/demo (rule-based judge, constraint-driven draft selection) |
| `src/metrics/*` | Per-task + suite metrics, JSONL event log, markdown report |
| `src/util/pool.ts` | `mapPool` — bounded-concurrency map that preserves input order |
| `src/cli.ts` | Eval runner: flags, suite validation, provider selection, parallel task execution |
| `tasks/suite.json` | Tasks: prompt, weighted rubric, reference (judge-only), hard checks, offline fixtures |

## Design decisions (the parts that matter)

- **Regenerate from the best attempt, not the last.** A bad revision can't compound; the next revision restarts from the high-water mark.
- **Return the best attempt.** Reflection can't make the output worse than the first draft (per the judge). `tasksRegressedNet` should always be 0.
- **Critique every attempt, including failed revisions.** Why a revision didn't help is new signal; it enters the ledger even though the next draft restarts from `best`.
- **Constraint ledger.** Constraints persist and dedupe across iterations so earlier fixes stay enforced; capped (newest kept) to avoid prompt bloat.
- **Code verifies what code can.** Word limits, required/forbidden terms and exact final answers are checked deterministically, penalised (`-1.5` each) and block a pass regardless of the judge. Their constraint text is stable and **never leaks the expected answer**.
- **Judge hygiene.** Blind to iteration/prior scores (no "revised ⇒ better" anchoring), anchored 0–10 scale, evidence-quoted rationales, told to ignore length and self-assessment, temperature 0. Missing criteria are scored 0 so a judge can't dodge one. Use a **different, stronger judge model** than the generator to reduce self-preference bias; `--judge-samples N` averages N verdicts to cut variance.
- **Stop rules:** pass (score ≥ threshold and no hard-check failures) · plateau (`patience` revisions without `minDelta` gain) · `maxIterations` · error (returns best so far).

## Scalability

The runner is built so that a bigger suite, more judge samples or a real API under rate limits costs wall-clock time and tokens predictably rather than correctness.

- **Bounded task concurrency.** `--concurrency N` runs up to N tasks at once through `mapPool`. Results keep suite order, and a failure stops new tasks from starting. One agent instance is shared safely: every piece of per-task state (ledger, best attempt, plateau counter) lives inside `run()`, the offline provider keys its state by task id, and task ids are required to be unique.
- **Concurrent judge samples.** `--judge-samples N` sends the N judge calls in parallel. The latency of an iteration stays roughly flat as N grows; aggregation is unchanged and deterministic.
- **Rate limits and slow calls.** The Anthropic SDK retries 408/409/429/5xx and connection errors with exponential backoff (`--api-retries`), and each request has a timeout (`--api-timeout-ms`). Schema-invalid JSON is retried separately, with the validation error fed back. A task whose judge fails mid-run still returns its best attempt so far (`stopReason: "error"`) instead of failing the suite.
- **Bounded prompt growth.** The constraint ledger is deduplicated and capped (`maxConstraints`, newest kept), and revisions build from the single best attempt rather than the full history, so prompt size doesn't grow with iteration count.
- **Bounded cost per task.** `maxIterations` and plateau detection (`patience`, `minDelta`) cap the number of calls per task at `maxIterations × (1 + judgeSamples + 1)`. `tokensPerPointGained` in the summary shows whether reflection is worth what it costs.
- **Streaming-friendly logs.** Events are appended to `events.jsonl` one line at a time, each carrying `taskId` and `iteration`. Concurrent tasks interleave but every line stays valid JSON, so the log can be tailed or shipped to any log pipeline while the run is in progress.
- **Stateless runs.** Each run writes to its own `runs/<timestamp>/` directory and shares nothing with others. Splitting a large suite across machines or CI shards with `--only` works without coordination, and the `summary.json` files can be combined afterwards.

**Tuning:** start with `--concurrency` at about your rate-limit headroom divided by `1 + judgeSamples`. If you see sustained 429s, lower it rather than raising `--api-retries`.

## Metrics

Per task: `initialScore`, `finalScore` (best), `absoluteGain`, `relativeGainPct`, **`gapClosedPct`** = (best − initial)/(10 − initial), `iterationsToPass`, `regressions`, `perCriterionGain`, `constraintsAccumulated`, `totalTokens`, `totalLatencyMs`, `scoreTrajectory`.
Suite: pass rate first-draft → final, mean scores, mean gain, mean gap closed, stop-reason histogram, **tokens per score point gained** (the cost of reflection).

Every step is an event in `runs/<ts>/events.jsonl` (`generated`, `judged`, `critiqued`, `constraints_merged`, `task_end`, …) — pipe into any log/analytics stack.

## Offline demo result (`npm run demo`)

| Task | Trajectory | Stop |
|---|---|---|
| idempotency-keys | 6.28 → 7.3 → 10 | passed (fixed missing edge cases, then word-limit violation) |
| kafka-poison-retry | 6.65 → **5.35** → 10 | passed (regression absorbed: regenerated from best) |
| capacity-math | 2.62 → 10 | passed (wrong final answer caught by hard check) |
| postgres-indexing | 6 → 7 → 7 → 7 | plateau (generator out of ideas → stops, returns #1) |

Pass rate 0% → 75%, mean score 5.39 → 9.25. These numbers come from the offline provider — they show the orchestration, not model quality.

## Contributing

1. Branch from `main` with a descriptive prefix: `feat/…`, `fix/…`, `test/…`, `ci/…`, `docs/…`, `chore/…`.
2. For behaviour changes, propose an OpenSpec change first (`/opsx:propose`), then implement it and archive it.
3. Before opening a PR, run `npm run typecheck && npm run test:coverage && npm run spec:validate && npm run demo -- --quiet`. The PR template has the checklist.

## Caveats

- LLM-as-judge measures *agreement with the judge*, not truth. Calibrate on a small human-labelled set before trusting gains; watch for reward hacking (keyword stuffing to satisfy constraints).
- Self-reflection helps most when the judge has signal the generator lacked (reference answers, hard checks, a stronger model). With same-model judge and no reference, gains are often noise — `--judge-samples` and a held-out human check expose that.

## License

[MIT](LICENSE) © 2026 Imran Ali
