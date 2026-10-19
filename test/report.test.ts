import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import { NullLogger, RunLogger, renderReport, type Logger } from "../src/metrics/logger.ts";
import { computeMetrics, summarise } from "../src/metrics/metrics.ts";
import type { Attempt, StopReason, TaskRun } from "../src/types.ts";

const attempt = (iteration: number, score: number, passed = false, output = `out-${iteration}`): Attempt => ({
  iteration,
  output,
  constraintsApplied: [],
  verdict: { scores: [{ id: "c", score, rationale: "" }], reasoningFlaws: [], summary: "", judgeScore: score, hardCheckFailures: [], score, passed },
  latencyMs: { generate: 0, judge: 0, critique: 0 },
  usage: { inputTokens: 10, outputTokens: 5 },
});
const run = (taskId: string, attempts: Attempt[], bestIteration: number, stopReason: StopReason): TaskRun => ({
  taskId,
  attempts,
  bestIteration,
  stopReason,
  metrics: computeMetrics(attempts, bestIteration, 0),
});

describe("renderReport", () => {
  const up = run("up", [attempt(0, 6), attempt(1, 8, true, "the best answer")], 1, "passed");
  const down = run("down", [attempt(0, 8.5), attempt(1, 7, true)], 1, "error");
  const flat = run("flat", [attempt(0, 5, false, "only answer")], 0, "max_iterations");

  it("renders n/a when tokens-per-point is null", () => {
    const md = renderReport([flat], summarise([flat]), {});
    assert.match(md, /\| Tokens per score point gained \| n\/a \|/);
  });

  it("renders the numeric tokens-per-point when there was a gain", () => {
    const md = renderReport([up], summarise([up]), {});
    assert.match(md, /\| Tokens per score point gained \| 15 \|/);
  });

  it("signs positive and negative per-task gains", () => {
    const md = renderReport([up, down], summarise([up, down]), {});
    assert.match(md, /\| up \| 6 → 8 \| #1 \(8\) \| \+2 \|/);
    assert.match(md, /\| down \| 8\.5 → 7 \| #1 \(7\) \| -1\.5 \|/);
    assert.match(md, /- \*\*up\*\*: c \+2/);
    assert.match(md, /- \*\*down\*\*: c -1\.5/);
  });

  it("includes stop reasons, pass marks and config", () => {
    const md = renderReport([up, down, flat], summarise([up, down, flat]), { provider: "offline" });
    assert.match(md, /\| Stop reasons \| passed: 1, error: 1, max_iterations: 1 \|/);
    assert.match(md, /\| up \|.*\| ✗ → ✓ \| passed \|/);
    assert.match(md, /\| flat \|.*\| ✗ → ✗ \| max_iterations \|/);
    assert.ok(md.includes('Config: `{"provider":"offline"}`'));
  });

  it("puts the best attempt output under Final answers", () => {
    const md = renderReport([up], summarise([up]), {});
    const final = md.slice(md.indexOf("## Final answers"));
    assert.ok(final.includes("### up\n\n```\nthe best answer\n```"));
    assert.ok(!final.includes("out-0"), "non-best attempts are not rendered");
  });
});

describe("RunLogger console trace", () => {
  const capture = (verbose: boolean, events: [Parameters<RunLogger["event"]>[0], Record<string, unknown>][]) => {
    const log = new RunLogger(mkdtempSync(join(tmpdir(), "sra-log-")), verbose, "r");
    const spy = mock.method(console, "log", () => {});
    try {
      for (const [t, d] of events) log.event(t, d);
    } finally {
      spy.mock.restore();
    }
    return { log, lines: spy.mock.calls.map((c) => String(c.arguments[0])) };
  };

  it("formats each event type", () => {
    const { lines } = capture(true, [
      ["generated", { taskId: "t", iteration: 0, chars: 42 }],
      ["judged", { taskId: "t", iteration: 1, score: 7.5, judgeScore: 9, hardCheckFailures: ["a", "b"], passed: false }],
      ["judged", { taskId: "t", iteration: 2, score: 10, judgeScore: 10, hardCheckFailures: [], passed: true }],
      ["critiqued", { taskId: "t", iteration: 1, diagnosis: "gap", newConstraints: 3 }],
      ["constraints_merged", { taskId: "t", iteration: 1, added: 2, total: 5 }],
      ["task_end", { taskId: "t", stopReason: "passed", bestIteration: 2, trajectory: [6, 10] }],
      ["run_start", { tasks: ["t"] }],
    ]);
    assert.deepEqual(lines, [
      "[t#0] generated 42 chars",
      "[t#1] judge → score 7.5 (judge 9, hard-fails: a; b) ",
      "[t#2] judge → score 10 (judge 10) PASS",
      "[t#1] critic → gap (+3 constraints)",
      "[t#1] ledger → +2 (total 5)",
      "[t#-] done: passed, best #2, trajectory 6 → 10\n",
      'run_start  {"tasks":["t"]}',
    ]);
  });

  it("stays silent when not verbose but still appends JSONL", () => {
    const { log, lines } = capture(false, [["generated", { taskId: "t", iteration: 0, chars: 1 }], ["error", { message: "boom" }]]);
    assert.deepEqual(lines, []);
    const events = readFileSync(join(log.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(events.map((e) => e.type), ["generated", "error"]);
    assert.equal(events[1].message, "boom");
    assert.ok(events.every((e) => typeof e.ts === "string"));
  });
});

describe("NullLogger", () => {
  it("is a no-op", () => {
    const spy = mock.method(console, "log", () => {});
    try {
      const log: Logger = new NullLogger();
      assert.equal(log.event("judged", { taskId: "t" }), undefined);
    } finally {
      spy.mock.restore();
    }
    assert.equal(spy.mock.callCount(), 0);
  });
});
