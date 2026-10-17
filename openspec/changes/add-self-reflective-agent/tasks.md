# Tasks

## 1. Project setup

- [x] 1.1 Add `package.json` (ESM; scripts `start`, `demo`, `test`, `typecheck`), `tsconfig.json` (strict, NodeNext, noEmit) and `.gitignore`; verify `npm ci` succeeds
- [x] 1.2 Add dependencies `@anthropic-ai/sdk`, `zod` and dev deps `typescript`, `tsx`, `@types/node`; verify `npm run typecheck` runs on an empty `src/`

## 2. Domain types and providers

- [x] 2.1 Define Zod schemas/types for Task (rubric, reference, hard checks, offline fixtures), Verdict, Critique, Constraint, Attempt, TaskRun, metrics in `src/types.ts`; verify typecheck passes
- [x] 2.2 Implement provider interface and balanced-brace JSON extractor in `src/llm/provider.ts`; verify `test/provider.test.ts` covers fenced JSON, braces inside strings and no-object errors
- [x] 2.3 Implement Anthropic provider with forced tool-use JSON, Zod validation, retry-with-feedback and temperature fallback in `src/llm/anthropic.ts`; verify with a fake client in `test/provider.test.ts` (invalid → retry → valid; per-role model routing)
- [x] 2.4 Implement deterministic offline provider (constraint-driven draft selection, keyword judge, keyword critic) in `src/llm/offline.ts`; verify determinism test in `test/provider.test.ts`

## 3. Answer evaluation

- [x] 3.1 Write judge prompt (blind, anchored scale, evidence rationales) in `src/agent/prompts.ts`; verify a test asserts no iteration/revision wording in judge prompts
- [x] 3.2 Implement judge call, criterion normalisation (omitted → 0, unknown ignored), weighted score and multi-sample aggregation in `src/agent/judge.ts`; verify `test/judge.test.ts`
- [x] 3.3 Implement deterministic hard checks (word limit, required/forbidden terms, `Final answer:`) with −1.5 penalty and pass gating; verify `test/judge.test.ts` scenarios from the answer-evaluation spec

## 4. Reasoning critique

- [x] 4.1 Write critic prompt including verdict, hard-check failures and constraints already in force; verify `test/critic.test.ts` asserts ledger appears in the prompt
- [x] 4.2 Implement critique call, hard-check → stable constraint mapping (no answer leakage) and deduplicating capped ledger in `src/agent/critic.ts`; verify `test/critic.test.ts` (dedupe, cap keeps newest, no leak, stable text)

## 5. Reflection loop

- [x] 5.1 Implement executor (first draft vs. constrained revision prompt) in `src/agent/executor.ts`; verify loop test asserts first request has no constraints and revisions include previous best + constraints
- [x] 5.2 Implement `SelfReflectiveAgent` in `src/agent/loop.ts`: revise-from-best, critique every non-final attempt, stop on pass/plateau/budget/error, return best; verify `test/loop.test.ts` covers pass, regression, plateau, budget of one and judge failure mid-run

## 6. Metrics, logging and report

- [ ] 6.1 Implement per-task metrics and suite summary in `src/metrics/metrics.ts`; verify `test/metrics.test.ts` (gap closed, regression count, zero net regressions, tokens-per-point null when no gain)
- [ ] 6.2 Implement JSONL `RunLogger`, console trace and `report.md` renderer in `src/metrics/logger.ts`; verify `test/metrics.test.ts` asserts the four run artifacts exist and `judged` events carry the specified fields

## 7. Eval runner and task suite

- [ ] 7.1 Author `tasks/suite.json` with four tasks (idempotency keys, Kafka poison retry, capacity math, Postgres indexing) incl. offline fixtures exercising pass, regression, hard-check and plateau paths; verify suite parses
- [ ] 7.2 Implement CLI in `src/cli.ts` (flags, provider default/validation, per-role models, summary table); verify `test/cli.test.ts` (unknown provider fails, invalid suite rejected, `--only` subset, offline default without key)
- [ ] 7.3 Write README (quick start, architecture, design decisions, metrics, caveats); verify the documented `npm test` and `npm run demo` commands run as written

## 8. CI and integration

- [ ] 8.1 Add `.github/workflows/ci.yml` (Node 22: `npm ci`, typecheck, tests, `openspec validate --all --strict`, offline demo, upload run artifact); verify workflow YAML parses and every step passes locally
- [ ] 8.2 Run the full offline suite end to end and verify pass rate improves, net regressions are 0, and the report is generated

## Workflow follow-up

- Archive the change with `openspec archive add-self-reflective-agent` and verify specs land in `openspec/specs/`.
- Push the branch, open a PR, and confirm the CI pipeline is green.
