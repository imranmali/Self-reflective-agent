import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runHardChecks } from "../src/agent/judge.ts";
import { ConstraintSchema, CriterionSchema, CritiqueSchema, TaskSchema, VerdictSchema } from "../src/types.ts";
import { suite } from "./helpers.ts";

const base = { id: "t", prompt: "p", rubric: [{ id: "a", description: "d" }] };
const ok = (schema: { safeParse: (x: unknown) => { success: boolean } }, x: unknown) => schema.safeParse(x).success;

describe("TaskSchema", () => {
  it("defaults criterion weight to 1 and hardChecks to {}", () => {
    const t = TaskSchema.parse(base);
    assert.equal(t.rubric[0]!.weight, 1);
    assert.deepEqual(t.hardChecks, {});
    assert.equal(t.offline, undefined);
  });
  it("bounds passThreshold to 0–10", () => {
    assert.ok(ok(TaskSchema, { ...base, passThreshold: 10 }));
    assert.ok(!ok(TaskSchema, { ...base, passThreshold: 10.1 }));
    assert.ok(!ok(TaskSchema, { ...base, passThreshold: -1 }));
  });
  it("rejects empty offline drafts and an empty rubric", () => {
    assert.ok(!ok(TaskSchema, { ...base, offline: { drafts: [], criterionKeywords: {} } }));
    assert.ok(!ok(TaskSchema, { ...base, rubric: [] }));
  });
  it("rejects non-positive weights and non-integer maxWords", () => {
    assert.ok(!ok(CriterionSchema, { id: "a", description: "d", weight: 0 }));
    assert.ok(!ok(TaskSchema, { ...base, hardChecks: { maxWords: 1.5 } }));
    assert.ok(!ok(TaskSchema, { ...base, hardChecks: { maxWords: 0 } }));
  });
});

describe("judge / critic schemas", () => {
  const s = (score: number) => ({ scores: [{ id: "a", score, rationale: "r" }], summary: "s" });
  it("VerdictSchema bounds scores to 0–10 and defaults reasoningFlaws", () => {
    assert.ok(!ok(VerdictSchema, s(10.5)));
    assert.ok(!ok(VerdictSchema, s(-0.1)));
    assert.deepEqual(VerdictSchema.parse(s(10)).reasoningFlaws, []);
  });
  it("VerdictSchema requires at least one score", () => assert.ok(!ok(VerdictSchema, { scores: [], summary: "s" })));
  it("CritiqueSchema requires >= 1 constraint and defaults reasoningIssues", () => {
    assert.ok(!ok(CritiqueSchema, { diagnosis: "d", constraints: [] }));
    assert.deepEqual(CritiqueSchema.parse({ diagnosis: "d", constraints: [{ kind: "must", text: "x" }] }).reasoningIssues, []);
  });
  it("ConstraintSchema rejects unknown kinds", () => {
    assert.ok(!ok(ConstraintSchema, { kind: "should", text: "x" }));
    assert.ok(ok(ConstraintSchema, { kind: "must_not", text: "x", sourceCriterion: "a" }));
  });
});

describe("tasks/suite.json", () => {
  it("has unique task ids", () => assert.equal(new Set(suite.map((t) => t.id)).size, suite.length));
  it("has unique rubric ids per task", () => {
    for (const t of suite) assert.equal(new Set(t.rubric.map((c) => c.id)).size, t.rubric.length, t.id);
  });
  it("offline criterionKeywords match the rubric ids exactly", () => {
    for (const t of suite.filter((x) => x.offline)) {
      assert.deepEqual(Object.keys(t.offline!.criterionKeywords).sort(), t.rubric.map((c) => c.id).sort(), t.id);
    }
  });
  it("the last offline draft of every task passes its hard checks", () => {
    for (const t of suite.filter((x) => x.offline)) assert.deepEqual(runHardChecks(t, t.offline!.drafts.at(-1)!), [], t.id);
  });
});
