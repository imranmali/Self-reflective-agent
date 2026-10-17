import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, SelfReflectiveAgent } from "../src/agent/loop.ts";
import { OfflineProvider } from "../src/llm/offline.ts";
import { RunLogger } from "../src/metrics/logger.ts";
import { computeMetrics, summarise } from "../src/metrics/metrics.ts";
import type { Attempt, TaskRun } from "../src/types.ts";
import { suite } from "./helpers.ts";

const attempt = (iteration: number, score: number, passed = false): Attempt => ({
  iteration,
  output: "",
  constraintsApplied: [],
  verdict: { scores: [{ id: "c", score, rationale: "" }], reasoningFlaws: [], summary: "", judgeScore: score, hardCheckFailures: [], score, passed },
  latencyMs: { generate: 1, judge: 2, critique: 3 },
  usage: { inputTokens: 10, outputTokens: 5 },
});

describe("per-task metrics", () => {
  it("computes gap closed, gains and pass iteration", () => {
    const m = computeMetrics([attempt(0, 6), attempt(1, 8, true)], 1, 3);
    assert.equal(m.gapClosedPct, 50);
    assert.equal(m.absoluteGain, 2);
    assert.equal(m.relativeGainPct, 33.33);
    assert.equal(m.iterationsToPass, 1);
    assert.deepEqual(m.perCriterionGain, { c: 2 });
    assert.equal(m.totalTokens, 30);
    assert.equal(m.totalLatencyMs, 12);
    assert.equal(m.constraintsAccumulated, 3);
  });
  it("counts regressions", () => {
    assert.equal(computeMetrics([attempt(0, 6.65), attempt(1, 5.35), attempt(2, 10, true)], 2, 0).regressions, 1);
  });
  it("reports no pass as null", () => assert.equal(computeMetrics([attempt(0, 3)], 0, 0).iterationsToPass, null));
});

describe("suite summary", () => {
  it("has zero net regressions and improved pass rate on the offline suite", async () => {
    const agent = new SelfReflectiveAgent(new OfflineProvider());
    const runs: TaskRun[] = [];
    for (const t of suite) runs.push(await agent.run(t));
    const s = summarise(runs);
    assert.equal(s.tasks, 4);
    assert.equal(s.tasksRegressedNet, 0);
    assert.equal(s.passRateInitial, 0);
    assert.equal(s.passRateFinal, 0.75);
    assert.deepEqual(s.stopReasons, { passed: 3, plateau: 1 });
    assert.ok(s.tokensPerPointGained! > 0);
  });
  it("reports tokens-per-point as null when nothing was gained", () => {
    const m = computeMetrics([attempt(0, 5)], 0, 0);
    assert.equal(summarise([{ taskId: "x", attempts: [], bestIteration: 0, stopReason: "max_iterations", metrics: m }]).tokensPerPointGained, null);
  });
});

describe("RunLogger", () => {
  it("writes events and the four run artifacts with specified judged fields", async () => {
    const base = mkdtempSync(join(tmpdir(), "sra-"));
    const log = new RunLogger(base, false, "r1");
    const agent = new SelfReflectiveAgent(new OfflineProvider(), DEFAULT_CONFIG, log);
    const runs = [await agent.run(suite[2]!)];
    log.writeArtifacts(runs, summarise(runs), { provider: "offline" });

    assert.deepEqual(readdirSync(log.dir).sort(), ["events.jsonl", "report.md", "runs.json", "summary.json"]);
    const events = readFileSync(join(log.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const judged = events.find((e) => e.type === "judged");
    for (const k of ["ts", "taskId", "iteration", "score", "judgeScore", "criteria", "reasoningFlaws", "hardCheckFailures", "passed"]) {
      assert.ok(k in judged, `judged event missing ${k}`);
    }
    assert.deepEqual([...new Set(events.map((e) => e.type))], ["generated", "judged", "critiqued", "constraints_merged", "task_end"]);
    assert.match(readFileSync(join(log.dir, "report.md"), "utf8"), /capacity-math \| 2\.62 → 10/);
    assert.ok(existsSync(join(log.dir, "summary.json")));
  });
});
