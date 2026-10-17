# Self-Reflective Agent with Auto-Eval

[![CI](https://github.com/imranmali/Self-reflective-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/imranmali/Self-reflective-agent/actions/workflows/ci.yml)

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
npm test                      # 45 tests, fully offline
npm run demo                  # full loop on tasks/suite.json with the offline provider
ANTHROPIC_API_KEY=sk-... npm start -- --judge-samples 3   # real models
```

Options: `--provider offline|anthropic --tasks <file> --only id1,id2 --max-iters 5 --threshold 8.5 --patience 2 --min-delta 0.25 --judge-samples 1 --gen-model claude-sonnet-5-5 --judge-model claude-opus-5-5 --out runs --quiet`

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

`.github/workflows/ci.yml` runs on every push and PR: `npm ci` → typecheck → tests → OpenSpec strict validation → offline demo (run artifacts uploaded). No API key is needed.

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
| `tasks/suite.json` | Tasks: prompt, weighted rubric, reference (judge-only), hard checks, offline fixtures |

## Design decisions (the parts that matter)

- **Regenerate from the best attempt, not the last.** A bad revision can't compound; the next revision restarts from the high-water mark.
- **Return the best attempt.** Reflection can't make the output worse than the first draft (per the judge). `tasksRegressedNet` should always be 0.
- **Critique every attempt, including failed revisions.** Why a revision didn't help is new signal; it enters the ledger even though the next draft restarts from `best`.
- **Constraint ledger.** Constraints persist and dedupe across iterations so earlier fixes stay enforced; capped (newest kept) to avoid prompt bloat.
- **Code verifies what code can.** Word limits, required/forbidden terms and exact final answers are checked deterministically, penalised (`-1.5` each) and block a pass regardless of the judge. Their constraint text is stable and **never leaks the expected answer**.
- **Judge hygiene.** Blind to iteration/prior scores (no "revised ⇒ better" anchoring), anchored 0–10 scale, evidence-quoted rationales, told to ignore length and self-assessment, temperature 0. Missing criteria are scored 0 so a judge can't dodge one. Use a **different, stronger judge model** than the generator to reduce self-preference bias; `--judge-samples N` averages N verdicts to cut variance.
- **Stop rules:** pass (score ≥ threshold and no hard-check failures) · plateau (`patience` revisions without `minDelta` gain) · `maxIterations` · error (returns best so far).

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

## Caveats

- LLM-as-judge measures *agreement with the judge*, not truth. Calibrate on a small human-labelled set before trusting gains; watch for reward hacking (keyword stuffing to satisfy constraints).
- Self-reflection helps most when the judge has signal the generator lacked (reference answers, hard checks, a stronger model). With same-model judge and no reference, gains are often noise — `--judge-samples` and a held-out human check expose that.
