import type { Constraint, Critique, Task, Verdict } from "../types.ts";

// ---------------- Generator ----------------

export const GENERATOR_SYSTEM = `You are a precise senior engineer answering a task.
Reason carefully before committing to claims. Prefer correct and specific over long.
Output only the answer itself — no preamble, no meta-commentary about revisions.`;

export function generatorPrompt(task: Task, ctx?: { bestOutput: string; critique: Critique; constraints: Constraint[] }) {
  let p = `<task id="${task.id}">\n${task.prompt}\n</task>`;
  if (!ctx) return p;
  p += `

<previous_best_attempt>
${ctx.bestOutput}
</previous_best_attempt>

<reviewer_diagnosis>
${ctx.critique.diagnosis}
${ctx.critique.reasoningIssues.map((r) => `- ${r}`).join("\n")}
</reviewer_diagnosis>

<constraints>
These are HARD requirements for your revision. Satisfy every one; if two conflict, the task statement wins.
${renderConstraints(ctx.constraints)}
</constraints>

Write a complete revised answer to the task (not a diff, not notes about what changed).
Keep what the previous attempt got right.`;
  return p;
}

export function renderConstraints(cs: Constraint[]) {
  const tag = { must: "MUST", must_not: "MUST NOT", format: "FORMAT", reasoning: "REASONING" } as const;
  return cs.map((c, i) => `${i + 1}. [${tag[c.kind]}] ${c.text}`).join("\n");
}

// ---------------- Judge ----------------

export const JUDGE_SYSTEM = `You are a strict, calibrated evaluator (LLM-as-judge).
Score a candidate answer against a rubric. Rules:
- Score each criterion 0–10 using these anchors: 0–2 wrong/missing, 3–5 partially correct or vague,
  6–8 correct with minor gaps, 9–10 correct, complete, and precise. 10 is rare.
- Ground every score in evidence: quote or point to the exact part of the answer in the rationale.
- Do NOT reward length, confident tone, or self-assessment inside the answer ("this is correct").
- If a reference is given, use it for correctness; the candidate may differ in wording.
- List reasoningFlaws: concrete logical errors, unsupported or false claims, calculation mistakes,
  skipped steps, contradictions. Empty list only if there are none.
- Judge the answer as given; you have no information about how it was produced.`;

export function judgePrompt(task: Task, candidate: string) {
  return `<task>
${task.prompt}
</task>
${task.reference ? `\n<reference_answer_or_key_facts>\n${task.reference}\n</reference_answer_or_key_facts>\n` : ""}
<rubric>
${task.rubric.map((c) => `- id="${c.id}" (weight ${c.weight}): ${c.description}`).join("\n")}
</rubric>

<candidate_answer>
${candidate}
</candidate_answer>

Return one score object per rubric id (use the exact ids), the reasoning flaws, and a one-sentence summary.`;
}

// ---------------- Critic ----------------

export const CRITIC_SYSTEM = `You are a reasoning critic. Given an answer and the judge's verdict, find the ROOT CAUSE of
lost points and turn it into constraints for the next attempt.
Constraints must be:
- specific and checkable ("State that X implies Y because Z", not "be more thorough");
- aimed at the lowest-scoring, highest-weight criteria first;
- consistent with the task (never ask to exceed a stated limit);
- at most 6, no duplicates of constraints already in force.
Use kind: must | must_not | format | reasoning ("reasoning" = a required inference step or check).`;

export function criticPrompt(task: Task, candidate: string, verdict: Verdict & { hardCheckFailures: string[] }, existing: Constraint[]) {
  const scores = verdict.scores.map((s) => `- ${s.id}: ${s.score}/10 — ${s.rationale}`).join("\n");
  return `<task>
${task.prompt}
</task>

<rubric>
${task.rubric.map((c) => `- ${c.id} (weight ${c.weight}): ${c.description}`).join("\n")}
</rubric>

<answer>
${candidate}
</answer>

<judge_verdict>
${scores}
Reasoning flaws:
${verdict.reasoningFlaws.map((f) => `- ${f}`).join("\n") || "- none"}
Deterministic check failures:
${verdict.hardCheckFailures.map((f) => `- ${f}`).join("\n") || "- none"}
</judge_verdict>

<constraints_already_in_force>
${existing.length ? renderConstraints(existing) : "none"}
</constraints_already_in_force>

Diagnose and emit NEW constraints only.`;
}
