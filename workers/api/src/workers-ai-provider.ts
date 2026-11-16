export interface WorkersAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export const LENDING_ASSISTANT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const LENDING_ASSISTANT_ENABLE_THINKING = false;

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
  const input = {
    messages: [
      { role: "system" as const, content: systemPrompt },
      ...messages
    ],
    max_tokens: 2400,
    temperature: 0.35
  };

  try {
    return await ai.run(LENDING_ASSISTANT_MODEL, {
      ...input,
      chat_template_kwargs: {
        enable_thinking: LENDING_ASSISTANT_ENABLE_THINKING
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const rejectsChatTemplateKwargs =
      /chat_template_kwargs/i.test(message) &&
      /(invalid|unknown|unsupported|unrecognized|not allowed|not support|unexpected|additional propert|extra propert|parameter|argument)/i.test(message);

    if (!rejectsChatTemplateKwargs) throw error;

    // Some Workers AI models/runtimes reject this optional template argument.
    // Retry once without it; preserve the fallback error if the provider still fails.
    return ai.run(LENDING_ASSISTANT_MODEL, input);
  }
}
