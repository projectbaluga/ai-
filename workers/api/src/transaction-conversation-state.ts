import type { AssistantMessage } from "../../../packages/ai-core/src/contracts";

export type TransactionConversationStatus =
  | "cancelled"
  | "continuing_transaction"
  | "revising_transaction"
  | "new_transaction"
  | "independent_turn";

export interface TransactionConversationState {
  status: TransactionConversationStatus;
  cancelled: boolean;
  carriesTransactionContext: boolean;
  instruction: string;
}

const LOAN_EVENT = /\b(?:nagpautang|magpautang|pinahiram|nangutang|umutang|borrowed|i\s+(?:lend|lent|loaned)|create\s+(?:a\s+)?loan|record\s+(?:a\s+)?loan)\b/i;
const TERMS_QUESTION = /\b(?:interest|loan terms|interest type|interest value|interest period|daily|weekly|monthly|tubo|patong)\b/i;

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
  const assistantAskedForTerms = TERMS_QUESTION.test(lastAssistant) && /[?؟]/.test(lastAssistant);
  const isShortFollowup = lastUser.length <= 180 && !/[?؟]/.test(lastUser);
  const suppliesTransactionDetail = /\d|%|\b(?:daily|weekly|monthly|one[- ]?time|fixed|percentage|araw|linggo|buwan|bukas|tomorrow|next\s+month|end\s+of\s+the\s+month|no\s+interest|without\s+interest|walang\s+tubo|walang\s+interest)\b/i.test(lastUser);
  const correction = /\b(?:actually|correction|instead|change|correct|mali|palitan|palit|ang ibig kong sabihin|dapat)\b/i.test(lastUser);
  if (hasRecentLoanNarrative && isShortFollowup && assistantAskedForTerms && suppliesTransactionDetail && correction) {
    return {
      status: "revising_transaction",
      cancelled: false,
      carriesTransactionContext: true,
      instruction: "The owner is correcting or replacing a detail in the active loan conversation. Apply the correction only to the named field; preserve other established facts and ask only for any remaining required detail."
    };
  }

  if (hasRecentLoanNarrative && isShortFollowup && assistantAskedForTerms && suppliesTransactionDetail) {
    return {
      status: "continuing_transaction",
      cancelled: false,
      carriesTransactionContext: true,
      instruction: "The latest message is a follow-up to the active loan conversation. Carry forward the borrower, principal, and other previously stated facts. Add the new detail without asking the owner to repeat information."
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
