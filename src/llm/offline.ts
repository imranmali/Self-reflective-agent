import type { z } from "zod";
import type { Constraint, Critique, Task, Verdict } from "../types.ts";
import type { JsonResult, LLMProvider, LLMRequest, TextResult } from "./provider.ts";

/**
 * Deterministic stand-in for an LLM so the full loop runs offline (CI, demos, tests).
 *
 *  - generator: picks among the task's fixture drafts, choosing the one that satisfies
 *    the most keywords demanded by the current constraints (never going backwards).
 *    With no constraints it returns draft 0. It is constraint-driven, not a counter.
 *  - judge:     rule-based rubric scoring — keyword coverage per criterion + hard checks.
 *  - critic:    turns missing keywords / hard-check failures into constraints.
 *
 * It is NOT a model; it exists to exercise orchestration, logging and metrics.
 */
export class OfflineProvider implements LLMProvider {
  readonly name = "offline";
  private lastDraftIdx = new Map<string, number>();

  async text(req: LLMRequest): Promise<TextResult> {
    if (req.role !== "generator" || !req.meta) throw new Error("offline.text: generator with meta required");
    const { task, constraints = [], iteration } = req.meta;
    const drafts = fixture(task).drafts;
    if (iteration === 0) this.lastDraftIdx.set(task.id, 0);
    const floor = this.lastDraftIdx.get(task.id) ?? 0;
    const wanted = constraints.flatMap(quotedTerms);
    const wordLimits = constraints.flatMap((c) => [...c.text.matchAll(/(\d+) words/g)].map((m) => Number(m[1])));
    const hitsOf = (d: string) =>
      wanted.filter((w) => has(d, w)).length + wordLimits.filter((n) => wordCount(d) <= n).length;

    // A revision always produces a *new* draft while any remain (it may be worse — regressions are
    // realistic and exercise best-attempt tracking). Among new drafts, pick the one satisfying most constraints.
    const start = iteration === 0 ? 0 : Math.min(floor + 1, drafts.length - 1);
    let best = start;
    let bestHits = -1;
    for (let i = start; i < drafts.length; i++) {
      const hits = hitsOf(drafts[i]!);
      if (hits > bestHits) [best, bestHits] = [i, hits];
    }
    this.lastDraftIdx.set(task.id, best);
    const text = drafts[best]!;
    return { text, usage: fakeUsage(req.prompt, text) };
  }

  async json<T>(req: LLMRequest, schema: z.ZodType<T>, _toolName?: string): Promise<JsonResult<T>> {
    if (!req.meta) throw new Error("offline.json: meta required");
    const raw = req.role === "judge" ? this.judge(req.meta.task, req.meta.candidate ?? "") : this.critic(req);
    const data = schema.parse(raw);
    return { data, usage: fakeUsage(req.prompt, JSON.stringify(raw)) };
  }

  private judge(task: Task, candidate: string): Verdict {
    const kw = fixture(task).criterionKeywords;
    const reasoningFlaws: string[] = [];
    const scores = task.rubric.map((c) => {
      const terms = kw[c.id] ?? [];
      const missing = terms.filter((t) => !has(candidate, t));
      const coverage = terms.length ? (terms.length - missing.length) / terms.length : 1;
      let score = Math.round((2 + 8 * coverage) * 10) / 10;
      const notes = missing.length ? `missing: ${missing.map((m) => `"${m}"`).join(", ")}` : "all key points covered";
      if (missing.length) reasoningFlaws.push(`[${c.id}] does not address ${missing.map((m) => `"${m}"`).join(", ")}`);
      const max = task.hardChecks.maxWords;
      if (c.id === "concision" && max && wordCount(candidate) > max) {
        score = Math.min(score, 4);
        reasoningFlaws.push(`[concision] ${wordCount(candidate)} words exceeds limit of ${max}`);
      }
      return { id: c.id, score, rationale: notes };
    });
    return { scores, reasoningFlaws, summary: `offline judge: ${reasoningFlaws.length} issue(s)` };
  }

  private critic(req: LLMRequest): Critique {
    const { task, candidate = "" } = req.meta!;
    const kw = fixture(task).criterionKeywords;
    const constraints: Constraint[] = [];
    for (const c of task.rubric) {
      for (const t of kw[c.id] ?? []) {
        if (!has(candidate, t)) constraints.push({ kind: "must", text: `Explicitly cover "${t}"`, sourceCriterion: c.id });
      }
    }
    const max = task.hardChecks.maxWords;
    if (max && wordCount(candidate) > max) constraints.push({ kind: "format", text: `Stay under ${max} words` });
    if (!constraints.length) constraints.push({ kind: "reasoning", text: "Tighten wording; keep all covered points" });
    return {
      diagnosis: `${constraints.length} gap(s) between the answer and the rubric`,
      reasoningIssues: constraints.map((c) => c.text),
      constraints,
    };
  }
}

const fixture = (task: Task) => {
  if (!task.offline) throw new Error(`Task ${task.id} has no offline fixture; use --provider anthropic`);
  return task.offline;
};
const has = (text: string, term: string) => text.toLowerCase().includes(term.toLowerCase());
const quotedTerms = (c: Constraint) => [...c.text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const fakeUsage = (inp: string, out: string) => ({
  inputTokens: Math.ceil(inp.length / 4),
  outputTokens: Math.ceil(out.length / 4),
});
