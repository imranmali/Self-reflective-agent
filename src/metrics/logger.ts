import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskRun } from "../types.ts";
import type { SuiteSummary } from "./metrics.ts";

export type EventType =
  | "run_start"
  | "generated"
  | "judged"
  | "critiqued"
  | "constraints_merged"
  | "task_end"
  | "run_end"
  | "error";

export interface Logger {
  event(type: EventType, data: Record<string, unknown>): void;
}

/** Append-only JSONL event log + optional human-readable console trace. */
export class RunLogger implements Logger {
  readonly dir: string;
  private file: string;

  constructor(baseDir: string, private verbose = true, runId = new Date().toISOString().replace(/[:.]/g, "-")) {
    this.dir = join(baseDir, runId);
    mkdirSync(this.dir, { recursive: true });
    this.file = join(this.dir, "events.jsonl");
  }

  event(type: EventType, data: Record<string, unknown>) {
    appendFileSync(this.file, JSON.stringify({ ts: new Date().toISOString(), type, ...data }) + "\n");
    if (this.verbose) console.log(fmt(type, data));
  }

  writeArtifacts(runs: TaskRun[], summary: SuiteSummary, config: Record<string, unknown>) {
    writeFileSync(join(this.dir, "runs.json"), JSON.stringify(runs, null, 2));
    writeFileSync(join(this.dir, "summary.json"), JSON.stringify({ config, summary }, null, 2));
    writeFileSync(join(this.dir, "report.md"), renderReport(runs, summary, config));
  }
}

export class NullLogger implements Logger {
  event() {}
}

function fmt(type: EventType, d: Record<string, unknown>): string {
  const t = d.taskId ? `[${d.taskId}#${d.iteration ?? "-"}]` : "";
  switch (type) {
    case "judged":
      return `${t} judge → score ${d.score} (judge ${d.judgeScore}${(d.hardCheckFailures as string[])?.length ? `, hard-fails: ${(d.hardCheckFailures as string[]).join("; ")}` : ""}) ${d.passed ? "PASS" : ""}`;
    case "critiqued":
      return `${t} critic → ${d.diagnosis} (+${d.newConstraints} constraints)`;
    case "task_end":
      return `${t} done: ${d.stopReason}, best #${d.bestIteration}, trajectory ${(d.trajectory as number[]).join(" → ")}\n`;
    case "constraints_merged":
      return `${t} ledger → +${d.added} (total ${d.total})`;
    case "generated":
      return `${t} generated ${d.chars} chars`;
    default:
      return `${type} ${t} ${JSON.stringify(d).slice(0, 160)}`;
  }
}

export function renderReport(runs: TaskRun[], s: SuiteSummary, config: Record<string, unknown>): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `# Self-Reflective Agent — Eval Report`,
    ``,
    `Config: \`${JSON.stringify(config)}\``,
    ``,
    `## Suite summary`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Tasks | ${s.tasks} |`,
    `| Pass rate (first draft → final) | ${pct(s.passRateInitial)} → ${pct(s.passRateFinal)} |`,
    `| Mean score (first draft → final) | ${s.meanInitialScore} → ${s.meanFinalScore} |`,
    `| Mean absolute gain | +${s.meanAbsoluteGain} |`,
    `| Mean gap-to-10 closed | ${s.meanGapClosedPct}% |`,
    `| Mean iterations | ${s.meanIterations} |`,
    `| Tasks improved / net-regressed | ${s.tasksImproved} / ${s.tasksRegressedNet} |`,
    `| Total tokens | ${s.totalTokens} |`,
    `| Tokens per score point gained | ${s.tokensPerPointGained ?? "n/a"} |`,
    `| Stop reasons | ${Object.entries(s.stopReasons).map(([k, v]) => `${k}: ${v}`).join(", ")} |`,
    ``,
    `## Per task`,
    ``,
    `| Task | Trajectory | Best | Gain | Gap closed | Passed | Stop | Constraints |`,
    `|---|---|---|---|---|---|---|---|`,
    ...runs.map(
      (r) =>
        `| ${r.taskId} | ${r.metrics.scoreTrajectory.join(" → ")} | #${r.bestIteration} (${r.metrics.finalScore}) | ${r.metrics.absoluteGain >= 0 ? "+" : ""}${r.metrics.absoluteGain} | ${r.metrics.gapClosedPct}% | ${r.metrics.passedInitially ? "✓" : "✗"} → ${r.metrics.passedFinally ? "✓" : "✗"} | ${r.stopReason} | ${r.metrics.constraintsAccumulated} |`,
    ),
    ``,
    `## Per-criterion gain (first draft → best)`,
    ``,
    ...runs.map(
      (r) => `- **${r.taskId}**: ${Object.entries(r.metrics.perCriterionGain).map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v}`).join(", ")}`,
    ),
    ``,
    `## Final answers`,
    ``,
    ...runs.flatMap((r) => {
      const best = r.attempts.find((a) => a.iteration === r.bestIteration)!;
      return [`### ${r.taskId}`, ``, "```", best.output, "```", ``];
    }),
  ];
  return lines.join("\n");
}
