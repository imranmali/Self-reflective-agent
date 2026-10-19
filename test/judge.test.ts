import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregate, judge, runHardChecks, score } from "../src/agent/judge.ts";
import { judgePrompt } from "../src/agent/prompts.ts";
import type { LLMProvider } from "../src/llm/provider.ts";
import type { Task, Verdict } from "../src/types.ts";
import { task } from "./helpers.ts";

const t = task("capacity-math");
const v: Verdict = {
  scores: [
    { id: "correctness", score: 10, rationale: "" },
    { id: "reasoning", score: 5, rationale: "" },
  ],
  reasoningFlaws: [],
  summary: "",
};

describe("weighted score and pass gating", () => {
  it("weights criteria", () => assert.equal(score(t, v, "Final answer: 5", 8).judgeScore, 8));

  it("passes when threshold met and no hard-check failures", () => assert.equal(score(t, v, "Final answer: 5", 8).passed, true));

  it("penalises each hard-check failure by 1.5 and blocks pass", () => {
    const high: Verdict = { ...v, scores: v.scores.map((s) => ({ ...s, score: 9 })) };
    const s = score(t, high, "Final answer: 4", 7);
    assert.equal(s.judgeScore, 9);
    assert.equal(s.score, 7.5);
    assert.equal(s.passed, false);
  });

  it("floors the effective score at 0", () => {
    const zero: Verdict = { ...v, scores: v.scores.map((s) => ({ ...s, score: 0 })) };
    assert.equal(score(t, zero, "no answer", 1).score, 0);
  });
});

describe("hard checks", () => {
  const tt: Task = { ...t, hardChecks: { maxWords: 4, mustInclude: ["foo"], mustNotInclude: ["bar"], finalAnswer: "5" } };
  it("reports every failure type", () => {
    assert.deepEqual(runHardChecks(tt, "one two three four bar"), [
      "word count 5 > 4",
      'missing required term "foo"',
      'contains forbidden term "bar"',
      'no "Final answer:" line',
    ]);
  });
  it("accepts a compliant answer (case-insensitive, trailing punctuation)", () => assert.deepEqual(runHardChecks(tt, "FOO. final answer: 5."), []));
  it("flags a wrong final answer", () => assert.deepEqual(runHardChecks(tt, "foo Final answer: 4"), ['final answer "4" != expected']));
});

describe("judge call", () => {
  const fake = (scores: { id: string; score: number }[]): LLMProvider => ({
    name: "fake",
    text: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    json: async <T,>() => ({
      data: { scores: scores.map((s) => ({ ...s, rationale: "r" })), reasoningFlaws: ["f"], summary: "s" } as T,
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  });

  it("scores omitted criteria 0 and ignores unknown ids", async () => {
    const { verdict } = await judge(fake([{ id: "correctness", score: 10 }, { id: "bogus", score: 10 }]), t, "Final answer: 5", 0, { passThreshold: 8 });
    assert.deepEqual(verdict.scores.map((s) => [s.id, s.score]), [["correctness", 10], ["reasoning", 0]]);
    assert.match(verdict.scores[1]!.rationale, /omitted/);
  });

  it("samples N times and sums usage", async () => {
    const { usage } = await judge(fake([{ id: "correctness", score: 10 }, { id: "reasoning", score: 10 }]), t, "x", 0, { passThreshold: 8, samples: 3 });
    assert.deepEqual(usage, { inputTokens: 3, outputTokens: 3 });
  });

  it("requests samples concurrently, keeping verdict order", async () => {
    let inFlight = 0;
    let max = 0;
    let n = 0;
    const slow: LLMProvider = {
      name: "slow",
      text: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
      json: async <T,>() => {
        const i = n++;
        max = Math.max(max, ++inFlight);
        await new Promise((r) => setTimeout(r, 20 - 5 * i)); // first sample resolves last
        inFlight--;
        const s = i === 0 ? 10 : 6;
        return {
          data: { scores: [{ id: "correctness", score: s, rationale: `r${i}` }, { id: "reasoning", score: s, rationale: `r${i}` }], reasoningFlaws: [], summary: `s${i}` } as T,
          usage: { inputTokens: 1, outputTokens: 2 },
        };
      },
    };
    const { verdict, usage } = await judge(slow, t, "x", 0, { passThreshold: 8, samples: 3 });
    assert.equal(max, 3);
    assert.equal(verdict.summary, "s0");
    assert.equal(verdict.scores[0]!.rationale, "r0 | r1 | r2");
    assert.equal(verdict.scores[0]!.score, 7.3);
    assert.deepEqual(usage, { inputTokens: 3, outputTokens: 6 });
  });

  it("averages multiple samples and unions flaws", () => {
    const v2: Verdict = { ...v, reasoningFlaws: ["x"], scores: [{ id: "correctness", score: 6, rationale: "" }, { id: "reasoning", score: 7, rationale: "" }] };
    const a = aggregate([v, v2]);
    assert.deepEqual(a.scores.map((s) => s.score), [8, 6]);
    assert.deepEqual(a.reasoningFlaws, ["x"]);
  });

  it("judge prompt is blind and includes the reference", () => {
    const p = judgePrompt(t, "candidate");
    assert.ok(!/iteration|previous|revision|attempt/i.test(p));
    assert.ok(p.includes(t.reference!));
  });
});
