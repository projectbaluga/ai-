export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const LENDING_ASSISTANT_MODEL = "@cf/meta/llama-3.1-8b-instruct";

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
    max_tokens: 900
  });
}
