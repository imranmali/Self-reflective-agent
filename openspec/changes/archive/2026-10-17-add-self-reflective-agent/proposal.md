# Proposal

## Why

Single-shot LLM answers often miss rubric points, break hard limits (e.g. word counts), or get the final number wrong, and nobody measures whether a "reflect and retry" step actually helps. We need an agent that evaluates its own output, critiques the reasoning behind it, revises under explicit constraints, and logs metrics proving (or disproving) the improvement.

## What Changes

- New self-reflective loop: execute → LLM-as-judge evaluation → reasoning critique → constrained regeneration, repeated until pass, plateau, or budget.
- New evaluation layer: rubric-based LLM-as-judge with structured, schema-validated verdicts, plus deterministic hard checks (word limit, required/forbidden terms, exact final answer) that are run in code and can block a pass.
- New critique layer: root-cause diagnosis that emits specific, checkable constraints, accumulated in a deduplicated ledger across iterations.
- New metrics and logging: per-iteration JSONL events, per-task and suite-level improvement metrics, and a markdown report.
- New eval runner: CLI over a JSON task suite, with an Anthropic provider for real runs and a deterministic offline provider for CI and demos.
- New CI pipeline: typecheck, tests, OpenSpec validation and an offline demo run on every push and pull request.

## Capabilities

### New Capabilities

- `reflection-loop`: orchestration of attempts, revision from the best attempt, stop conditions, and selection of the returned answer.
- `answer-evaluation`: scoring an answer against a weighted rubric via an LLM judge plus deterministic hard checks, producing a pass/fail verdict.
- `reasoning-critique`: turning a verdict into a diagnosis and actionable constraints, and maintaining the constraint ledger.
- `improvement-metrics`: the metrics, event log and report that quantify whether reflection improved results and at what cost.
- `eval-runner`: the command-line entry point, task-suite format, and provider selection (real vs. offline).

### Modified Capabilities

None (greenfield repository).

## Impact

- New TypeScript code under `src/`, tests under `test/`, task suite under `tasks/`.
- Dependencies: `@anthropic-ai/sdk`, `zod`; dev: `typescript`, `tsx`, `@types/node`.
- New GitHub Actions workflow `.github/workflows/ci.yml`.
- Real runs consume Anthropic API tokens (generator + judge + critic per iteration); offline runs cost nothing.
