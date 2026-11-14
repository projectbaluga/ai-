export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const LENDING_ASSISTANT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/**
 * Server-side adapter for Cloudflare Workers AI.
 * The model only returns an advisory structured response; it has no database
 * handle and cannot execute application actions.
 */
export async function runLendingAssistantModel(
  ai: WorkersAiBinding,
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>
): Promise<unknown> {
  return ai.run(LENDING_ASSISTANT_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      ...messages
    ],
    max_tokens: 480,
    temperature: 0.35
  });
}
