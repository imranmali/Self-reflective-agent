import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { constraintsFromHardChecks, mergeConstraints } from "../src/agent/critic.ts";
import { runHardChecks, score } from "../src/agent/judge.ts";
import { DEFAULT_CONFIG, SelfReflectiveAgent } from "../src/agent/loop.ts";
import { OfflineProvider } from "../src/llm/offline.ts";
import { extractJson } from "../src/llm/provider.ts";
import { computeMetrics, summarise } from "../src/metrics/metrics.ts";
import type { Attempt, Constraint, Task } from "../src/types.ts";
import { task } from "./helpers.ts";

const c = (text: string, kind: Constraint["kind"] = "must"): Constraint => ({ kind, text });
const texts = (cs: Constraint[]) => cs.map((x) => x.text);

describe("mergeConstraints edge cases", () => {
  it("dedupes across case, punctuation and whitespace but keeps quotes significant", () => {
    const merged = mergeConstraints([c('Cover "X-Y".')], [c('  cover "x y"  '), c("Cover X-Y"), c("COVER   x...y!")]);
    assert.deepEqual(texts(merged), ['Cover "X-Y".', "Cover X-Y"]);
  });
  it("dedupes within the incoming batch and regardless of kind", () => {
    assert.deepEqual(texts(mergeConstraints([], [c("A"), c("a", "format"), c("B")])), ["A", "B"]);
  });
  it("keeps only the newest with cap 1", () => {
    assert.deepEqual(texts(mergeConstraints([c("A")], [c("B"), c("C")], 1)), ["C"]);
    assert.deepEqual(texts(mergeConstraints([c("A")], [c("a")], 1)), ["A"], "a duplicate does not evict");
  });
  it("does not mutate its inputs", () => {
    const existing = [c("A")];
    mergeConstraints(existing, [c("B")]);
    assert.equal(existing.length, 1);
  });
});

describe("constraintsFromHardChecks edge cases", () => {
  const t = task("capacity-math");
  it('maps a missing "Final answer:" line to the format constraint', () => {
    assert.deepEqual(constraintsFromHardChecks(t, ['no "Final answer:" line']), [
      { kind: "format", text: 'End with a single line of the form "Final answer: <answer>"' },
    ]);
  });
  it("maps a wrong final answer to a reasoning constraint and word count to the task limit", () => {
    const cs = constraintsFromHardChecks({ ...t, hardChecks: { maxWords: 80 } }, ['final answer "4" != expected', "word count 99 > 80"]);
    assert.deepEqual(cs.map((x) => x.kind), ["reasoning", "format"]);
    assert.equal(cs[1]!.text, "Stay at or under 80 words");
  });
  it("returns nothing for no failures", () => assert.deepEqual(constraintsFromHardChecks(t, []), []));
});

describe("extractJson edge cases", () => {
  it("parses deeply nested objects and arrays", () => {
    assert.deepEqual(extractJson('x {"a": {"b": [{"c": {"d": 2}}]}} y'), { a: { b: [{ c: { d: 2 } }] } });
  });
  it("handles escaped quotes and braces inside strings", () => {
    assert.deepEqual(extractJson('{"a": "say \\"}\\" ok", "b": 1}'), { a: 'say "}" ok', b: 1 });
  });
  it("treats an escaped backslash before a quote as closing the string", () => {
    assert.deepEqual(extractJson('{"a": "x\\\\"} trailing }'), { a: "x\\" });
  });
  it("returns only the first of several objects", () => assert.deepEqual(extractJson('{"a": 1} {"b": 2}'), { a: 1 }));
  it("throws on an unterminated string or missing close", () => {
    assert.throws(() => extractJson('{"a": "}'), /Unbalanced/);
    assert.throws(() => extractJson('{"a": {"b": 1}'), /Unbalanced/);
  });
});

const attempt = (iteration: number, scores: Record<string, number>, total: number, passed = false): Attempt => ({
  iteration,
  output: "",
  constraintsApplied: [],
  verdict: {
    scores: Object.entries(scores).map(([id, s]) => ({ id, score: s, rationale: "" })),
    reasoningFlaws: [],
    summary: "",
    judgeScore: total,
    hardCheckFailures: [],
    score: total,
    passed,
  },
  latencyMs: { generate: 0, judge: 0, critique: 0 },
  usage: { inputTokens: 0, outputTokens: 0 },
});

