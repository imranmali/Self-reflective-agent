import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, SelfReflectiveAgent } from "../src/agent/loop.ts";
import { OfflineProvider } from "../src/llm/offline.ts";
import { RunLogger } from "../src/metrics/logger.ts";
import { mapPool } from "../src/util/pool.ts";
import { spyProvider, suite, task } from "./helpers.ts";

describe("reflection loop", () => {
  it("improves, passes, stops, and returns the passing attempt", async () => {
    const run = await new SelfReflectiveAgent(new OfflineProvider()).run(task("idempotency-keys"));
    assert.equal(run.stopReason, "passed");
    assert.deepEqual(run.metrics.scoreTrajectory, [6.28, 7.3, 10]);
    assert.equal(run.bestIteration, 2);
    assert.equal(run.attempts.length, 3);
  });

  it("revises from the best attempt after a regression", async () => {
    const { provider, requests } = spyProvider();
    const run = await new SelfReflectiveAgent(provider).run(task("kafka-poison-retry"));
    assert.deepEqual(run.metrics.scoreTrajectory, [6.65, 5.35, 10]);
    const gens = requests.filter((r) => r.role === "generator");
    const best0 = run.attempts[0]!.output;
    assert.ok(gens[2]!.prompt.includes(`<previous_best_attempt>\n${best0}\n`), "attempt 2 must build on attempt 0");
    assert.ok(!gens[2]!.prompt.includes(run.attempts[1]!.output));
  });

  it("critiques failed revisions too", async () => {
    const run = await new SelfReflectiveAgent(new OfflineProvider()).run(task("kafka-poison-retry"));
    assert.ok(run.attempts[1]!.critique, "regressed attempt should be critiqued");
    assert.equal(run.attempts[2]!.critique, undefined, "final attempt is not critiqued");
  });

  it("first draft has no constraints; revisions carry best attempt + ledger", async () => {
    const { provider, requests } = spyProvider();
    const run = await new SelfReflectiveAgent(provider).run(task("capacity-math"));
    const gens = requests.filter((r) => r.role === "generator");
    assert.ok(!gens[0]!.prompt.includes("<constraints>") && !gens[0]!.prompt.includes("<previous_best_attempt>"));
    assert.ok(gens[1]!.prompt.includes("<previous_best_attempt>"));
    for (const c of run.attempts[1]!.constraintsApplied) assert.ok(gens[1]!.prompt.includes(c.text));
  });

  it("stops on plateau and returns the first best attempt", async () => {
    const run = await new SelfReflectiveAgent(new OfflineProvider()).run(task("postgres-indexing"));
    assert.equal(run.stopReason, "plateau");
    assert.deepEqual(run.metrics.scoreTrajectory, [6, 7, 7, 7]);
    assert.equal(run.bestIteration, 1);
  });

  it("respects a budget of one", async () => {
    const run = await new SelfReflectiveAgent(new OfflineProvider(), { ...DEFAULT_CONFIG, maxIterations: 1 }).run(task("capacity-math"));
    assert.equal(run.attempts.length, 1);
    assert.equal(run.stopReason, "max_iterations");
  });

  it("isolates a judge failure mid-run and returns the best so far", async () => {
    const { provider } = spyProvider((r, n) => {
      if (r.role === "judge" && n === 3) throw new Error("judge outage");
    });
    const run = await new SelfReflectiveAgent(provider).run(task("idempotency-keys"));
    assert.equal(run.stopReason, "error");
    assert.equal(run.attempts.length, 2);
    assert.equal(run.bestIteration, 1);
  });

  it("surfaces the error when no attempt was scored", async () => {
    const { provider } = spyProvider((r) => {
      if (r.role === "judge") throw new Error("judge outage");
    });
    await assert.rejects(new SelfReflectiveAgent(provider).run(task("capacity-math")), /judge outage/);
  });
});

describe("concurrent tasks", () => {
  it("a shared agent + provider at concurrency 4 gives the same per-task runs as sequential", async () => {
    const sequential = await mapPool(suite, 1, (t) => new SelfReflectiveAgent(new OfflineProvider()).run(t));
    const log = new RunLogger(mkdtempSync(join(tmpdir(), "sra-par-")), false, "r");
    const agent = new SelfReflectiveAgent(new OfflineProvider(), DEFAULT_CONFIG, log);
    const parallel = await mapPool(suite, 4, (t) => agent.run(t));

    const view = (rs: typeof parallel) =>
      rs.map((r) => ({ id: r.taskId, traj: r.metrics.scoreTrajectory, best: r.bestIteration, stop: r.stopReason, out: r.attempts.map((a) => a.output) }));
    assert.deepEqual(view(parallel), view(sequential));

    // events interleave across tasks, but every line is valid JSON and each task's iterations stay ordered
    const events = readFileSync(join(log.dir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const ids = events.map((e) => e.taskId);
    assert.ok(ids.some((id, i) => i > 0 && id !== ids[i - 1] && ids.slice(0, i).includes(id)), "tasks should interleave");
    for (const t of suite) {
      const its = events.filter((e) => e.taskId === t.id && e.type === "judged").map((e) => e.iteration);
      assert.deepEqual(its, [...its.keys()]);
    }
  });
});
