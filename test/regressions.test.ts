import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { mergeConstraints } from "../src/agent/critic.ts";
import { runHardChecks } from "../src/agent/judge.ts";
import { extractJson } from "../src/llm/provider.ts";
import { renderReport } from "../src/metrics/logger.ts";
import { computeMetrics, summarise } from "../src/metrics/metrics.ts";
import type { Attempt, Task } from "../src/types.ts";
import { suite, task } from "./helpers.ts";

const t: Task = { ...task("capacity-math"), hardChecks: { finalAnswer: "5" } };

describe("final answer tolerates Markdown", () => {
  for (const s of ["**Final answer:** 5", "Final answer: **5**", "Final answer: `5`", "__Final answer__: _5_.", "**Final answer**: 5"]) {
    it(`accepts ${s}`, () => assert.deepEqual(runHardChecks(t, s), []));
  }
  it("still rejects a wrong answer wrapped in Markdown", () =>
    assert.deepEqual(runHardChecks(t, "**Final answer:** **4**"), ['final answer "4" != expected']));
});

describe("mergeConstraints", () => {
  const c = (text: string) => ({ kind: "must" as const, text });
  it("cap 0 keeps nothing", () => assert.deepEqual(mergeConstraints([c("a")], [c("b")], 0), []));
  it("does not merge constraints that differ only in non-ASCII text", () =>
    assert.equal(mergeConstraints([c("Erwähne Größe")], [c("Erwähne Länge")]).length, 2));
});

describe("extractJson", () => {
  it("skips brace groups in prose that are not JSON", () => assert.deepEqual(extractJson('use {x} then {"a":1}'), { a: 1 }));
  it("throws when no brace group is valid JSON", () => assert.throws(() => extractJson("{x} and {y}"), SyntaxError));
});

describe("renderReport mean gain sign", () => {
  const a = (iteration: number, score: number): Attempt => ({
    iteration,
    output: "",
    constraintsApplied: [],
    verdict: { scores: [{ id: "c", score, rationale: "" }], reasoningFlaws: [], summary: "", judgeScore: score, hardCheckFailures: [], score, passed: false },
    latencyMs: { generate: 0, judge: 0, critique: 0 },
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  it("does not print +- for a negative mean gain", () => {
    const attempts = [a(0, 8), a(1, 6.5)];
    const run = { taskId: "x", attempts, bestIteration: 1, stopReason: "error" as const, metrics: computeMetrics(attempts, 1, 0) };
    const md = renderReport([run], summarise([run]), {});
    assert.match(md, /\| Mean absolute gain \| -1\.5 \|/);
  });
});

describe("cli rejects duplicate task ids", () => {
  it("fails before running anything", () => {
    const dir = mkdtempSync(join(tmpdir(), "sra-dup-"));
    const f = join(dir, "dup.json");
    writeFileSync(f, JSON.stringify([suite[0], suite[0]]));
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--tasks", f, "--out", dir, "--quiet"], { env, encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, new RegExp(`duplicate task id\\(s\\) in .*: ${suite[0]!.id}`));
  });
});
