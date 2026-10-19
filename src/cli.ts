import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { DEFAULT_CONFIG, SelfReflectiveAgent, type ReflectionConfig } from "./agent/loop.ts";
import { AnthropicProvider, DEFAULT_API_RETRIES, DEFAULT_TIMEOUT_MS } from "./llm/anthropic.ts";
import { OfflineProvider } from "./llm/offline.ts";
import type { LLMProvider } from "./llm/provider.ts";
import { RunLogger } from "./metrics/logger.ts";
import { summarise } from "./metrics/metrics.ts";
import { TaskSchema } from "./types.ts";
import { mapPool } from "./util/pool.ts";

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
    concurrency: { type: "string", default: process.env.CONCURRENCY ?? "1" },
    "api-retries": { type: "string", default: String(DEFAULT_API_RETRIES) },
    "api-timeout-ms": { type: "string", default: String(DEFAULT_TIMEOUT_MS) },
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
  --concurrency N                tasks run in parallel (default 1, or $CONCURRENCY)
  --api-retries N  --api-timeout-ms N  anthropic SDK retries on 429/5xx (default ${DEFAULT_API_RETRIES}), request timeout (default ${DEFAULT_TIMEOUT_MS})
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
const int = (flag: "concurrency" | "api-retries" | "api-timeout-ms", min: number): number => {
  const n = Number(a[flag]);
  return a[flag] !== "" && Number.isInteger(n) && n >= min ? n : fail(`--${flag} must be an integer >= ${min}, got "${a[flag]}"`);
};
const concurrency = int("concurrency", 1);
const apiRetries = int("api-retries", 0);
const apiTimeoutMs = int("api-timeout-ms", 1);
if (!["offline", "anthropic"].includes(a.provider!)) fail(`unknown --provider ${a.provider} (expected offline|anthropic)`);
const llm: LLMProvider =
  a.provider === "anthropic"
    ? new AnthropicProvider({
        models: { generator: a["gen-model"]!, judge: a["judge-model"]!, critic: a["judge-model"]! },
        apiRetries,
        timeoutMs: apiTimeoutMs,
      })
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
  concurrency,
  ...(llm.name === "anthropic" ? { genModel: a["gen-model"], judgeModel: a["judge-model"], apiRetries, apiTimeoutMs } : {}),
  ...cfg,
};
logger.event("run_start", { config, tasks: tasks.map((t) => t.id) });

// The agent keeps all per-task state inside run(), so one instance serves concurrent tasks; results keep suite order.
const agent = new SelfReflectiveAgent(llm, cfg, logger);
const runs = await mapPool(tasks, concurrency, (task) => agent.run(task));

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
