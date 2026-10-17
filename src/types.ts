import { z } from "zod";

/** One rubric criterion the judge scores 0–10. Weights are normalised at scoring time. */
export const CriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  weight: z.number().positive().default(1),
});
export type Criterion = z.infer<typeof CriterionSchema>;

/** Optional deterministic checks the offline judge (and the guard rails) can apply. */
export const HardChecksSchema = z
  .object({
    maxWords: z.number().int().positive().optional(),
    mustInclude: z.array(z.string()).optional(),
    mustNotInclude: z.array(z.string()).optional(),
    finalAnswer: z.string().optional(), // exact expected final answer, if the task has one
  })
  .default({});

export const TaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  rubric: z.array(CriterionSchema).min(1),
  reference: z.string().optional(), // gold answer / key facts, shown only to the judge
  hardChecks: HardChecksSchema,
  passThreshold: z.number().min(0).max(10).optional(),
  /** Fixtures for the offline provider only (demo/tests without an API key). */
  offline: z
    .object({
      drafts: z.array(z.string()).min(1),
      criterionKeywords: z.record(z.string(), z.array(z.string())),
    })
    .optional(),
});
export type Task = z.infer<typeof TaskSchema>;

// ---------- Judge output (LLM-as-judge contract) ----------

export const CriterionScoreSchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(10),
  rationale: z.string(),
});

export const VerdictSchema = z.object({
  scores: z.array(CriterionScoreSchema).min(1),
  reasoningFlaws: z.array(z.string()).default([]),
  summary: z.string(),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export interface ScoredVerdict extends Verdict {
  judgeScore: number; // weighted rubric score from the judge, 0–10
  hardCheckFailures: string[]; // deterministic checks run in code, not by the LLM
  score: number; // effective score = judgeScore minus hard-check penalties; drives best-selection
  passed: boolean;
}

// ---------- Critic output ----------

export const ConstraintSchema = z.object({
  kind: z.enum(["must", "must_not", "format", "reasoning"]),
  text: z.string(),
  sourceCriterion: z.string().optional(),
});
export type Constraint = z.infer<typeof ConstraintSchema>;

export const CritiqueSchema = z.object({
  diagnosis: z.string(), // why the attempt lost points — root cause, not symptoms
  reasoningIssues: z.array(z.string()).default([]),
  constraints: z.array(ConstraintSchema).min(1),
});
export type Critique = z.infer<typeof CritiqueSchema>;

// ---------- Run records ----------

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface Attempt {
  iteration: number;
  output: string;
  constraintsApplied: Constraint[];
  verdict: ScoredVerdict;
  critique?: Critique;
  latencyMs: { generate: number; judge: number; critique: number };
  usage: Usage;
}

export type StopReason = "passed" | "max_iterations" | "plateau" | "error";

export interface TaskRun {
  taskId: string;
  attempts: Attempt[];
  bestIteration: number;
  stopReason: StopReason;
  metrics: ImprovementMetrics;
}

export interface ImprovementMetrics {
  initialScore: number;
  finalScore: number; // score of the returned (best) attempt
  absoluteGain: number;
  relativeGainPct: number;
  /** Fraction of the gap to 10 that reflection closed: (best - initial) / (10 - initial). */
  gapClosedPct: number;
  iterations: number;
  iterationsToPass: number | null;
  passedInitially: boolean;
  passedFinally: boolean;
  regressions: number; // iterations whose score dropped vs. previous
  perCriterionGain: Record<string, number>;
  constraintsAccumulated: number;
  totalTokens: number;
  totalLatencyMs: number;
  scoreTrajectory: number[];
}
