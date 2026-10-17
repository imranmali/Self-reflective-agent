import type { z } from "zod";
import type { Constraint, Task, Usage } from "../types.ts";

export type Role = "generator" | "judge" | "critic";

/**
 * Structured side-channel for the offline provider. Real providers ignore it —
 * everything they need is in `system` + `prompt`.
 */
export interface RequestMeta {
  task: Task;
  iteration: number;
  constraints?: Constraint[];
  candidate?: string;
  verdict?: unknown;
}

export interface LLMRequest {
  role: Role;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  meta?: RequestMeta;
}

export interface TextResult {
  text: string;
  usage: Usage;
}

export interface JsonResult<T> {
  data: T;
  usage: Usage;
}

export interface LLMProvider {
  readonly name: string;
  text(req: LLMRequest): Promise<TextResult>;
  /** Must return data validated against `schema`. */
  json<T>(req: LLMRequest, schema: z.ZodType<T>, toolName: string): Promise<JsonResult<T>>;
}

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

/** Pull the first balanced JSON object out of free text (handles ```json fences and prose). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object found in model output");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("Unbalanced JSON object in model output");
}
