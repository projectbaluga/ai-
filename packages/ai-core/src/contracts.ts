/**
 * Provider-neutral contracts for the reusable AI layer.
 *
 * AI output is advisory. The application backend remains responsible for
 * authorization, validation, calculations, persistence, and audit logging.
 */

export type SupportedLanguage = "en" | "tl" | "tl-en";

export type AssistantIntent =
  | "answer_question"
  | "search_records"
  | "prepare_action"
  | "explain_report"
  | "request_clarification"
  | "unknown";

export interface AssistantContext {
  appId: string;
  userId: string;
  language: SupportedLanguage;
  conversationId?: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantRequest {
  context: AssistantContext;
  messages: AssistantMessage[];
}

export interface ProposedAction {
  /** Application-defined action name, never an executable instruction. */
  type: string;
  /** Untrusted arguments; validate against the app's own schema. */
  payload: Record<string, unknown>;
  /** Human-readable explanation shown before approval. */
  summary: string;
  requiresConfirmation: true;
}

export interface AssistantResponse {
  intent: AssistantIntent;
  message: string;
  proposedActions: ProposedAction[];
  /** True when the assistant needs more information from the user. */
  needsClarification: boolean;
}

/**
 * Implementations must treat user content and retrieved records as data,
 * not instructions. They must never directly write to the database or
 * bypass the application's permission and confirmation checks.
 */
export interface AssistantProvider {
  respond(request: AssistantRequest): Promise<AssistantResponse>;
}
