import { readFileSync } from "node:fs";
import { z } from "zod";
import { OfflineProvider } from "../src/llm/offline.ts";
import type { LLMProvider, LLMRequest } from "../src/llm/provider.ts";
import { TaskSchema, type Task } from "../src/types.ts";

export const suite = z.array(TaskSchema).parse(JSON.parse(readFileSync("tasks/suite.json", "utf8")));
export const task = (id: string): Task => suite.find((t) => t.id === id)!;

/** Wraps the offline provider, recording every request; optional hook can throw to simulate outages. */
export function spyProvider(hook?: (req: LLMRequest, n: number) => void) {
  const inner = new OfflineProvider();
  const requests: LLMRequest[] = [];
  const record = (r: LLMRequest) => {
    requests.push(r);
    hook?.(r, requests.filter((x) => x.role === r.role).length);
  };
  const provider: LLMProvider = {
    name: "spy",
    text: async (r) => (record(r), inner.text(r)),
    json: async (r, s, n) => (record(r), inner.json(r, s, n)),
  };
  return { provider, requests };
}
