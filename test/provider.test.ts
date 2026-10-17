import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { SelfReflectiveAgent } from "../src/agent/loop.ts";
import { AnthropicProvider } from "../src/llm/anthropic.ts";
import { OfflineProvider } from "../src/llm/offline.ts";
import { extractJson } from "../src/llm/provider.ts";
import { VerdictSchema } from "../src/types.ts";
import { suite, task } from "./helpers.ts";

describe("extractJson", () => {
  it("parses fenced JSON with braces inside strings", () => {
    assert.deepEqual(extractJson('Sure:\n```json\n{"a": "x}{", "b": {"c": 1}}\n```'), { a: "x}{", b: { c: 1 } });
  });
  it("throws when there is no object", () => assert.throws(() => extractJson("nope"), /No JSON object/));
  it("throws on unbalanced object", () => assert.throws(() => extractJson('{"a": 1'), /Unbalanced/));
});

/** Minimal fake of the SDK surface the provider uses. */
function fakeClient(responses: unknown[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      create: async (p: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(structuredClone(p));
        const input = responses[Math.min(calls.length - 1, responses.length - 1)];
        return {
          content: typeof input === "string" ? [{ type: "text", text: input }] : [{ type: "tool_use", id: "t", name: "x", input }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const models = { generator: "gen-m", judge: "judge-m", critic: "judge-m" };
const validVerdict = { scores: [{ id: "a", score: 7, rationale: "ok" }], reasoningFlaws: [], summary: "s" };

describe("AnthropicProvider", () => {
  it("forces tool use, retries with validation feedback, then succeeds", async () => {
    const { client, calls } = fakeClient([{ scores: [{ id: "a", score: 42, rationale: "x" }], summary: "s" }, validVerdict]);
    const p = new AnthropicProvider({ models, client });
    const r = await p.json({ role: "judge", system: "s", prompt: "p" }, VerdictSchema, "submit_verdict");
    assert.equal(r.data.scores[0]!.score, 7);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]!.tool_choice, { type: "tool", name: "submit_verdict" });
    assert.match(calls[1]!.messages[0]!.content as string, /failed validation/);
    assert.deepEqual(r.usage, { inputTokens: 20, outputTokens: 10 });
  });

  it("fails after exhausting retries", async () => {
    const { client, calls } = fakeClient([{ nope: true }]);
    const p = new AnthropicProvider({ models, client, maxRetries: 1 });
    await assert.rejects(p.json({ role: "judge", system: "s", prompt: "p" }, VerdictSchema, "submit_verdict"), /failed schema validation/);
    assert.equal(calls.length, 2);
  });

  it("falls back to JSON in text when no tool block is returned", async () => {
    const { client } = fakeClient(["```json\n" + JSON.stringify(validVerdict) + "\n```"]);
    const r = await new AnthropicProvider({ models, client }).json({ role: "critic", system: "s", prompt: "p" }, VerdictSchema, "v");
    assert.equal(r.data.summary, "s");
  });

  it("routes models per role", async () => {
    const { client, calls } = fakeClient(["draft"]);
    const p = new AnthropicProvider({ models, client });
    await p.text({ role: "generator", system: "s", prompt: "p" });
    const { client: c2, calls: calls2 } = fakeClient([validVerdict]);
    await new AnthropicProvider({ models, client: c2 }).json({ role: "judge", system: "s", prompt: "p" }, VerdictSchema, "v");
    assert.equal(calls[0]!.model, "gen-m");
    assert.equal(calls2[0]!.model, "judge-m");
  });
});

describe("OfflineProvider", () => {
  it("is deterministic across runs", async () => {
    const trajectories = async () => {
      const agent = new SelfReflectiveAgent(new OfflineProvider());
      const out = [];
      for (const t of suite) out.push((await agent.run(t)).metrics.scoreTrajectory);
      return out;
    };
    assert.deepEqual(await trajectories(), await trajectories());
  });

  it("requires fixtures", async () => {
    const t = { ...task("capacity-math"), offline: undefined };
    await assert.rejects(new OfflineProvider().text({ role: "generator", system: "", prompt: "", meta: { task: t, iteration: 0 } }), /no offline fixture/);
  });
});
