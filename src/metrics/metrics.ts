import type { Attempt, ImprovementMetrics, TaskRun } from "../types.ts";

const r2 = (x: number) => Math.round(x * 100) / 100;

export function computeMetrics(attempts: Attempt[], bestIteration: number, constraintsAccumulated: number): ImprovementMetrics {
  if (!attempts.length) throw new Error("computeMetrics: no attempts");
  const first = attempts[0]!;
  const best = attempts.find((a) => a.iteration === bestIteration)!;
  const traj = attempts.map((a) => a.verdict.score);
  const initial = first.verdict.score;
  const final = best.verdict.score;

  const perCriterionGain: Record<string, number> = {};
  for (const s of first.verdict.scores) {
    const b = best.verdict.scores.find((x) => x.id === s.id)?.score ?? s.score;
    perCriterionGain[s.id] = r2(b - s.score);
  }

  const passIdx = attempts.findIndex((a) => a.verdict.passed);
  return {
    initialScore: initial,
    finalScore: final,
    absoluteGain: r2(final - initial),
    relativeGainPct: initial > 0 ? r2(((final - initial) / initial) * 100) : 0,
    gapClosedPct: initial < 10 ? r2(((final - initial) / (10 - initial)) * 100) : 0,
    iterations: attempts.length,
    iterationsToPass: passIdx >= 0 ? passIdx : null, // 0 = passed on first draft
    passedInitially: first.verdict.passed,
    passedFinally: best.verdict.passed,
    regressions: traj.slice(1).filter((s, i) => s < traj[i]!).length,
    perCriterionGain,
    constraintsAccumulated,
    totalTokens: attempts.reduce((a, x) => a + x.usage.inputTokens + x.usage.outputTokens, 0),
    totalLatencyMs: attempts.reduce((a, x) => a + x.latencyMs.generate + x.latencyMs.judge + x.latencyMs.critique, 0),
    scoreTrajectory: traj,
  };
}

export interface SuiteSummary {
  tasks: number;
  passRateInitial: number;
  passRateFinal: number;
  meanInitialScore: number;
  meanFinalScore: number;
  meanAbsoluteGain: number;
  meanGapClosedPct: number;
  meanIterations: number;
  tasksImproved: number;
  tasksRegressedNet: number; // best < initial — should always be 0 because we return the best attempt
  totalTokens: number;
  tokensPerPointGained: number | null;
  stopReasons: Record<string, number>;
}

export function summarise(runs: TaskRun[]): SuiteSummary {
  const n = runs.length || 1;
  const mean = (f: (r: TaskRun) => number) => r2(runs.reduce((a, r) => a + f(r), 0) / n);
  const totalGain = runs.reduce((a, r) => a + r.metrics.absoluteGain, 0);
  const totalTokens = runs.reduce((a, r) => a + r.metrics.totalTokens, 0);
  const stopReasons: Record<string, number> = {};
  for (const r of runs) stopReasons[r.stopReason] = (stopReasons[r.stopReason] ?? 0) + 1;
  return {
    tasks: runs.length,
    passRateInitial: mean((r) => (r.metrics.passedInitially ? 1 : 0)),
    passRateFinal: mean((r) => (r.metrics.passedFinally ? 1 : 0)),
    meanInitialScore: mean((r) => r.metrics.initialScore),
    meanFinalScore: mean((r) => r.metrics.finalScore),
    meanAbsoluteGain: mean((r) => r.metrics.absoluteGain),
    meanGapClosedPct: mean((r) => r.metrics.gapClosedPct),
    meanIterations: mean((r) => r.metrics.iterations),
    tasksImproved: runs.filter((r) => r.metrics.absoluteGain > 0).length,
    tasksRegressedNet: runs.filter((r) => r.metrics.absoluteGain < 0).length,
    totalTokens,
    tokensPerPointGained: totalGain > 0 ? Math.round(totalTokens / totalGain) : null,
    stopReasons,
  };
}
