import { addUsage, type LLMProvider } from "../llm/provider.ts";
import { computeMetrics } from "../metrics/metrics.ts";
import { NullLogger, type Logger } from "../metrics/logger.ts";
import type { Attempt, Constraint, StopReason, Task, TaskRun } from "../types.ts";
import { constraintsFromHardChecks, critique, mergeConstraints } from "./critic.ts";
import { execute } from "./executor.ts";
import { judge } from "./judge.ts";

export interface ReflectionConfig {
  maxIterations: number; // total attempts including the first draft
  passThreshold: number; // 0–10, per-task override via task.passThreshold
  patience: number; // stop after this many non-improving revisions in a row
  minDelta: number; // improvement smaller than this counts as "no improvement"
  judgeSamples: number;
  maxConstraints: number;
}

export const DEFAULT_CONFIG: ReflectionConfig = {
  maxIterations: 5,
  passThreshold: 8.5,
  patience: 2,
  minDelta: 0.25,
  judgeSamples: 1,
  maxConstraints: 12,
};

/**
 * Execute → Judge → Critique → Regenerate(with constraints) → … until pass / plateau / budget.
 *
 * Design choices:
 *  - Revisions build on the BEST attempt so far, not the latest, so a regression can't compound.
 *  - Constraints accumulate in a ledger; earlier fixes stay enforced.
 *  - The returned answer is the best-scoring attempt — reflection can never make the output worse
 *    (under the judge's measure).
 *  - Judge is blind to iteration number and prior scores (avoids "revised ⇒ better" anchoring).
 */
export class SelfReflectiveAgent {
  constructor(
    private llm: LLMProvider,
    private cfg: ReflectionConfig = DEFAULT_CONFIG,
    private log: Logger = new NullLogger(),
  ) {}

  async run(task: Task): Promise<TaskRun> {
    const threshold = task.passThreshold ?? this.cfg.passThreshold;
    const attempts: Attempt[] = [];
    let constraints: Constraint[] = [];
    let best: Attempt | undefined;
    let stale = 0;
    let stopReason: StopReason = "max_iterations";

    try {
      for (let it = 0; it < this.cfg.maxIterations; it++) {
        // 1. Execute (first draft, or constrained regeneration from the best attempt)
        let t = Date.now();
        const gen = await execute(
          this.llm,
          task,
          it,
          best?.critique ? { bestOutput: best.output, critique: best.critique, constraints } : undefined,
        );
        const genMs = Date.now() - t;
        this.log.event("generated", { taskId: task.id, iteration: it, chars: gen.output.length, constraints: constraints.length });

        // 2. Evaluate (LLM-as-judge + deterministic hard checks)
        t = Date.now();
        const j = await judge(this.llm, task, gen.output, it, { passThreshold: threshold, samples: this.cfg.judgeSamples });
        const judgeMs = Date.now() - t;
        const v = j.verdict;
        this.log.event("judged", {
          taskId: task.id,
          iteration: it,
          score: v.score,
          judgeScore: v.judgeScore,
          criteria: Object.fromEntries(v.scores.map((s) => [s.id, s.score])),
          reasoningFlaws: v.reasoningFlaws,
          hardCheckFailures: v.hardCheckFailures,
          passed: v.passed,
        });

        const attempt: Attempt = {
          iteration: it,
          output: gen.output,
          constraintsApplied: [...constraints],
          verdict: v,
          latencyMs: { generate: genMs, judge: judgeMs, critique: 0 },
          usage: addUsage(gen.usage, j.usage),
        };
        attempts.push(attempt);

        // track best + plateau
        if (!best || v.score > best.verdict.score + this.cfg.minDelta || (v.passed && !best.verdict.passed)) {
          best = attempt;
          stale = 0;
        } else {
          if (v.score > best.verdict.score) best = attempt; // tiny gain: keep it, but still counts as stale
          stale++;
        }

        if (v.passed) {
          best = attempt;
          stopReason = "passed";
          break;
        }
        if (it > 0 && stale >= this.cfg.patience) {
          stopReason = "plateau";
          break;
        }
        if (it === this.cfg.maxIterations - 1) break;

        // 3. Critique this attempt's reasoning → constraints. A failed revision is critiqued too:
        //    why it didn't improve is new information, even though we regenerate from `best`.
        t = Date.now();
        const c = await critique(this.llm, task, attempt.output, v, constraints, it);
        attempt.critique = c.critique;
        attempt.latencyMs.critique = Date.now() - t;
        attempt.usage = addUsage(attempt.usage, c.usage);
        this.log.event("critiqued", {
          taskId: task.id,
          iteration: it,
          diagnosis: c.critique.diagnosis,
          reasoningIssues: c.critique.reasoningIssues,
          newConstraints: c.critique.constraints.length,
        });

        // 4. Merge into the constraint ledger (critic output + deterministic check failures)
        const before = constraints.length;
        constraints = mergeConstraints(
          constraints,
          [...constraintsFromHardChecks(task, v.hardCheckFailures), ...c.critique.constraints],
          this.cfg.maxConstraints,
        );
        this.log.event("constraints_merged", {
          taskId: task.id,
          iteration: it,
          added: constraints.length - before,
          total: constraints.length,
          constraints,
        });
      }
    } catch (err) {
      stopReason = "error";
      this.log.event("error", { taskId: task.id, message: (err as Error).message });
      if (!best) throw err;
    }

    const metrics = computeMetrics(attempts, best!.iteration, constraints.length);
    this.log.event("task_end", {
      taskId: task.id,
      stopReason,
      bestIteration: best!.iteration,
      trajectory: metrics.scoreTrajectory,
      metrics,
    });
    return { taskId: task.id, attempts, bestIteration: best!.iteration, stopReason, metrics };
  }
}
