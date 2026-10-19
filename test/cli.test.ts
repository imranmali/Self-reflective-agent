import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const out = mkdtempSync(join(tmpdir(), "sra-cli-"));
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;

const cli = (...args: string[]) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--out", out, "--quiet", ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};

describe("cli", () => {
  it("defaults to the offline provider without an API key and runs a subset", () => {
    const r = cli("--only", "capacity-math");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Summary \(offline\)/);
    assert.match(r.out, /capacity-math/);
    assert.doesNotMatch(r.out, /idempotency-keys/);
    assert.ok(readdirSync(out).length >= 1);
  });

  it("rejects an unknown provider", () => {
    const r = cli("--provider", "bogus");
    assert.notEqual(r.code, 0);
    assert.match(r.out, /unknown --provider bogus/);
  });

  it("rejects an invalid suite before any model call", () => {
    const f = join(out, "bad.json");
    writeFileSync(f, JSON.stringify([{ id: "x", prompt: "p", rubric: [] }]));
    const before = readdirSync(out).length;
    const r = cli("--tasks", f);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /invalid task suite/);
    assert.equal(readdirSync(out).length, before, "no run directory should be created");
  });

  it("prints help", () => {
    const r = cli("--help");
    assert.equal(r.code, 0);
    assert.match(r.out, /--judge-model/);
  });
});

describe("cli --concurrency", () => {
  it("runs the suite with concurrency 2 and records it in the run config", () => {
    const r = cli("--concurrency", "2");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /pass rate 0% → 75%/);
    const dir = r.out.match(/artifacts: (.+)\/\{/)![1]!;
    assert.equal(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).config.concurrency, 2);
  });

  it("rejects a non-positive or non-integer concurrency", () => {
    for (const n of ["0", "-1", "1.5", "x"]) {
      const r = cli(`--concurrency=${n}`);
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /error: --concurrency must be an integer >= 1/);
    }
  });

  it("reads CONCURRENCY from the environment", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--out", out, "--quiet"], { env: { ...env, CONCURRENCY: "0" }, encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--concurrency must be/);
  });

  it("documents the new flags in --help", () => {
    const r = cli("--help");
    for (const f of ["--concurrency", "--api-retries", "--api-timeout-ms"]) assert.ok(r.out.includes(f), f);
  });
});

describe("cli --only validation", () => {
  it("rejects unknown task ids", () => {
    const r = cli("--only", "nope");
    assert.equal(r.code, 2);
    assert.match(r.out, /unknown task id\(s\) in --only: nope/);
  });
});
