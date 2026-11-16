import { describe, expect, it, vi } from "vitest";
import { LENDING_ASSISTANT_MODEL, runLendingAssistantModel, type WorkersAiBinding } from "../workers/api/src/workers-ai-provider";

describe("lending assistant model configuration", () => {
  it("uses Gemma 4 with thinking disabled for structured output", async () => {
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
      chat_template_kwargs: { enable_thinking: false }
    }));
  });

  it("retries once without chat_template_kwargs when the provider rejects that parameter", async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("Invalid parameter chat_template_kwargs"))
      .mockResolvedValueOnce({ response: "ok" });
    const ai = { run } as unknown as WorkersAiBinding;

    await expect(runLendingAssistantModel(ai, "system instructions", [
      { role: "user", content: "hi" }
    ])).resolves.toEqual({ response: "ok" });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0]).toBe(LENDING_ASSISTANT_MODEL);
    expect(run.mock.calls[0][1]).toHaveProperty("chat_template_kwargs", { enable_thinking: false });
    expect(run.mock.calls[1][0]).toBe(LENDING_ASSISTANT_MODEL);
    expect(run.mock.calls[1][1]).not.toHaveProperty("chat_template_kwargs");
    expect(run.mock.calls[1][1]).toMatchObject({
      max_tokens: 2400,
      temperature: 0.35,
      messages: [
        { role: "system", content: "system instructions" },
        { role: "user", content: "hi" }
      ]
    });
  });

  it("does not retry unrelated Workers AI errors", async () => {
    const failure = new Error("Workers AI binding unavailable");
    const run = vi.fn().mockRejectedValue(failure);
    const ai = { run } as unknown as WorkersAiBinding;

    await expect(runLendingAssistantModel(ai, "system instructions", [
      { role: "user", content: "hi" }
    ])).rejects.toBe(failure);
    expect(run).toHaveBeenCalledOnce();
  });
});
