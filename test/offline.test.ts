import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OfflineProvider, wordCount } from "../src/llm/offline.ts";
import { CritiqueSchema, TaskSchema, VerdictSchema, type Constraint, type Task } from "../src/types.ts";
import { task } from "./helpers.ts";

const mk = (drafts: string[], kw: Record<string, string[]> = { a: [] }, hardChecks = {}, id = "t"): Task =>
  TaskSchema.parse({ id, prompt: "p", rubric: Object.keys(kw).map((k) => ({ id: k, description: k })), hardChecks, offline: { drafts, criterionKeywords: kw } });
const must = (...terms: string[]): Constraint[] => terms.map((t) => ({ kind: "must", text: `Explicitly cover "${t}"` }));
const gen = async (p: OfflineProvider, t: Task, iteration: number, constraints: Constraint[] = []) =>
  (await p.text({ role: "generator", system: "", prompt: "", meta: { task: t, iteration, constraints } })).text;
const verdict = (p: OfflineProvider, t: Task, candidate: string) =>
  p.json({ role: "judge", system: "", prompt: "", meta: { task: t, iteration: 0, candidate } }, VerdictSchema).then((r) => r.data);
const crit = (p: OfflineProvider, t: Task, candidate: string) =>
  p.json({ role: "critic", system: "", prompt: "", meta: { task: t, iteration: 0, candidate } }, CritiqueSchema).then((r) => r.data);

describe("OfflineProvider contract", () => {
  it("text() rejects non-generator roles", async () => {
    const t = mk(["d0"]);
    await assert.rejects(new OfflineProvider().text({ role: "judge", system: "", prompt: "", meta: { task: t, iteration: 0 } }), /generator with meta required/);
  });
  it("text() rejects a generator request without meta", async () => {
    await assert.rejects(new OfflineProvider().text({ role: "generator", system: "", prompt: "" }), /generator with meta required/);
  });
  it("json() requires meta", async () => {
    await assert.rejects(new OfflineProvider().json({ role: "judge", system: "", prompt: "" }, VerdictSchema), /meta required/);
  });
  it("judge and critic throw for tasks without fixtures", async () => {
    const t = { ...task("capacity-math"), offline: undefined };
    await assert.rejects(verdict(new OfflineProvider(), t, "x"), /no offline fixture/);
    await assert.rejects(crit(new OfflineProvider(), t, "x"), /no offline fixture/);
  });
  it("fakes usage as ceil(chars / 4)", async () => {
    const r = await new OfflineProvider().text({ role: "generator", system: "", prompt: "abcde", meta: { task: mk(["abcd"]), iteration: 0 } });
    assert.deepEqual(r.usage, { inputTokens: 2, outputTokens: 1 });
  });
});

describe("offline generator", () => {
  it("returns draft 0 for a first draft without constraints", async () => {
    assert.equal(await gen(new OfflineProvider(), mk(["d0 alpha", "d1 alpha"]), 0), "d0 alpha");
  });

  it("always moves to a new draft on revision, even with no constraints", async () => {
    const p = new OfflineProvider();
    const t = mk(["d0", "d1", "d2"]);
    await gen(p, t, 0);
    assert.equal(await gen(p, t, 1), "d1");
  });

  it("picks the draft satisfying the most quoted terms, case-insensitively", async () => {
    const p = new OfflineProvider();
    const t = mk(["d0", "alpha", "Alpha BETA", "beta"]);
    await gen(p, t, 0);
    assert.equal(await gen(p, t, 1, must("ALPHA", "beta")), "Alpha BETA");
  });

  it("breaks ties in favour of the earliest eligible draft", async () => {
    const p = new OfflineProvider();
    const t = mk(["d0", "x", "beta one", "beta two"]);
    await gen(p, t, 0);
    assert.equal(await gen(p, t, 1, must("beta")), "beta one");
  });

  it("never goes backwards to an earlier draft index", async () => {
    const p = new OfflineProvider();
    const t = mk(["d0", "alpha", "gamma", "d3"]);
    await gen(p, t, 0);
    assert.equal(await gen(p, t, 1, must("gamma")), "gamma");
    assert.equal(await gen(p, t, 2, must("alpha")), "d3", "alpha only exists in an earlier draft");
  });

  it("stays on the last draft once drafts are exhausted", async () => {
    const p = new OfflineProvider();
    const t = mk(["d0", "d1"]);
    const out = [];
    for (let i = 0; i < 4; i++) out.push(await gen(p, t, i));
    assert.deepEqual(out, ["d0", "d1", "d1", "d1"]);
  });

  it("resets on iteration 0 and tracks progress per task id", async () => {
    const p = new OfflineProvider();
    const a = mk(["a0", "a1", "a2"], undefined, {}, "a");
    const b = mk(["b0", "b1", "b2"], undefined, {}, "b");
    await gen(p, a, 0);
    await gen(p, a, 1);
    await gen(p, b, 0);
    assert.equal(await gen(p, a, 2), "a2");
    assert.equal(await gen(p, b, 1), "b1");
    assert.equal(await gen(p, a, 0), "a0");
  });

  it("honours word-limit constraints", async () => {
    const p = new OfflineProvider();
    const t = mk(["d0", "one two three four five six", "one two"]);
    await gen(p, t, 0);
    assert.equal(await gen(p, t, 1, [{ kind: "format", text: "Stay under 3 words" }]), "one two");
  });
});

