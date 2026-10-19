import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPool } from "../src/util/pool.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Job that tracks how many calls are in flight; later items finish first to shake up completion order. */
function tracked() {
  let inFlight = 0;
  let max = 0;
  const fn = async (x: number, i: number) => {
    max = Math.max(max, ++inFlight);
    await sleep(10 - i);
    inFlight--;
    return x * 2;
  };
  return { fn, max: () => max };
}

describe("mapPool", () => {
  it("preserves input order", async () => {
    const { fn } = tracked();
    assert.deepEqual(await mapPool([1, 2, 3, 4, 5, 6], 3, fn), [2, 4, 6, 8, 10, 12]);
  });

  it("never exceeds the limit and uses it fully", async () => {
    const t = tracked();
    await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 3, t.fn);
    assert.equal(t.max(), 3);
  });

  it("runs sequentially with a limit of 1", async () => {
    const t = tracked();
    await mapPool([1, 2, 3], 1, t.fn);
    assert.equal(t.max(), 1);
  });

  it("handles a limit larger than the input", async () => {
    const t = tracked();
    assert.deepEqual(await mapPool([1, 2], 10, t.fn), [2, 4]);
    assert.equal(t.max(), 2);
  });

  it("returns [] for no items without calling fn", async () => {
    assert.deepEqual(await mapPool([], 4, async () => assert.fail("called")), []);
  });

  it("rejects an invalid limit", async () => {
    for (const n of [0, -1, 1.5, NaN]) await assert.rejects(mapPool([1], n, async (x) => x), /positive integer/);
  });

  it("propagates the first error and starts no new jobs", async () => {
    const started: number[] = [];
    await assert.rejects(
      mapPool([0, 1, 2, 3, 4, 5], 2, async (x) => {
        started.push(x);
        await sleep(1);
        if (x === 1) throw new Error("boom");
        return x;
      }),
      /boom/,
    );
    assert.ok(started.length < 6, `started ${started.join(",")}`);
  });
});
