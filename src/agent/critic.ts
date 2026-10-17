import type { LLMProvider } from "../llm/provider.ts";
import { CritiqueSchema, type Constraint, type Critique, type ScoredVerdict, type Task, type Usage } from "../types.ts";
import { CRITIC_SYSTEM, criticPrompt } from "./prompts.ts";

export async function critique(
  llm: LLMProvider,
  task: Task,
  candidate: string,
  verdict: ScoredVerdict,
  existing: Constraint[],
  iteration: number,
): Promise<{ critique: Critique; usage: Usage }> {
  const r = await llm.json(
    {
      role: "critic",
      system: CRITIC_SYSTEM,
      prompt: criticPrompt(task, candidate, verdict, existing),
      temperature: 0.2,
      meta: { task, iteration, candidate, verdict, constraints: existing },
    },
    CritiqueSchema,
    "submit_critique",
  );
  return { critique: r.data, usage: r.usage };
}

/**
 * Hard-check failures become constraints directly — no need to ask the model to rediscover them.
 * Texts are stable across iterations (so the ledger dedupes them) and never leak the expected answer.
 */
export function constraintsFromHardChecks(task: Task, fails: string[]): Constraint[] {
  return fails.map((f): Constraint => {
    if (f.startsWith("word count")) return { kind: "format", text: `Stay at or under ${task.hardChecks.maxWords} words` };
    const term = f.match(/"([^"]+)"/)?.[1];
    if (f.startsWith("missing required term")) return { kind: "must", text: `Include the term "${term}"` };
    if (f.startsWith("contains forbidden term")) return { kind: "must_not", text: `Do not use the term "${term}"` };
    if (f.startsWith("final answer")) return { kind: "reasoning", text: "Re-derive the result step by step and verify it before stating it" };
    return { kind: "format", text: 'End with a single line of the form "Final answer: <answer>"' };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9"]+/g, " ").trim();

/**
 * Accumulating constraint ledger: constraints persist across iterations so a later
 * revision can't silently reintroduce an earlier flaw. Dedupe by normalised text;
 * when over capacity keep the newest (most relevant to the current best attempt).
 */
export function mergeConstraints(existing: Constraint[], incoming: Constraint[], cap = 12): Constraint[] {
  const seen = new Set(existing.map((c) => norm(c.text)));
  const merged = [...existing];
  for (const c of incoming) {
    const k = norm(c.text);
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(c);
    }
  }
  return merged.slice(-cap);
}
