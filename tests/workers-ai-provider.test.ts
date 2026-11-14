import { describe, expect, it, vi } from "vitest";
import { LENDING_ASSISTANT_MODEL, runLendingAssistantModel, type WorkersAiBinding } from "../workers/api/src/workers-ai-provider";

describe("lending assistant model configuration", () => {
  it("uses Gemma 4 with reasoning enabled and enough output budget for structured reviews", async () => {
    const run = vi.fn(async () => ({ response: "ok" }));
    const ai = { run } as unknown as WorkersAiBinding;
    const messages = [
      { role: "user" as const, content: "Pinautang ko si Mica ng 1,500 pesos." },
      { role: "assistant" as const, content: "May interest ba?" },
      { role: "user" as const, content: "Walang interest." }
    ];

    await runLendingAssistantModel(ai, "system instructions", messages);

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(LENDING_ASSISTANT_MODEL, expect.objectContaining({
      messages: [
        { role: "system", content: "system instructions" },
        ...messages
      ],
      max_tokens: 2400,
      temperature: 0.35,
      chat_template_kwargs: { enable_thinking: true }
    }));
  });
});
