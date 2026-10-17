import { addUsage, ZERO_USAGE, type LLMProvider } from "../llm/provider.ts";
import { wordCount } from "../llm/offline.ts";
import { VerdictSchema, type ScoredVerdict, type Task, type Usage, type Verdict } from "../types.ts";
import { JUDGE_SYSTEM, judgePrompt } from "./prompts.ts";

export const HARD_CHECK_PENALTY = 1.5;

export interface JudgeOptions {
  passThreshold: number;
  /** >1 samples the judge several times and averages — cuts variance from a single noisy verdict. */
  samples?: number;
}

export async function judge(
  llm: LLMProvider,
  task: Task,
  candidate: string,
  iteration: number,
  opts: JudgeOptions,
): Promise<{ verdict: ScoredVerdict; usage: Usage }> {
  const n = Math.max(1, opts.samples ?? 1);
  let usage = ZERO_USAGE;
  const verdicts: Verdict[] = [];
  for (let i = 0; i < n; i++) {
    const r = await llm.json(
      {
        role: "judge",
        system: JUDGE_SYSTEM,
        prompt: judgePrompt(task, candidate),
        temperature: n > 1 ? 0.3 : 0,
        meta: { task, iteration, candidate },
      },
      VerdictSchema,
      "submit_verdict",
    );
    usage = addUsage(usage, r.usage);
    verdicts.push(normalise(task, r.data));
  }
  return { verdict: score(task, aggregate(verdicts), candidate, opts.passThreshold), usage };
}

/** Keep only rubric ids, fill missing ones with 0 so a judge can't skip a criterion to dodge it. */
function normalise(task: Task, v: Verdict): Verdict {
  const byId = new Map(v.scores.map((s) => [s.id, s]));
  return {
    ...v,
    scores: task.rubric.map(
      (c) => byId.get(c.id) ?? { id: c.id, score: 0, rationale: "judge omitted this criterion" },
    ),
  };
}

export function aggregate(vs: Verdict[]): Verdict {
  if (vs.length === 1) return vs[0]!;
  const first = vs[0]!;
  return {
    scores: first.scores.map((s, i) => ({
      id: s.id,
      score: round1(vs.reduce((a, v) => a + v.scores[i]!.score, 0) / vs.length),
      rationale: vs.map((v) => v.scores[i]!.rationale).join(" | "),
    })),
    reasoningFlaws: [...new Set(vs.flatMap((v) => v.reasoningFlaws))],
    summary: first.summary,
  };
}

export function score(task: Task, v: Verdict, candidate: string, passThreshold: number): ScoredVerdict {
  const totalW = task.rubric.reduce((a, c) => a + c.weight, 0);
  const judgeScore = round2(
    task.rubric.reduce((a, c) => a + c.weight * (v.scores.find((s) => s.id === c.id)?.score ?? 0), 0) / totalW,
  );
  const hardCheckFailures = runHardChecks(task, candidate);
  const s = round2(Math.max(0, judgeScore - HARD_CHECK_PENALTY * hardCheckFailures.length));
  return { ...v, judgeScore, hardCheckFailures, score: s, passed: s >= passThreshold && hardCheckFailures.length === 0 };
}

/** Deterministic checks — never delegate to the LLM what code can verify. */
export function runHardChecks(task: Task, candidate: string): string[] {
  const hc = task.hardChecks;
  const fails: string[] = [];
  const lower = candidate.toLowerCase();
  if (hc.maxWords && wordCount(candidate) > hc.maxWords) fails.push(`word count ${wordCount(candidate)} > ${hc.maxWords}`);
  for (const t of hc.mustInclude ?? []) if (!lower.includes(t.toLowerCase())) fails.push(`missing required term "${t}"`);
  for (const t of hc.mustNotInclude ?? []) if (lower.includes(t.toLowerCase())) fails.push(`contains forbidden term "${t}"`);
  if (hc.finalAnswer) {
    const m = candidate.match(/final answer\s*[:：]\s*(.+)/i);
    const got = m?.[1]?.trim().replace(/[.\s*`]+$/, "");
    if (!got) fails.push(`no "Final answer:" line`);
    else if (got.toLowerCase() !== hc.finalAnswer.toLowerCase()) fails.push(`final answer "${got}" != expected`);
  }
  return fails;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
