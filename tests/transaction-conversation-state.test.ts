import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../packages/ai-core/src/contracts";
import { buildTransactionConversationState, isExplicitTransactionCancellation } from "../workers/api/src/transaction-conversation-state";

describe("transaction conversation state", () => {
  it("marks an explicit cancellation and clears transaction carry-forward", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
      { role: "assistant", content: "What interest terms did you agree on?" },
      { role: "user", content: "Cancel that loan." }
    ];
    expect(isExplicitTransactionCancellation("Huwag na po.")).toBe(true);
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "cancelled",
      cancelled: true,
      carriesTransactionContext: false
    });
  });

  it("carries an active loan into a concise answer to a terms question", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
      { role: "assistant", content: "What interest terms did you agree on?" },
      { role: "user", content: "5% fixed." }
    ];
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "continuing_transaction",
      cancelled: false,
      carriesTransactionContext: true
    });
  });

  it("treats a correction as a revision of the active transaction", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
      { role: "assistant", content: "What interest terms did you agree on?" },
      { role: "user", content: "Actually, 3% fixed." }
    ];
    expect(buildTransactionConversationState(messages).status).toBe("revising_transaction");
  });

  it("preserves a clear yes to the immediately preceding specific action", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "Jeffrey Peconcillo 09171234567" },
      { role: "assistant", content: "I can register Jeffrey Peconcillo as a borrower. Would you like me to prepare that?" },
      { role: "user", content: "Opo." }
    ];
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "confirming_action",
      carriesTransactionContext: true
    });
  });

  it("starts a separate transaction when a new lending event is narrated", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
      { role: "assistant", content: "What interest terms did you agree on?" },
      { role: "user", content: "Nagpautang ako ng 500 pesos kay Maria Santos." }
    ];
    expect(buildTransactionConversationState(messages).status).toBe("new_transaction");
  });

  it("does not carry loan details into an unrelated topic", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
      { role: "assistant", content: "What interest terms did you agree on?" },
      { role: "user", content: "How do I change my password?" }
    ];
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "independent_turn",
      carriesTransactionContext: false
    });
  });

  it("does not mistake an unrelated short statement for a loan-term answer", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
      { role: "assistant", content: "What interest terms did you agree on?" },
      { role: "user", content: "I want to change my password." }
    ];
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "independent_turn",
      carriesTransactionContext: false
    });
  });

  it("carries the active loan when the owner answers a principal question, not only an interest question", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "Pinautang ko si Mica." },
      { role: "assistant", content: "Magkano ang ipinahiram mo kay Mica?" },
      { role: "user", content: "1500 pesos." }
    ];
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "continuing_transaction",
      carriesTransactionContext: true
    });
  });

  it("treats a correction to a requested transaction detail as a revision", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "Pinautang ko si Mica ng 1000 pesos." },
      { role: "assistant", content: "May iba pa bang napagkasunduan sa interest?" },
      { role: "user", content: "Actually, 1500 pesos pala." }
    ];
    expect(buildTransactionConversationState(messages)).toMatchObject({
      status: "revising_transaction",
      carriesTransactionContext: true
    });
  });

});
