import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  addUsage,
  extractJson,
  ZERO_USAGE,
  type JsonResult,
  type LLMProvider,
  type LLMRequest,
  type Role,
  type TextResult,
} from "./provider.ts";

export interface AnthropicProviderOptions {
  /** Per-role models: use a different (ideally stronger) model for judge/critic to limit self-preference bias. */
  models: Record<Role, string>;
  /** Schema-validation retries in `json()` (re-asks with the validation error). */
  maxRetries?: number;
  /** SDK-level retries with exponential backoff on 408/409/429/5xx and connection errors. */
  apiRetries?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  client?: Anthropic;
}

export const DEFAULT_API_RETRIES = 4;
export const DEFAULT_TIMEOUT_MS = 120_000;

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private models: Record<Role, string>;
  private maxRetries: number;

  constructor(opts: AnthropicProviderOptions) {
    // reads ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL; retries/timeout matter once tasks run concurrently (429s)
    this.client =
      opts.client ??
      new Anthropic({ maxRetries: opts.apiRetries ?? DEFAULT_API_RETRIES, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    this.models = opts.models;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  /** Some models reject sampling params; drop `temperature` once and remember it. */
  private noTemperature = false;
  private async create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    if (this.noTemperature) delete params.temperature;
    try {
      return await this.client.messages.create(params);
    } catch (e) {
      if (!this.noTemperature && e instanceof Anthropic.BadRequestError && /temperature/i.test(e.message)) {
        this.noTemperature = true;
        return this.create(params);
      }
      throw e;
    }
  }

  async text(req: LLMRequest): Promise<TextResult> {
    const res = await this.create({
      model: this.models[req.role],
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.7,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } };
  }

  /**
   * Structured output via forced tool use: the model must "call" a tool whose
   * input_schema is our Zod schema. Validation failures are fed back and retried.
   */
  async json<T>(req: LLMRequest, schema: z.ZodType<T>, toolName: string): Promise<JsonResult<T>> {
    const inputSchema = z.toJSONSchema(schema, { io: "input" }) as Anthropic.Tool.InputSchema;
    let usage = ZERO_USAGE;
    let feedback = "";

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const res = await this.create({
        model: this.models[req.role],
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature ?? 0,
        system: req.system,
        tools: [{ name: toolName, description: `Submit the ${toolName} result.`, input_schema: inputSchema }],
        tool_choice: { type: "tool", name: toolName },
        messages: [{ role: "user", content: req.prompt + feedback }],
      });
      usage = addUsage(usage, { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });

      const toolUse = res.content.find((b) => b.type === "tool_use");
      const raw: unknown =
        toolUse?.type === "tool_use"
          ? toolUse.input
          : extractJson(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"));

      const parsed = schema.safeParse(raw);
      if (parsed.success) return { data: parsed.data, usage };
      feedback = `\n\nYour previous ${toolName} output failed validation:\n${z.prettifyError(parsed.error)}\nFix it and resubmit.`;
    }
    throw new Error(`${toolName}: model output failed schema validation after ${this.maxRetries + 1} attempts`);
  }
}
