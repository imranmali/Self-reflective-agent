import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { DEFAULT_CONFIG, SelfReflectiveAgent, type ReflectionConfig } from "./agent/loop.ts";
import { AnthropicProvider } from "./llm/anthropic.ts";
import { OfflineProvider } from "./llm/offline.ts";
import type { LLMProvider } from "./llm/provider.ts";
import { RunLogger } from "./metrics/logger.ts";
import { summarise } from "./metrics/metrics.ts";
import { TaskSchema, type TaskRun } from "./types.ts";

const { values: a } = parseArgs({
  options: {
    provider: { type: "string", default: process.env.ANTHROPIC_API_KEY ? "anthropic" : "offline" },
    tasks: { type: "string", default: "tasks/suite.json" },
    only: { type: "string" },
    "max-iters": { type: "string", default: String(DEFAULT_CONFIG.maxIterations) },
    threshold: { type: "string", default: String(DEFAULT_CONFIG.passThreshold) },
    patience: { type: "string", default: String(DEFAULT_CONFIG.patience) },
    "min-delta": { type: "string", default: String(DEFAULT_CONFIG.minDelta) },
    "judge-samples": { type: "string", default: String(DEFAULT_CONFIG.judgeSamples) },
    "gen-model": { type: "string", default: process.env.GEN_MODEL ?? "claude-sonnet-5-5" },
    "judge-model": { type: "string", default: process.env.JUDGE_MODEL ?? "claude-opus-5-5" },
    out: { type: "string", default: "runs" },
    quiet: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (a.help) {
  console.log(`Usage: npm start -- [options]
  --provider offline|anthropic   (default: anthropic if ANTHROPIC_API_KEY set, else offline)
  --tasks <file>                 task suite JSON (default tasks/suite.json)
  --only <id[,id]>               run a subset
  --max-iters N  --threshold X  --patience N  --min-delta X  --judge-samples N
  --gen-model M  --judge-model M (judge model is also used for the critic)
  --out <dir>    --quiet`);
  process.exit(0);
}

const cfg: ReflectionConfig = {
  ...DEFAULT_CONFIG,
  maxIterations: Number(a["max-iters"]),
  passThreshold: Number(a.threshold),
  patience: Number(a.patience),
  minDelta: Number(a["min-delta"]),
  judgeSamples: Number(a["judge-samples"]),
};

const fail = (msg: string): never => {
  console.error(`error: ${msg}`);
  process.exit(2);
};
if (!["offline", "anthropic"].includes(a.provider!)) fail(`unknown --provider ${a.provider} (expected offline|anthropic)`);
const llm: LLMProvider =
  a.provider === "anthropic"
    ? new AnthropicProvider({ models: { generator: a["gen-model"]!, judge: a["judge-model"]!, critic: a["judge-model"]! } })
    : new OfflineProvider();

const parsed = z.array(TaskSchema).safeParse(JSON.parse(readFileSync(a.tasks!, "utf8")));
if (!parsed.success) fail(`invalid task suite ${a.tasks}:\n${z.prettifyError(parsed.error!)}`);
let tasks = parsed.data!;
if (a.only) {
  const ids = a.only.split(",");
  const unknown = ids.filter((id) => !tasks.some((t) => t.id === id));
  if (unknown.length) fail(`unknown task id(s) in --only: ${unknown.join(", ")}`);
  tasks = tasks.filter((t) => ids.includes(t.id));
}

const logger = new RunLogger(a.out!, !a.quiet);
const config = {
  provider: llm.name,
  ...(llm.name === "anthropic" ? { genModel: a["gen-model"], judgeModel: a["judge-model"] } : {}),
  ...cfg,
};
logger.event("run_start", { config, tasks: tasks.map((t) => t.id) });

const agent = new SelfReflectiveAgent(llm, cfg, logger);
const runs: TaskRun[] = [];
for (const task of tasks) runs.push(await agent.run(task));

const summary = summarise(runs);
logger.event("run_end", { summary });
logger.writeArtifacts(runs, summary, config);

console.log(`\n== Summary (${llm.name}) ==`);
console.table(
  runs.map((r) => ({
    task: r.taskId,
    trajectory: r.metrics.scoreTrajectory.join(" → "),
    gain: r.metrics.absoluteGain,
    "gap closed %": r.metrics.gapClosedPct,
    passed: `${r.metrics.passedInitially ? "✓" : "✗"}→${r.metrics.passedFinally ? "✓" : "✗"}`,
    stop: r.stopReason,
  })),
);
console.log(
  `pass rate ${summary.passRateInitial * 100}% → ${summary.passRateFinal * 100}% | mean score ${summary.meanInitialScore} → ${summary.meanFinalScore} | tokens ${summary.totalTokens}`,
);
console.log(`artifacts: ${logger.dir}/{events.jsonl,runs.json,summary.json,report.md}`);