describe("metrics edge cases", () => {
  it("computeMetrics throws on empty attempts", () => assert.throws(() => computeMetrics([], 0, 0), /no attempts/));
  it("reports 0% gap closed when the first draft already scored 10", () => {
    const m = computeMetrics([attempt(0, { a: 10 }, 10, true)], 0, 0);
    assert.equal(m.gapClosedPct, 0);
    assert.equal(m.iterationsToPass, 0);
    assert.equal(m.passedInitially, true);
  });
  it("reports 0% relative gain when the first draft scored 0", () => {
    assert.equal(computeMetrics([attempt(0, { a: 0 }, 0), attempt(1, { a: 5 }, 5)], 1, 0).relativeGainPct, 0);
  });
  it("counts only strict drops as regressions and gives 0 gain for criteria the best attempt lacks", () => {
    const m = computeMetrics([attempt(0, { a: 5, b: 3 }, 5), attempt(1, { a: 5 }, 5), attempt(2, { a: 4 }, 4)], 1, 0);
    assert.equal(m.regressions, 1);
    assert.deepEqual(m.perCriterionGain, { a: 0, b: 0 });
  });
  it("summarise handles an empty run list", () => {
    assert.deepEqual(summarise([]), {
      tasks: 0,
      passRateInitial: 0,
      passRateFinal: 0,
      meanInitialScore: 0,
      meanFinalScore: 0,
      meanAbsoluteGain: 0,
      meanGapClosedPct: 0,
      meanIterations: 0,
      tasksImproved: 0,
      tasksRegressedNet: 0,
      totalTokens: 0,
      tokensPerPointGained: null,
      stopReasons: {},
    });
  });
});

describe("score / hard-check edge cases", () => {
  const one: Task = { ...task("postgres-indexing"), rubric: [{ id: "x", description: "d", weight: 3 }], hardChecks: {} };
  const t = task("capacity-math");
  it("a single weighted criterion scores as itself", () => {
    const v = score(one, { scores: [{ id: "x", score: 7.25, rationale: "" }], reasoningFlaws: [], summary: "" }, "", 7.25);
    assert.equal(v.judgeScore, 7.25);
    assert.equal(v.passed, true);
  });
  it("score() treats a criterion absent from the verdict as 0", () => {
    const v = score(t, { scores: [{ id: "correctness", score: 10, rationale: "" }], reasoningFlaws: [], summary: "" }, "Final answer: 5", 1);
    assert.equal(v.judgeScore, 6);
  });
  it("accepts a full-width colon", () => assert.deepEqual(runHardChecks(t, "Final answer：5"), []));
  it("trims trailing backticks, asterisks, periods and spaces", () => assert.deepEqual(runHardChecks(t, "Final answer: 5`**. "), []));
  it("reads only the rest of the line and the first Final answer", () => {
    assert.deepEqual(runHardChecks(t, "Final answer : 5\nFinal answer: 4"), []);
    assert.deepEqual(runHardChecks(t, "Final answer: 4\nFinal answer: 5"), ['final answer "4" != expected']);
  });
  it("treats an empty final answer as missing", () => assert.deepEqual(runHardChecks(t, "Final answer: ..."), ['no "Final answer:" line']));
  it("compares the expected answer case-insensitively", () => {
    assert.deepEqual(runHardChecks({ ...t, hardChecks: { finalAnswer: "Five" } }, "final ANSWER: five"), []);
  });
  it("allows exactly maxWords", () => {
    const tt: Task = { ...t, hardChecks: { maxWords: 3 } };
    assert.deepEqual(runHardChecks(tt, "one two three"), []);
    assert.deepEqual(runHardChecks(tt, "one two three four"), ["word count 4 > 3"]);
  });
});

describe("loop configuration edge cases", () => {
  const run = (id: string, cfg: Partial<typeof DEFAULT_CONFIG>, t: Task = task(id)) =>
    new SelfReflectiveAgent(new OfflineProvider(), { ...DEFAULT_CONFIG, ...cfg }).run(t);

  it("patience 1 stops on plateau one attempt earlier", async () => {
    const r = await run("postgres-indexing", { patience: 1 });
    assert.equal(r.stopReason, "plateau");
    assert.deepEqual(r.metrics.scoreTrajectory, [6, 7, 7]);
    assert.equal(r.bestIteration, 1);
  });

  it("a large minDelta counts every revision as stale but still keeps tiny gains as best", async () => {
    const r = await run("postgres-indexing", { minDelta: 100, patience: 1 });
    assert.equal(r.stopReason, "plateau");
    assert.deepEqual(r.metrics.scoreTrajectory, [6, 7]);
    assert.equal(r.bestIteration, 1);
  });

  it("a passing attempt stops the loop regardless of minDelta", async () => {
    const r = await run("idempotency-keys", { minDelta: 100 });
    assert.equal(r.stopReason, "passed");
    assert.equal(r.bestIteration, 2);
  });

  it("task.passThreshold overrides the config threshold", async () => {
    const r = await run("postgres-indexing", { passThreshold: 9.9 }, { ...task("postgres-indexing"), passThreshold: 5 });
    assert.equal(r.stopReason, "passed");
    assert.equal(r.attempts.length, 1);
    assert.equal(r.attempts[0]!.critique, undefined);
  });

  it("maxConstraints caps the ledger carried into every revision", async () => {
    const r = await run("kafka-poison-retry", { maxConstraints: 1 });
    assert.ok(r.attempts.every((a) => a.constraintsApplied.length <= 1));
    assert.equal(r.metrics.constraintsAccumulated, 1);
  });
});
