import type { LLMProvider } from "../llm/provider.ts";
import type { Constraint, Critique, Task, Usage } from "../types.ts";
import { GENERATOR_SYSTEM, generatorPrompt } from "./prompts.ts";

export async function execute(
  llm: LLMProvider,
  task: Task,
  iteration: number,
  ctx?: { bestOutput: string; critique: Critique; constraints: Constraint[] },
): Promise<{ output: string; usage: Usage }> {
  const r = await llm.text({
    role: "generator",
    system: GENERATOR_SYSTEM,
    prompt: generatorPrompt(task, ctx),
    // first draft explores; revisions are pinned down by constraints, so lower temperature
    temperature: ctx ? 0.4 : 0.7,
    meta: { task, iteration, constraints: ctx?.constraints ?? [] },
  });
  return { output: r.text.trim(), usage: r.usage };
}
