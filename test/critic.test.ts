import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { constraintsFromHardChecks, mergeConstraints } from "../src/agent/critic.ts";
import { score } from "../src/agent/judge.ts";
import { criticPrompt } from "../src/agent/prompts.ts";
import type { Constraint } from "../src/types.ts";
import { task } from "./helpers.ts";

describe("constraint ledger", () => {
  it("dedupes case- and punctuation-insensitively", () => {
    const merged = mergeConstraints([{ kind: "must", text: "Cover X." }], [{ kind: "must", text: "cover x" }, { kind: "must", text: "Cover Y" }]);
    assert.deepEqual(merged.map((c) => c.text), ["Cover X.", "Cover Y"]);
  });
  it("drops the oldest when over the cap", () => {
    const ab: Constraint[] = [{ kind: "must", text: "A" }, { kind: "must", text: "B" }];
    assert.deepEqual(mergeConstraints(ab, [{ kind: "must", text: "C" }], 2).map((c) => c.text), ["B", "C"]);
  });
});

describe("hard-check → constraints", () => {
  const t = task("capacity-math");
  it("never leaks the expected answer", () => {
    const cs = constraintsFromHardChecks(t, ['final answer "4" != expected', 'no "Final answer:" line']);
    assert.ok(cs.every((c) => !c.text.includes("5")));
  });
  it("produces stable text across iterations", () => {
    const tt = { ...t, hardChecks: { maxWords: 120 } };
    const a = constraintsFromHardChecks(tt, ["word count 155 > 120"]);
    const b = constraintsFromHardChecks(tt, ["word count 131 > 120"]);
    assert.deepEqual(a, b);
    assert.equal(mergeConstraints(a, b).length, 1);
  });
  it("maps term checks to must / must_not", () => {
    const cs = constraintsFromHardChecks(t, ['missing required term "foo"', 'contains forbidden term "bar"']);
    assert.deepEqual(cs.map((c) => c.kind), ["must", "must_not"]);
  });
});

describe("critic prompt", () => {
  it("includes verdict, hard-check failures and constraints already in force", () => {
    const t = task("capacity-math");
    const v = score(t, { scores: [{ id: "correctness", score: 2, rationale: "wrong" }, { id: "reasoning", score: 6, rationale: "ok" }], reasoningFlaws: ["ignored 70% cap"], summary: "" }, "Final answer: 3", 8.5);
    const ledger: Constraint[] = [{ kind: "must", text: "Show the rate conversion" }, { kind: "format", text: "End with Final answer" }];
    const p = criticPrompt(t, "Final answer: 3", v, ledger);
    for (const s of ["ignored 70% cap", 'final answer "3" != expected', "Show the rate conversion", "End with Final answer", "NEW constraints only"]) {
      assert.ok(p.includes(s), `missing: ${s}`);
    }
  });
});
