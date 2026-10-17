# Design

## Context

Greenfield repo. Constraints from project config: TypeScript ESM on Node 22 via `tsx` (no build), and CI has no API key, so the whole loop must be exercisable offline and deterministically. Requirements are in `specs/`; motivation in `proposal.md`.

## Goals / Non-Goals

**Goals:**
- One provider interface (`text`, `json`) behind which real and offline models are interchangeable.
- Structured, validated judge/critic outputs — no regex-scraping of free text on the happy path.
- Every decision the loop makes (score, stop, best-attempt) is reproducible from the event log.

**Non-Goals:**
- Tool use / multi-step agents inside a single attempt.
- Human labelling UI or judge calibration tooling (see Risks).
- Parallel task execution or streaming.

## Decisions

**D1 — Structured output via forced tool use + Zod.** Judge and critic define a Zod schema; the Anthropic provider converts it to JSON Schema and forces a tool call with that `input_schema`, then validates with Zod and retries with the validation error appended. *Alternatives:* JSON-in-prose + regex (brittle), provider-native JSON mode (less portable across models). A balanced-brace extractor remains as fallback if no tool block is returned.

**D2 — Revise from best, return best.** The generator always receives the best attempt so far, never the latest, and the run returns the best. *Alternative:* always revise the latest (simpler) — rejected because one bad revision then compounds.

**D3 — Critique every non-final attempt, including failed revisions.** Why a revision failed is new signal for the ledger even though the next revision restarts from the best. *Alternative:* critique only the best — cheaper but loses that signal.

**D4 — Hard checks in code, mapped to stable constraints.** Word count, required/forbidden terms and final answer are checked deterministically and penalised (−1.5 each). Their constraint text is fixed per check type so the ledger dedupes them, and never includes expected answers (avoids leaking the key into the generator).

**D5 — Constraint ledger, newest-wins cap.** Prevents earlier fixes from silently regressing while bounding prompt growth (default cap 12).

**D6 — Judge hygiene.** Blind to iteration/history; anchored 0–10 scale; evidence-quoted rationales; length and self-assessment explicitly not rewarded; temperature 0 for a single sample, 0.3 when sampling N > 1 and averaging. Separate judge model flag to reduce self-preference bias.

**D7 — Offline provider as a first-class provider.** Uses per-task fixtures: a list of drafts and per-criterion keywords. The generator picks, among drafts not yet used, the one satisfying the most constraint terms (quoted strings and word limits) — so regressions and plateaus arise from the loop, not from a script. Judge = keyword coverage per criterion (2 + 8·coverage) with a concision cap; critic = missing keywords → `must` constraints. *Alternative:* recorded real-model cassettes — more realistic but brittle to prompt changes.

**D8 — Plateau rule.** An attempt counts as improvement only if it beats the best by `minDelta` (default 0.25) or newly passes; tiny gains still update the best but count toward patience (default 2).

**D9 — Append-only JSONL log + end-of-run artifacts.** Cheap, greppable, pipeable into any analytics store; report.md for humans.

**D10 — CI.** GitHub Actions on push/PR: `npm ci`, typecheck, tests, `openspec validate --all --strict`, offline demo, upload demo run as an artifact.

## Risks / Trade-offs

- [Judge measures agreement with the judge, not truth] → reference answers and hard checks where possible; documented need to calibrate on a small human-labelled set.
- [Reward hacking: keyword stuffing to satisfy constraints] → judge instructed not to reward length; concision criteria and word limits.
- [Same-model self-preference] → separate `--judge-model`; multi-sample judging.
- [Offline numbers mistaken for model quality] → README and report label the provider; offline is for orchestration tests only.
- [Token cost of 3 calls per iteration] → patience/plateau stop, iteration cap, tokens-per-point metric to make cost visible.
- [Newer models rejecting `temperature`] → provider drops the parameter once on a 400 mentioning it and remembers.
