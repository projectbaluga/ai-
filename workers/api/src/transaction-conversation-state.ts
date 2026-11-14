import type { AssistantMessage } from "../../../packages/ai-core/src/contracts";

export type TransactionConversationStatus =
  | "cancelled"
  | "continuing_transaction"
  | "revising_transaction"
  | "new_transaction"
  | "confirming_action"
  | "independent_turn";

export interface TransactionConversationState {
  status: TransactionConversationStatus;
  cancelled: boolean;
  carriesTransactionContext: boolean;
  instruction: string;
}

const LOAN_EVENT = /\b(?:nagpautang|magpautang|pinautang|pinahiram|nangutang|umutang|borrowed|i\s+(?:lend|lent|loaned)|create\s+(?:a\s+)?loan|record\s+(?:a\s+)?loan)\b/i;
const TRANSACTION_DETAIL_QUESTION = /\b(?:interest|loan terms|interest type|interest value|interest period|principal|amount|halaga|magkano|borrower|pangalan|name|phone|contact|due date|due|date|kailan|bayad|hulog|repayment|frequency|tubo|patong|porsiyento|ilang)\b/i;

export function isExplicitTransactionCancellation(message: string): boolean {
  return /^(?:please\s+)?(?:cancel|stop|never\s*mind|forget\s+it|do\s+not\s+proceed|don['’]?t\s+proceed|huwag\s+na|wag\s+na|hindi\s+na|kanselahin|itigil)(?:\b|$)[\s.!?,-]*.*$/i.test(message.trim());
}

export function buildTransactionConversationState(messages: AssistantMessage[]): TransactionConversationState {
  const lastUser = [...messages].reverse().find(message => message.role === "user")?.content.trim() ?? "";
  if (isExplicitTransactionCancellation(lastUser)) {
    return {
      status: "cancelled",
      cancelled: true,
      carriesTransactionContext: false,
      instruction: "The owner cancelled the current transaction. Do not prepare, revive, or confirm any pending proposal from this conversation. Acknowledge cancellation and ask what they would like to do next only if useful."
    };
  }

  const lastAssistantIndex = messages.map(message => message.role).lastIndexOf("assistant");
  const lastAssistant = lastAssistantIndex >= 0 ? messages[lastAssistantIndex].content : "";
  const recent = messages.slice(-10);
  const hasRecentLoanNarrative = recent.some(message => message.role === "user" && LOAN_EVENT.test(message.content));
  const assistantAskedForTransactionDetail = TRANSACTION_DETAIL_QUESTION.test(lastAssistant) && /[?؟]/.test(lastAssistant);
  const isShortFollowup = lastUser.length <= 180 && !/[?؟]/.test(lastUser);
  const suppliesTransactionDetail = /\d|%|\b(?:daily|weekly|monthly|one[- ]?time|fixed|percentage|araw|linggo|buwan|bukas|tomorrow|next\s+month|end\s+of\s+the\s+month|no\s+interest|without\s+interest|walang\s+tubo|walang\s+interest)\b/i.test(lastUser);
  const correction = /\b(?:actually|correction|instead|change|correct|mali|palitan|palit|ang ibig kong sabihin|dapat)\b/i.test(lastUser);
  const isNewLoanEvent = LOAN_EVENT.test(lastUser);
  if (!isNewLoanEvent && hasRecentLoanNarrative && isShortFollowup && assistantAskedForTransactionDetail && suppliesTransactionDetail && correction) {
    return {
      status: "revising_transaction",
      cancelled: false,
      carriesTransactionContext: true,
      instruction: "The owner is correcting or replacing a detail in the active loan conversation. Apply the correction only to the named field; preserve other established facts and ask only for any remaining required detail."
    };
  }

  if (!isNewLoanEvent && hasRecentLoanNarrative && isShortFollowup && assistantAskedForTransactionDetail && suppliesTransactionDetail) {
    return {
      status: "continuing_transaction",
      cancelled: false,
      carriesTransactionContext: true,
      instruction: "The latest message is a follow-up to the active loan conversation. Carry forward the borrower, principal, and other previously stated facts. Add the new detail without asking the owner to repeat information."
    };
  }

  const affirmative = /^(?:yes|yeah|yep|okay|ok|sige|oo|opo|go ahead|proceed|ituloy|gawin mo na|do it|save it|register na)[.!\s]*$/i.test(lastUser);
  const assistantNamedAction = /\b(?:register|create|add|save|record|update|archive|borrower|loan|payment)\b/i.test(lastAssistant) && /[?؟]/.test(lastAssistant);
  if (affirmative && assistantNamedAction) {
    return {
      status: "confirming_action",
      cancelled: false,
      carriesTransactionContext: true,
      instruction: "The owner affirmatively accepted the specific action described in the immediately preceding assistant turn. Carry forward only that action and its stated target; prepare it for review only if all required fields and verified IDs are available. Do not commit it without the app's separate owner confirmation."
    };
  }

  if (LOAN_EVENT.test(lastUser)) {
    return {
      status: "new_transaction",
      cancelled: false,
      carriesTransactionContext: true,
      instruction: "The owner has described a new lending event. Treat it as a transaction to discuss or prepare, not as proof that it was saved. Keep this transaction separate from older borrower or loan threads."
    };
  }

  return {
    status: "independent_turn",
    cancelled: false,
    carriesTransactionContext: false,
    instruction: "Treat this as an independent turn unless the owner explicitly refers to a prior transaction. Do not carry old transaction details or approvals into a new topic."
  };
}