describe("offline judge", () => {
  it("scores 2 + 8 × keyword coverage per criterion", async () => {
    const t = mk(["d0"], { none: ["x", "y"], half: ["alpha", "zeta"], full: ["alpha"], empty: [] });
    const v = await verdict(new OfflineProvider(), t, "ALPHA");
    assert.deepEqual(v.scores.map((s) => [s.id, s.score]), [["none", 2], ["half", 6], ["full", 10], ["empty", 10]]);
    assert.equal(v.scores[3]!.rationale, "all key points covered");
    assert.equal(v.reasoningFlaws.length, 2);
  });

  it("caps concision at 4 when over maxWords", async () => {
    const t = task("idempotency-keys");
    const long = t.offline!.drafts[1]!;
    assert.ok(wordCount(long) > t.hardChecks.maxWords!);
    const v = await verdict(new OfflineProvider(), t, long);
    assert.equal(v.scores.find((s) => s.id === "concision")!.score, 4);
    assert.ok(v.reasoningFlaws.includes(`[concision] ${wordCount(long)} words exceeds limit of 120`));
  });

  it("does not cap concision within the limit, nor other criteria when over it", async () => {
    const t = mk(["d0"], { concision: [], other: [] }, { maxWords: 2 });
    const p = new OfflineProvider();
    assert.deepEqual((await verdict(p, t, "one two")).scores.map((s) => s.score), [10, 10]);
    assert.deepEqual((await verdict(p, t, "one two three")).scores.map((s) => s.score), [4, 10]);
  });
});

describe("offline critic", () => {
  it("turns missing keywords and word overruns into constraints", async () => {
    const t = mk(["d0"], { a: ["alpha", "beta"], b: ["gamma"] }, { maxWords: 2 });
    const c = await crit(new OfflineProvider(), t, "alpha and more words");
    assert.deepEqual(c.constraints, [
      { kind: "must", text: 'Explicitly cover "beta"', sourceCriterion: "a" },
      { kind: "must", text: 'Explicitly cover "gamma"', sourceCriterion: "b" },
      { kind: "format", text: "Stay under 2 words" },
    ]);
    assert.match(c.diagnosis, /^3 gap\(s\)/);
    assert.deepEqual(c.reasoningIssues, c.constraints.map((x) => x.text));
  });

  it("emits the fallback reasoning constraint when nothing is missing", async () => {
    const t = mk(["d0"], { a: ["alpha"] }, { maxWords: 5 });
    const c = await crit(new OfflineProvider(), t, "alpha");
    assert.deepEqual(c.constraints, [{ kind: "reasoning", text: "Tighten wording; keep all covered points" }]);
  });
});

describe("wordCount", () => {
  it("handles empty, whitespace-only and mixed whitespace", () => {
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("   \n\t "), 0);
    assert.equal(wordCount("a\nb\tc"), 3);
    assert.equal(wordCount("  a   b  "), 2);
    assert.equal(wordCount("one\n\n\ntwo"), 2);
  });
});
