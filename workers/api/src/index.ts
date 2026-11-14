import type {
  AssistantIntent,
  AssistantMessage,
  AssistantResponse,
  SupportedLanguage
} from "../../../packages/ai-core/src/contracts";
import { buildLendingAssistantSystemPrompt } from "./lending-assistant-prompt";
import { buildTransactionConversationState } from "./transaction-conversation-state";
import { runLendingAssistantModel, type WorkersAiBinding } from "./workers-ai-provider";

export interface Env {
  DB: D1Database;
  OWNER_API_TOKEN: string;
  AI: WorkersAiBinding;
}

type ActionType = "create_borrower" | "create_loan" | "record_payment" | "update_borrower" | "archive_borrower" | "update_loan_terms" | "clear_all_records";
type JsonObject = Record<string, unknown>;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function normalizeActionPayload(type: unknown, input: unknown): { type: ActionType; payload: JsonObject } | null {
  if (!isRecord(input)) return null;
  const aliases: Record<string, ActionType> = {
    create_borrower: "create_borrower", createBorrower: "create_borrower",
    register_borrower: "create_borrower", registerBorrower: "create_borrower",
    create_loan: "create_loan", createLoan: "create_loan",
    record_payment: "record_payment", recordPayment: "record_payment",
    update_borrower: "update_borrower", updateBorrower: "update_borrower",
    archive_borrower: "archive_borrower", archiveBorrower: "archive_borrower",
    update_loan_terms: "update_loan_terms", updateLoanTerms: "update_loan_terms",
    clear_all_records: "clear_all_records", clearAllRecords: "clear_all_records", delete_all_records: "clear_all_records"
  };
  const canonicalType = typeof type === "string" ? aliases[type] : undefined;
  if (!canonicalType) return null;
  const payload: JsonObject = { ...input };
  if (canonicalType === "create_borrower" || canonicalType === "update_borrower") {
    if (payload.fullName === undefined && typeof payload.name === "string") payload.fullName = payload.name;
    if (payload.phone === undefined && typeof payload.contactNumber === "string") payload.phone = payload.contactNumber;
    delete payload.name;
    delete payload.contactNumber;
  }
  if (canonicalType === "create_loan" || canonicalType === "update_loan_terms") {
    if (payload.interestFrequency === undefined && typeof payload.interestPeriod === "string") {
      payload.interestFrequency = payload.interestPeriod;
    }
    if (payload.interestPeriod === undefined && typeof payload.interestFrequency === "string") {
      payload.interestPeriod = payload.interestFrequency === "monthly" ? "monthly" : "one_time";
    }
  }
  return { type: canonicalType, payload };
}

function validateAction(type: unknown, input: unknown): { type: ActionType; payload: JsonObject } | null {
  const normalized = normalizeActionPayload(type, input);
  if (!normalized) return null;
  type = normalized.type;
  const payload = normalized.payload;

  if (type === "clear_all_records") {
    return Object.keys(payload).length === 0 ? { type, payload } : null;
  }
  if (type === "create_borrower") {
    if (!text(payload.fullName, 160)) return null;
    if (payload.phone !== undefined && payload.phone !== null && !text(payload.phone, 40)) return null;
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") return null;
    return { type, payload };
  }
  if (type === "create_loan") {
    const hasBorrowerId = text(payload.borrowerId, 80);
    const hasBorrowerName = text(payload.borrowerFullName, 160);
    if (hasBorrowerId === hasBorrowerName) return null;
    if (hasBorrowerId && ["PENDING_BORROWER_ID", "pending_borrower_id"].includes(String(payload.borrowerId))) return null;
    if (payload.phone !== undefined && payload.phone !== null && !text(payload.phone, 40)) return null;
    if (!Number.isSafeInteger(payload.principalMinor) || (payload.principalMinor as number) <= 0) return null;
    if (payload.currency !== undefined && payload.currency !== "PHP") return null;
    if (!["none", "fixed", "percentage"].includes(String(payload.interestType))) return null;
    if (typeof payload.interestValue !== "number" || !Number.isFinite(payload.interestValue) || payload.interestValue < 0) return null;
    if (!["one_time", "monthly"].includes(String(payload.interestPeriod))) return null;
    if (!["one_time", "daily", "weekly", "monthly", "annual"].includes(String(payload.interestFrequency))) return null;
    if (payload.interestType === "none" && payload.interestValue !== 0) return null;
    if (payload.dueDate !== undefined && payload.dueDate !== null &&
        !isIsoDate(payload.dueDate)) return null;
    if (payload.repaymentFrequency !== undefined && !["one_time", "daily", "weekly", "biweekly", "monthly"].includes(String(payload.repaymentFrequency))) return null;
    if (payload.repaymentTimingNote !== undefined && payload.repaymentTimingNote !== null && !text(payload.repaymentTimingNote, 240)) return null;
    if (payload.installmentCount !== undefined && payload.installmentCount !== null &&
        (!Number.isSafeInteger(payload.installmentCount) || (payload.installmentCount as number) <= 0)) return null;
    if (payload.installmentAmountMinor !== undefined && payload.installmentAmountMinor !== null &&
        (!Number.isSafeInteger(payload.installmentAmountMinor) || (payload.installmentAmountMinor as number) <= 0)) return null;
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") return null;
    return { type, payload };
  }
  if (type === "update_borrower") {
    if (!text(payload.borrowerId, 80) || !text(payload.fullName, 160)) return null;
    if (payload.phone !== undefined && payload.phone !== null && !text(payload.phone, 40)) return null;
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") return null;
    return { type, payload };
  }
  if (type === "archive_borrower") {
    if (!text(payload.borrowerId, 80)) return null;
    return { type, payload };
  }
  if (type === "update_loan_terms") {
    if (!text(payload.loanId, 80)) return null;
    if (!["none", "fixed", "percentage"].includes(String(payload.interestType))) return null;
    if (typeof payload.interestValue !== "number" || !Number.isFinite(payload.interestValue) || payload.interestValue < 0) return null;
    if (!["one_time", "monthly"].includes(String(payload.interestPeriod))) return null;
    if (!["one_time", "daily", "weekly", "monthly", "annual"].includes(String(payload.interestFrequency))) return null;
    if (payload.interestType === "none" && payload.interestValue !== 0) return null;
    return { type, payload };
  }
  if (type === "record_payment") {
    if (!text(payload.loanId, 80)) return null;
    if (!Number.isSafeInteger(payload.amountMinor) || (payload.amountMinor as number) <= 0) return null;
    if (!text(payload.paidAt, 40) || Number.isNaN(Date.parse(payload.paidAt))) return null;
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") return null;
    return { type, payload };
  }
  return null;
}

const SESSION_COOKIE = "lending_session";
const SESSION_SECONDS = 8 * 60 * 60;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function signSession(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

async function sessionCookie(secret: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = await signSession(payload, secret);
  return SESSION_COOKIE + "=" + payload + "." + signature + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + SESSION_SECONDS;
}

async function hasValidSession(request: Request, secret: string): Promise<boolean> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(SESSION_COOKIE + "="));
  if (!match) return false;
  const token = match.slice(SESSION_COOKIE.length + 1);
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = await signSession(payload, secret);
  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { exp?: number };
    return typeof decoded.exp === "number" && decoded.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

async function loginRateLimitState(request: Request, db: D1Database): Promise<{ limited: boolean; retryAfter: number }> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const ipHash = toBase64Url(new Uint8Array(digest));
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - LOGIN_WINDOW_SECONDS;
  const row = await db.prepare(
    "INSERT INTO login_rate_limits (ip_hash, window_started_at, attempts, updated_at) VALUES (?, ?, 1, ?) " +
    "ON CONFLICT(ip_hash) DO UPDATE SET " +
    "attempts = CASE WHEN login_rate_limits.window_started_at <= ? THEN 1 ELSE login_rate_limits.attempts + 1 END, " +
    "window_started_at = CASE WHEN login_rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE login_rate_limits.window_started_at END, " +
    "updated_at = excluded.updated_at RETURNING attempts, window_started_at"
  ).bind(ipHash, now, now, cutoff, cutoff).first<{ attempts: number; window_started_at: number }>();
  if (!row) throw new Error("Login rate limit could not be checked.");
  return {
    limited: row.attempts > LOGIN_ATTEMPT_LIMIT,
    retryAfter: Math.max(1, row.window_started_at + LOGIN_WINDOW_SECONDS - now)
  };
}

async function clearLoginRateLimit(request: Request, db: D1Database): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const ipHash = toBase64Url(new Uint8Array(digest));
  await db.prepare("DELETE FROM login_rate_limits WHERE ip_hash = ?").bind(ipHash).run();
}

function authCookie(clear = false): string {
  return clear ? SESSION_COOKIE + "=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" : "";
}
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

const supportedIntents: AssistantIntent[] = [
  "answer_question", "search_records", "prepare_action", "explain_report",
  "request_clarification", "unknown"
];

function extractJsonObject(value: string): unknown | null {
  const cleaned = value.replace(/^\uFEFF/, "").trim();
  const unfenced = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(unfenced); } catch { /* Fall through to balanced-object extraction. */ }

  const start = unfenced.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const char = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"' ) inString = false;
      continue;
    }
    if (char === '"' ) inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(unfenced.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function modelContentText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value.trim() : null;
  if (!Array.isArray(value)) return null;
  const parts = value.map(part => {
    if (typeof part === "string") return part;
    if (!isRecord(part)) return "";
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    return "";
  }).filter(part => part.length > 0);
  return parts.length > 0 ? parts.join("\\n").trim() || null : null;
}

function unwrapModelContent(raw: unknown): unknown {
  let candidate = raw;
  for (let depth = 0; depth < 5 && isRecord(candidate); depth++) {
    if ("response" in candidate) candidate = candidate.response;
    else if ("output_text" in candidate) candidate = candidate.output_text;
    else if ("output" in candidate) candidate = candidate.output;
    else if ("result" in candidate && isRecord(candidate.result)) candidate = candidate.result;
    else if (Array.isArray(candidate.choices)) {
      const firstChoice = candidate.choices[0];
      if (!isRecord(firstChoice)) break;
      if (isRecord(firstChoice.message) && "content" in firstChoice.message) {
        candidate = firstChoice.message.content;
      } else if ("text" in firstChoice) {
        candidate = firstChoice.text;
      } else if (isRecord(firstChoice.delta) && "content" in firstChoice.delta) {
        candidate = firstChoice.delta.content;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return candidate;
}

function unwrapModelOutput(raw: unknown): unknown {
  const candidate = unwrapModelContent(raw);
  const content = modelContentText(candidate);
  return content !== null ? extractJsonObject(content) : candidate;
}

export function parseAssistantOutput(raw: unknown): AssistantResponse | null {
  const candidate = unwrapModelOutput(raw);
  if (!isRecord(candidate) || !supportedIntents.includes(candidate.intent as AssistantIntent) ||
      !text(candidate.message, 4000) || !Array.isArray(candidate.proposedActions) ||
      typeof candidate.needsClarification !== "boolean") return null;
  let rawActions = candidate.proposedActions as unknown[];
  const borrowerAction = rawActions.find(item => isRecord(item) && ["create_borrower", "createBorrower", "register_borrower", "registerBorrower"].includes(String(item.type)));
  const loanAction = rawActions.find(item => isRecord(item) && ["create_loan", "createLoan"].includes(String(item.type)));
  if (borrowerAction && loanAction && isRecord(borrowerAction) && isRecord(loanAction) &&
      isRecord(borrowerAction.payload) && isRecord(loanAction.payload) &&
      ["PENDING_BORROWER_ID", "pending_borrower_id"].includes(String(loanAction.payload.borrowerId))) {
    const fullName = borrowerAction.payload.fullName ?? borrowerAction.payload.name;
    if (!text(fullName, 160)) return null;
    const combinedPayload: JsonObject = { ...loanAction.payload, borrowerFullName: fullName };
    if (text(borrowerAction.payload.phone, 40)) combinedPayload.phone = borrowerAction.payload.phone;
    delete combinedPayload.borrowerId;
    rawActions = rawActions.filter(item => item !== borrowerAction);
    rawActions = rawActions.map(item => item === loanAction ? { ...loanAction, payload: combinedPayload } : item);
  }
  const proposedActions = [];
  for (const item of rawActions) {
    if (!isRecord(item) || !text(item.type, 80) || !isRecord(item.payload) ||
        !text(item.summary, 1000) || item.requiresConfirmation !== true) return null;
    const validated = validateAction(item.type, item.payload);
    if (!validated) return null;
    proposedActions.push({ type: validated.type, payload: validated.payload, summary: item.summary, requiresConfirmation: true as const });
  }
  if (proposedActions.length > 3) return null;
  return { intent: candidate.intent as AssistantIntent, message: candidate.message, proposedActions, needsClarification: candidate.needsClarification };
}

function modelOutputDiagnostics(raw: unknown): JsonObject {
  const outer = isRecord(raw) ? raw : null;
  const choices = outer?.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : null;
  const message = isRecord(firstChoice) ? firstChoice.message : null;
  const messageContent = isRecord(message) ? message.content : null;
  const candidate = unwrapModelContent(raw);
  const content = modelContentText(candidate);
  return {
    outputType: Array.isArray(raw) ? "array" : typeof raw,
    outputKeys: outer ? Object.keys(outer).slice(0, 12) : [],
    choicesType: Array.isArray(choices) ? "array" : typeof choices,
    choicesLength: Array.isArray(choices) ? choices.length : null,
    firstChoiceType: Array.isArray(choices) ? (isRecord(firstChoice) ? "object" : typeof firstChoice) : null,
    firstChoiceKeys: isRecord(firstChoice) ? Object.keys(firstChoice).slice(0, 12) : [],
    messageType: message === null ? "null" : Array.isArray(message) ? "array" : typeof message,
    messageKeys: isRecord(message) ? Object.keys(message).slice(0, 12) : [],
    messageContentType: messageContent === null ? "null" : Array.isArray(messageContent) ? "array" : typeof messageContent,
    messageContentLength: typeof messageContent === "string" ? messageContent.length : null,
    candidateType: content !== null ? "string" : Array.isArray(candidate) ? "array" : typeof candidate,
    candidateLength: content !== null ? content.length : null
  };
}

function modelTextOutput(raw: unknown): string | null {
  const candidate = modelContentText(unwrapModelContent(raw));
  return candidate ? candidate.slice(0, 4000) : null;
}

function looksLikeStructuredModelOutput(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || /^\`\`\`(?:json)?\s*\{/i.test(trimmed);
}

function isPotentialWriteRequest(messages: AssistantMessage[]): boolean {
  const lastUser = [...messages].reverse().find(message => message.role === "user")?.content.trim() ?? "";
  if (!lastUser) return false;
  // Educational questions remain ordinary conversation even when they mention lending terms.
  if (/\b(paano|how\s+(?:do\s+i|to|can\s+i)|what\s+is|what\s+are|why|when|where|explain|ipaliwanag|ano\s+ang)\b/i.test(lastUser)) return false;

  const destructiveRequest = /\b(?:delete|erase|wipe|clear|burahin|tanggalin|alisin)\b/i.test(lastUser) && /\b(?:all|every|lahat|records?|record|data|borrowers?|loans?|payments?)\b/i.test(lastUser);
  if (destructiveRequest) return true;

  const explicitWrite = /\b(?:paki\s*(?:lista|record|save|add|create|register|enroll|update|archive)|(?:nagpautang|magpautang|nag[- ]?borrow|borrowed|i\s+(?:lend|lent|loaned)|umutang|nangutang|nag[- ]?loan|pinahiram)\s+(?:ako|si|ni|kay)?|(?:nagbayad|magbayad)\s+ako|(?:i[- ]?)?(?:record|save|add|create|register|enroll|update|archive)\s+(?:a\s+|ang\s+|ng\s+)?(?:new\s+)?(?:borrower|loan|payment|record)|register\s+(?!a\b|new\b)\w+|enroll\s+(?!a\b|new\b)\w+|add\s+.{1,80}\s+as\s+(?:a\s+)?borrower|itala\s+(?:ang\s+)?(?:bayad|payment)|ilista\s+(?:ang\s+)?(?:utang|loan|bayad))\b/i;
  if (explicitWrite.test(lastUser)) return true;

  // Carry an explicit owner approval forward only when the preceding assistant turn
  // was discussing a concrete write action; a bare "yes" must not create a record.
  const lastAssistant = [...messages].reverse().find(message => message.role === "assistant")?.content ?? "";
  const affirmative = /^(?:yes|yeah|yep|okay|ok|sige|oo|opo|go ahead|proceed|ituloy|gawin mo na|do it|save|i-save|isave|save it|register na)\b[.!\s]*$/i.test(lastUser);
  if (affirmative && /\b(?:register|create|add|save|record|update|archive|borrower|loan|payment)\b/i.test(lastAssistant)) return true;

  // A concise answer like "daily 3%" is a continuation when the assistant
  // just asked for missing loan terms after the owner described a borrowing event.
  const recent = messages.slice(-8);
  const priorLoanRequest = recent.some(message => message.role === "user" &&
    /\b(?:nangutang|umutang|nagpautang|pinahiram|borrowed|i\s+(?:lend|lent|loaned)|create\s+(?:a\s+)?loan|record\s+(?:a\s+)?loan)\b/i.test(message.content));
  const assistantAskedForTerms = /\b(?:interest|loan terms|interest type|interest value|interest period|repayment|payment schedule|paraan ng bayad|hulog|bayaran|daily|weekly|monthly)\b/i.test(lastAssistant) &&
    /[?؟]/.test(lastAssistant);
  const suppliesInterestTerm = /\b(?:daily|weekly|monthly|one[- ]?time|fixed|percentage|araw|linggo|buwan|kada\s+(?:araw|linggo|buwan))\b|\d+(?:\.\d+)?\s*%/i.test(lastUser);
  return priorLoanRequest && assistantAskedForTerms && suppliesInterestTerm;
}

export function isRecordLookupRequest(message: string): boolean {
  if (/\b(paano|how\s+(?:do\s+i|to|can\s+i)|what\s+is|what\s+are|why|explain|ipaliwanag|ano\s+ang)\b/i.test(message)) return false;
  return /\b(?:find|search|show|list|view|look\s*up|get|check|hanapin|pakita|ipakita|sino|nasaan|overview|summary|recent\s+payments|active\s+loans|borrower|borrowers|loan\s+records|payment\s+records|magkano|bayarin|balance|outstanding|total\s+due|amount\s+due|principal|interest\s+amount)\b/i.test(message);
}

export function isLendingOverviewRequest(message: string): boolean {
  return /\b(?:lending\s+overview|loan\s+overview|overview\s+of\s+(?:my\s+)?(?:lending|loans)|show\s+(?:my\s+)?(?:lending|loan)\s+overview)\b/i.test(message);
}

export function removeInterestClarificationFromOverview(message: string): string {
  return message
    .replace(/\s+(?:ano(?:\s+po)?\s+ang\s+napagkasunduan\s+niny[o]?\s+sa\s+interest|what\s+was\s+agreed\s+about\s+interest)\??\s*$/i, "")
    .trim();
}


function searchTermsFromMessages(messages: AssistantMessage[]): string[] {
  const ignored = new Set([
    "the", "and", "for", "with", "show", "find", "search", "list", "open", "please",
    "can", "you", "who", "what", "where", "when", "this", "that", "these", "those",
    "mga", "ang", "ng", "sa", "si", "sina", "kay", "para", "paki", "pakita", "hanapin",
    "sino", "ano", "nasaan", "lahat", "yung", "iyong", "akin", "ko", "mo", "po",
    "borrower", "borrowers", "loan", "loans", "payment", "payments", "record", "records"
  ]);
  const recentUserText = messages.filter(message => message.role === "user").slice(-4).reverse().map(message => message.content).join(" ");
  return [...new Set(recentUserText.normalize("NFC").match(/[\p{L}\p{N}-]{3,}/gu) ?? [])]
    .filter(term => !ignored.has(term.toLocaleLowerCase()))
    .slice(0, 8);
}

async function findTargetedRecords(db: D1Database, messages: AssistantMessage[]): Promise<JsonObject> {
  const terms = searchTermsFromMessages(messages);
  if (terms.length === 0) return { searched: false, reason: "No specific name or identifier was detected." };
  const predicates = terms.map(() => "instr(lower(CAST(search_value AS TEXT)), lower(?)) > 0").join(" OR ");
  const values = terms;
  const [borrowers, loans, payments] = await Promise.all([
    db.prepare(`SELECT id, full_name, phone FROM borrowers WHERE archived_at IS NULL AND (${predicates.replaceAll("search_value", "full_name")}) ORDER BY full_name LIMIT 10`).bind(...values).all(),
    db.prepare(`SELECT l.id, l.borrower_id, b.full_name AS borrower_name, l.principal_minor, l.currency, l.interest_type, l.interest_value, l.interest_period, l.interest_frequency, l.due_date, l.repayment_timing_note, l.repayment_frequency, l.installment_count, l.installment_amount_minor, l.status FROM loans l JOIN borrowers b ON b.id = l.borrower_id WHERE (${predicates.replaceAll("search_value", "b.full_name")}) OR ${terms.map(() => "instr(lower(l.id), lower(?)) > 0").join(" OR ")} ORDER BY l.created_at DESC LIMIT 10`).bind(...values, ...values).all(),
    db.prepare(`SELECT p.id, p.loan_id, b.full_name AS borrower_name, p.amount_minor, p.paid_at FROM payments p JOIN loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id WHERE (${predicates.replaceAll("search_value", "b.full_name")}) OR ${terms.map(() => "instr(lower(p.id), lower(?)) > 0 OR instr(lower(l.id), lower(?)) > 0").join(" OR ")} ORDER BY p.paid_at DESC LIMIT 10`).bind(...values, ...terms.flatMap(term => [term, term])).all()
  ]);
  return {
    searched: true,
    terms,
    borrowers: borrowers.results ?? [],
    loans: loans.results ?? [],
    payments: payments.results ?? []
  };
}

export function buildFinancialLookupReply(message: string, language: SupportedLanguage, targetedMatches: JsonObject): AssistantResponse | null {
  if (!/\b(?:magkano|bayarin|balance|outstanding|total\s+due|amount\s+due|how\s+much|payoff)\b/i.test(message)) return null;
  if (targetedMatches.searched !== true || !Array.isArray(targetedMatches.loans)) return null;
  const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const query = normalize(message);
  const matches = (targetedMatches.loans as unknown[]).filter((loan): loan is JsonObject =>
    isRecord(loan) && text(loan.borrower_name, 160) && query.includes(normalize(loan.borrower_name))
  );
  if (!matches.length) return null;
  const peso = (minor: number) => "₱" + (minor / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const interestLabel = (loan: JsonObject) => {
    if (loan.interest_type === "none") return "walang interest";
    const cadence = String(loan.interest_frequency ?? loan.interest_period ?? "unspecified");
    return loan.interest_type === "percentage"
      ? String(loan.interest_value) + "% " + cadence + " interest"
      : "fixed interest (stored value: " + String(loan.interest_value) + ")";
  };
  const english = language === "en" || /\b(?:how much|what is the amount|outstanding balance|total due)\b/i.test(message);
  if (matches.length > 1) {
    const lines = matches.slice(0, 5).map(loan =>
      "- " + String(loan.borrower_name) + ": principal " + peso(Number(loan.principal_minor)) + ", " + interestLabel(loan)
    );
    return {
      intent: "answer_question",
      message: english
        ? "I found more than one loan for this borrower. " + lines.join("\n") + "\nWhich loan do you mean?"
        : "May higit sa isang loan record para sa borrower na ito. " + lines.join("\n") + "\nAling loan po ang tinutukoy ninyo?",
      proposedActions: [], needsClarification: true
    };
  }
  const loan = matches[0];
  const principalMinor = Number(loan.principal_minor);
  if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0) return null;
  const payments = Array.isArray(targetedMatches.payments)
    ? (targetedMatches.payments as unknown[]).filter(payment => isRecord(payment) && payment.loan_id === loan.id)
    : [];
  const paymentText = payments.length
    ? (english
      ? (payments.length === 10 ? "At least 10 matching payment entries were found; the lookup shows recent matches only." : "I found " + payments.length + " matching recorded payment entry/entries.")
      : (payments.length === 10 ? "May hindi bababa sa 10 matching payment entries; recent matches lang ang ipinakita ng lookup." : "May " + payments.length + " matching recorded payment entry/entries na nakita."))
    : (english ? "No recorded payment was found in the matching records." : "Wala akong nakitang recorded payment sa matching records.");
  const timing = loan.due_date ? (english ? "Due date: " : "Takdang petsa: ") + String(loan.due_date) :
    loan.repayment_timing_note ? (english ? "Agreed timing: " : "Napag-usapang timing: ") + String(loan.repayment_timing_note) : "";
  const repayment = loan.repayment_frequency ? (english ? "Repayment schedule: " : "Paraan ng bayad: ") + String(loan.repayment_frequency) : "";
  return {
    intent: "answer_question",
    message: english
      ? "For " + String(loan.borrower_name) + ", the stored principal is " + peso(principalMinor) + " and the recorded interest terms are " + interestLabel(loan) + ". " + [timing, repayment, paymentText].filter(Boolean).join(" ") + " I can't state an exact total due or outstanding balance yet because the app's interest-calculation and payment-allocation rules have not been approved. The principal and interest terms above are the verified stored facts, not a calculated balance."
      : "Para kay " + String(loan.borrower_name) + ", ang naka-record na principal ay " + peso(principalMinor) + " at ang napagkasunduang interest ay " + interestLabel(loan) + ". " + [timing, repayment, paymentText].filter(Boolean).join(" ") + " Hindi ko pa maibibigay ang eksaktong kabuuang bayarin o outstanding balance dahil hindi pa aprubado ang interest-calculation at payment-allocation rules ng app. Ang principal at interest terms sa itaas ang verified na naka-save, hindi pa ito calculated balance.",
    proposedActions: [], needsClarification: false
  };
}

export function buildVerifiedLoanProposal(messages: AssistantMessage[], recordContext: JsonObject): AssistantResponse | null {
  if (recordContext.available !== true || !Array.isArray(recordContext.borrowers)) return null;
  const userText = messages.filter(message => message.role === "user").map(message => message.content).join("\n");
  const hasLoanEvent = /\b(?:nagpautang|pinautang|pinahiram|nangutang|borrowed|lent|loaned|lend)\b/i.test(userText);
  if (!hasLoanEvent) return null;

  const borrowers = recordContext.borrowers.filter((value): value is { id: string; full_name: string } =>
    isRecord(value) && text(value.id, 80) && text(value.full_name, 160)
  );
  const normalize = (value: string) => value.toLocaleLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedText = normalize(userText);
  const matches = borrowers.filter(borrower => {
    const name = normalize(borrower.full_name);
    return name.length > 0 && (" " + normalizedText + " ").includes(" " + name + " ");
  });
  if (matches.length > 1) return null;
  const nameMatch = userText.match(/\b(?:kay|si|ni)[ \t]+([\p{L}][\p{L}'’-]*(?:[ \t]+(?!ng\b|nang\b|na\b|ngayon\b|today\b|kahapon\b|yesterday\b|bukas\b|tomorrow\b)[\p{L}][\p{L}'’-]*){0,2})/iu);
  const borrowerName = matches.length === 1 ? matches[0].full_name : nameMatch?.[1]
    ?.replace(/\s+(?:ngayon|today|kahapon|yesterday|bukas|tomorrow)$/i, "").trim();
  if (!borrowerName) return null;

  const amountMatch = userText.match(/\b(?:nagpautang|pinautang|pinahiram|nangutang|borrowed|lent|loaned|lend)\b[\s\S]{0,120}?(?:ng|nang|for|of)?\s*(?:₱|php)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:pesos?|php)?/i);
  if (!amountMatch) return null;
  const principal = Number(amountMatch[1].replace(/,/g, ""));
  const principalMinor = Math.round(principal * 100);
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isSafeInteger(principalMinor)) return null;

  const noInterestMatch = [...userText.matchAll(/\b(?:walang\s+(?:interest|tubo)|interest[- ]?free|no\s+interest)\b/gi)].at(-1);
  const interestTermText = messages.map((message, index) => ({ message, index }))
    .filter(({ message, index }) => message.role === "user" && (
      /%|interest|tubo/i.test(message.content) ||
      /interest|interest type|interest period|interest frequency/i.test(
        [...messages.slice(0, index)].reverse().find(previous => previous.role === "assistant")?.content ?? ""
      )
    ))
    .map(({ message }) => message.content).join(" ");
  const percentMatches = [...userText.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
  const lastPercent = percentMatches.at(-1);
  const noInterest = Boolean(noInterestMatch && (!lastPercent || noInterestMatch.index! > lastPercent.index!));
  let interestType: "none" | "percentage" = "none";
  let interestValue = 0;
  let interestFrequency = "one_time";
  if (!noInterest) {
    if (!lastPercent) return null;
    interestType = "percentage";
    interestValue = Number(lastPercent[1]);
    if (!Number.isFinite(interestValue) || interestValue < 0) return null;
    const frequencyMatches = [
      { value: "one_time", regex: /\b(?:one[- ]?time|one[- ]?off|isang beses|isang hulog)\b/gi },
      { value: "daily", regex: /\b(?:daily|araw[- ]araw|kada araw)\b/gi },
      { value: "weekly", regex: /\b(?:weekly|lingguhan|kada linggo)\b/gi },
      { value: "monthly", regex: /\b(?:monthly|buwan(?:an)?|kada buwan)\b/gi },
      { value: "annual", regex: /\b(?:annually|annual|yearly|taunan|kada taon)\b/gi }
    ];
    const found = frequencyMatches.map(item => ({ value: item.value, index: [...interestTermText.matchAll(item.regex)].at(-1)?.index ?? -1 }))
      .filter(item => item.index >= 0).sort((a, b) => b.index - a.index);
    if (!found.length) return null;
    interestFrequency = found[0].value;
  }
  const repaymentTimingMatch = userText.match(/(?:sa susunod na linggo|next week|sa susunod na buwan|next month|bukas|tomorrow)/i);
  const explicitDateMatch = userText.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const dueDate = explicitDateMatch && isIsoDate(explicitDateMatch[1]) ? explicitDateMatch[1] : undefined;
  const lastUserTurn = [...messages].reverse().find(message => message.role === "user")?.content ?? "";
  const lastAssistantTurn = [...messages].reverse().find(message => message.role === "assistant")?.content ?? "";
  const assistantAskedRepayment = /repayment|payment schedule|paraan ng bayad|schedule ng bayad|hulog|bayaran/i.test(lastAssistantTurn);
  const repaymentFrequency =
    /(?:weekly payments|weekly hulog|kada linggo ang hulog|lingguhan ang bayad)/i.test(userText) ? "weekly" :
    /(?:daily payments|daily hulog|araw-araw ang hulog|kada araw ang bayad)/i.test(userText) ? "daily" :
    /(?:biweekly payments|biweekly hulog|kada dalawang linggo ang hulog)/i.test(userText) ? "biweekly" :
    /(?:monthly payments|monthly hulog|buwan-buwan ang hulog|kada buwan ang bayad)/i.test(userText) ? "monthly" :
    assistantAskedRepayment && /(?:one[- ]?time|single payment|lump[- ]?sum|isang bayaran|isang hulog|isang beses|buo ang bayad|full payment)/i.test(lastUserTurn) ? "one_time" :
    /(?:one[- ]?time payment|single payment|lump[- ]?sum|isang bayaran|isang hulog|buo ang bayad|full payment)/i.test(userText) ? "one_time" :
    null;
  // Interest cadence and repayment cadence are separate. Never reuse a bare
  // "one-time" interest answer as a repayment schedule.
  if (!repaymentFrequency) return null;
  const borrower = matches[0] ?? null;
  const interestDescription = interestType === "none" ? "walang interest" : interestValue + "% " + interestFrequency + " interest";
  const message = "Nakuha ko po. Ihahanda ko ang loan para kay " + borrowerName +
    ": ₱" + principal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
    " principal at " + interestDescription +
    (dueDate ? ", due date " + dueDate : repaymentTimingMatch ? ", napag-usapang bayaran: " + repaymentTimingMatch[0] : "") +
    ". Pakireview ang detalye bago i-save.";
  return {
    intent: "prepare_action",
    message,
    proposedActions: [{
      type: "create_loan",
      payload: {
        ...(borrower ? { borrowerId: borrower.id } : { borrowerFullName: borrowerName }),
        principalMinor,
        currency: "PHP",
        interestType,
        interestValue,
        interestPeriod: interestFrequency === "monthly" ? "monthly" : "one_time",
        interestFrequency,
        ...(dueDate ? { dueDate } : {}),
        ...(repaymentTimingMatch ? { repaymentTimingNote: repaymentTimingMatch[0] } : {}),
        repaymentFrequency
      },
      summary: (borrower ? "Gumawa ng loan record para kay " : "Irehistro si ") + borrowerName + (borrower ? " na may principal na ₱" : " bilang borrower at gumawa ng loan na ₱") +
        principal.toLocaleString("en-PH", { maximumFractionDigits: 2 }) + " at " + interestDescription,
      requiresConfirmation: true
    }],
    needsClarification: false
  };
}

async function assistantReply(request: Request, env: Env): Promise<Response> {
  if (!env.AI) return json({ error: "AI service is not configured." }, 503);
  const body = await readJson(request);
  if (!isRecord(body) || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
    return json({ error: "Provide between 1 and 20 conversation messages." }, 400);
  }

  const messages: AssistantMessage[] = [];
  let totalMessageCharacters = 0;
  for (const item of body.messages) {
    if (!isRecord(item) || item.role !== "user" && item.role !== "assistant" || !text(item.content, 4000)) {
      return json({ error: "Each message must have a valid role and non-empty content up to 4000 characters." }, 400);
    }
    totalMessageCharacters += item.content.length;
    if (totalMessageCharacters > 12000) {
      return json({ error: "Keep the combined conversation context under 12000 characters." }, 400);
    }
    messages.push({ role: item.role, content: item.content });
  }
  if (messages[messages.length - 1].role !== "user") {
    return json({ error: "The last conversation message must be from the user." }, 400);
  }

  const language: SupportedLanguage =
    body.language === "en" || body.language === "tl" || body.language === "tl-en" ? body.language : "tl-en";
  const lastUserMessage = messages[messages.length - 1].content;
  const transactionState = buildTransactionConversationState(messages);
  if (transactionState.cancelled) {
    return json({
      intent: "answer_question",
      message: language === "en"
        ? "Understood. I won't proceed with that transaction. No records were changed."
        : "Sige po, hindi ko itutuloy ang transaction. Walang binago sa records.",
      proposedActions: [],
      needsClarification: false
    });
  }
  const needsRecordContext = isPotentialWriteRequest(messages) || isRecordLookupRequest(lastUserMessage);
  let recordContext: JsonObject = {
    available: false,
    note: needsRecordContext
      ? "Verified record context has not been loaded. Do not guess or claim to have searched records."
      : "No database lookup was needed for this conversational request."
  };
  let targetedMatches: JsonObject = { searched: false, reason: "No record lookup was needed for this conversational request." };
  if (needsRecordContext) {
    try {
      const [borrowerRows, loanRows, paymentRows] = await Promise.all([
        env.DB.prepare("SELECT id, full_name, phone FROM borrowers WHERE archived_at IS NULL ORDER BY full_name LIMIT 30").all<{ id: string; full_name: string }>(),
        env.DB.prepare("SELECT l.id, l.borrower_id, b.full_name AS borrower_name, l.principal_minor, l.currency, l.interest_type, l.interest_value, l.interest_period, l.interest_frequency, l.due_date, l.repayment_timing_note, l.repayment_frequency, l.installment_count, l.installment_amount_minor, l.status FROM loans l JOIN borrowers b ON b.id = l.borrower_id ORDER BY l.created_at DESC LIMIT 30").all<Record<string, unknown>>(),
        env.DB.prepare("SELECT p.id, p.loan_id, b.full_name AS borrower_name, p.amount_minor, p.paid_at FROM payments p JOIN loans l ON l.id = p.loan_id JOIN borrowers b ON b.id = l.borrower_id ORDER BY p.paid_at DESC LIMIT 30").all<Record<string, unknown>>()
      ]);
      recordContext = { available: true, borrowers: borrowerRows.results ?? [], loans: loanRows.results ?? [], recentPayments: paymentRows.results ?? [] };
    } catch {
      recordContext = { available: false, note: "Verified records are temporarily unavailable. Do not guess or claim to have searched them." };
    }
    try {
      targetedMatches = await findTargetedRecords(env.DB, messages);
    } catch {
      targetedMatches = { searched: false, reason: "Targeted record search is temporarily unavailable." };
    }
  }
  const financialLookupReply = buildFinancialLookupReply(lastUserMessage, language, targetedMatches);
  if (financialLookupReply) return json(financialLookupReply);
  const systemPrompt = buildLendingAssistantSystemPrompt({ language, recordContext, targetedMatches }) +
    "\n\nTRANSACTION CONVERSATION STATE: " + JSON.stringify({
      status: transactionState.status,
      carriesTransactionContext: transactionState.carriesTransactionContext,
      instruction: transactionState.instruction
    });

  const requestId = crypto.randomUUID();
  try {
    const modelResult = await runLendingAssistantModel(env.AI, systemPrompt, messages);
    let parsed = parseAssistantOutput(modelResult);

    // Plain text is safe to accept only for non-transactional conversation.
    // Requests that may create or change lending records must return the
    // structured schema and continue through backend validation/confirmation.
    const firstPlainText = modelTextOutput(modelResult);
    if (!parsed && firstPlainText && !looksLikeStructuredModelOutput(firstPlainText) && !isPotentialWriteRequest(messages)) {
      return json({
        intent: "answer_question",
        message: isLendingOverviewRequest(lastUserMessage) ? removeInterestClarificationFromOverview(firstPlainText) : firstPlainText,
        proposedActions: [],
        needsClarification: false
      });
    }

    let retryAttempted = false;
    let diagnosticOutput = modelResult;
    if (!parsed) {
      retryAttempted = true;
      const retryPrompt = systemPrompt + " IMPORTANT FORMAT RETRY: Your previous response did not match the required schema. Answer the user's original request again. Return exactly one valid JSON object with all four required keys: intent, message, proposedActions, needsClarification. Do not include Markdown, explanations, or text outside JSON. For ordinary conversation use intent answer_question and proposedActions []. For any lending action, include only a fully specified proposal and set requiresConfirmation to true. If details are missing, ask a clarification question and propose no action. Never claim that a record was saved.";
      diagnosticOutput = await runLendingAssistantModel(env.AI, retryPrompt, messages);
      parsed = parseAssistantOutput(diagnosticOutput);
      const retryPlainText = modelTextOutput(diagnosticOutput);
      if (!parsed && retryPlainText && !looksLikeStructuredModelOutput(retryPlainText) && !isPotentialWriteRequest(messages)) {
        return json({
          intent: "answer_question",
          message: isLendingOverviewRequest(lastUserMessage) ? removeInterestClarificationFromOverview(retryPlainText) : retryPlainText,
          proposedActions: [],
          needsClarification: false
        });
      }
    }

    const verifiedLoanProposal = isPotentialWriteRequest(messages)
      ? buildVerifiedLoanProposal(messages, recordContext)
      : null;
    const incompleteRepaymentProposal = parsed?.proposedActions.some(action =>
      action.type === "create_loan" &&
      !["one_time", "daily", "weekly", "biweekly", "monthly"].includes(String(action.payload.repaymentFrequency))
    );
    if (incompleteRepaymentProposal) {
      if (verifiedLoanProposal) return json(verifiedLoanProposal);
      return json({
        intent: "request_clarification",
        message: language === "en"
          ? "What repayment schedule did you agree on: one payment, daily, weekly, every two weeks, or monthly? This is separate from how often interest is charged."
          : "Ano po ang napagkasunduang paraan ng bayad: isang bayaran, araw-araw, lingguhan, kada dalawang linggo, o buwan-buwan? Iba po ito sa dalas ng pag-charge ng interest.",
        proposedActions: [],
        needsClarification: true
      });
    }
    if (verifiedLoanProposal && (!parsed || parsed.proposedActions.length === 0 && parsed.needsClarification ||
      parsed.proposedActions.length > 0 && parsed.proposedActions.every(action => action.type === "create_borrower"))) {
      return json(verifiedLoanProposal);
    }

    if (!parsed) {
      console.error("[assistant] invalid_model_response", JSON.stringify({ requestId, model: "@cf/google/gemma-4-26b-a4b-it", retryAttempted, ...modelOutputDiagnostics(diagnosticOutput) }));
      if (isPotentialWriteRequest(messages)) {
        return json({
          intent: "request_clarification",
          message: "Pasensya na po, hindi ko naihanda nang maayos ang action kaya wala akong babaguhin sa records. Pakiulit ang request kasama ang pangalan o record details para ma-review ko ito nang tama.",
          proposedActions: [],
          needsClarification: true
        });
      }
      return json({ error: "AI assistant could not format a response. Please try again.", requestId }, 502);
    }
    if (isLendingOverviewRequest(lastUserMessage) && parsed.intent === "answer_question" && parsed.proposedActions.length === 0) {
      parsed.message = removeInterestClarificationFromOverview(parsed.message);
    }
    return json(parsed);
  } catch (error) {
    console.error("[assistant] model_request_failed", JSON.stringify({ requestId, errorName: error instanceof Error ? error.name : "UnknownError" }));
    return json({ error: "AI assistant is temporarily unavailable. You can still use the regular app controls.", requestId }, 503);
  }
}

async function prepareAction(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) return json({ error: "Expected a JSON object." }, 400);
  const action = validateAction(body.type, body.payload);
  if (!action) return json({ error: "Invalid action type or payload." }, 400);

  if (action.type === "create_loan" && text(action.payload.borrowerFullName, 160)) {
    const matches = await env.DB.prepare(
      "SELECT id, full_name FROM borrowers WHERE archived_at IS NULL AND (lower(full_name) = lower(?) OR (? IS NOT NULL AND phone = ?)) ORDER BY full_name LIMIT 5"
    ).bind(action.payload.borrowerFullName, action.payload.phone ?? null, action.payload.phone ?? null).all<{ id: string; full_name: string }>();
    if ((matches.results ?? []).length > 1) {
      return json({ error: "More than one borrower has that name. Choose the correct existing borrower before saving.", matches: matches.results }, 409);
    }
    if ((matches.results ?? []).length === 1) {
      action.payload.borrowerId = matches.results![0].id;
      delete action.payload.borrowerFullName;
    }
  }

  // Prevent accidental duplicate borrower profiles before creating a pending action.
  if (action.type === "create_borrower") {
    const phone = action.payload.phone ?? null;
    const existing = await env.DB.prepare(
      "SELECT id, full_name, phone FROM borrowers WHERE archived_at IS NULL AND (lower(full_name) = lower(?) OR (? IS NOT NULL AND phone = ?)) ORDER BY full_name LIMIT 5"
    ).bind(action.payload.fullName, phone, phone).all<{ id: string; full_name: string; phone: string | null }>();
    if ((existing.results ?? []).length > 0) {
      return json({
        error: "A matching borrower already exists. Use the existing borrower record instead of creating a duplicate.",
        matches: existing.results
      }, 409);
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO pending_actions (id, action_type, payload_json, status, expires_at) VALUES (?, ?, ?, 'pending', datetime('now', '+15 minutes'))"
  ).bind(id, action.type, JSON.stringify(action.payload)).run();

  return json({
    actionId: id,
    status: "pending_confirmation",
    expiresInMinutes: 15,
    message: "Review the details, then explicitly confirm this action."
  }, 201);
}

async function cancelPendingAction(actionId: string, env: Env): Promise<Response> {
  const cancelled = await env.DB.prepare(
    "UPDATE pending_actions SET status = 'rejected' WHERE id = ? AND status = 'pending' AND expires_at > datetime('now') RETURNING action_type"
  ).bind(actionId).first<{ action_type: string }>();

  if (!cancelled) {
    const existing = await env.DB.prepare(
      "SELECT status, expires_at FROM pending_actions WHERE id = ?"
    ).bind(actionId).first<{ status: string; expires_at: string }>();
    if (!existing) return json({ error: "Action not found." }, 404);
    if (existing.status === "pending" && Date.parse(existing.expires_at.replace(" ", "T") + "Z") <= Date.now()) {
      await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ? AND status = 'pending'")
        .bind(actionId).run();
      return json({ error: "This review expired. Prepare a fresh action if you still want to proceed.", status: "expired" }, 409);
    }
    return json({ error: "This action is no longer awaiting approval.", status: existing.status }, 409);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details_json) VALUES (?, 'owner', 'cancel_pending_action', 'pending_action', ?, ?)"
    ).bind(crypto.randomUUID(), actionId, JSON.stringify({ actionType: cancelled.action_type })).run();
  } catch {
    console.error("[actions] cancellation_audit_failed", JSON.stringify({ actionId }));
  }
  return json({ actionId, status: "cancelled", message: "The pending action was cancelled. No lending record was changed." });
}

async function confirmAction(actionId: string, env: Env): Promise<Response> {
  const claim = await env.DB.prepare(
    "UPDATE pending_actions SET status = 'confirming' WHERE id = ? AND status = 'pending' AND expires_at > datetime('now') RETURNING action_type, payload_json"
  ).bind(actionId).first<{ action_type: ActionType; payload_json: string }>();

  if (!claim) {
    const existing = await env.DB.prepare(
      "SELECT status FROM pending_actions WHERE id = ?"
    ).bind(actionId).first<{ status: string }>();
    return json({ error: existing ? "This action is expired or has already been used." : "Action not found." }, existing ? 409 : 404);
  }

  const payload = JSON.parse(claim.payload_json) as JsonObject;
  let entityId: string = crypto.randomUUID();
  const now = new Date().toISOString();
  let createdBorrowerId: string | null = null;

  try {
    let statement: D1PreparedStatement;
    let entityType: string;
    const additionalStatements: D1PreparedStatement[] = [];

    if (claim.action_type === "create_borrower") {
      entityType = "borrower";
      statement = env.DB.prepare(
        "INSERT INTO borrowers (id, full_name, phone, notes) VALUES (?, ?, ?, ?)"
      ).bind(entityId, payload.fullName, payload.phone ?? null, payload.notes ?? null);
    } else if (claim.action_type === "update_borrower" || claim.action_type === "archive_borrower") {
      entityType = "borrower";
      entityId = String(payload.borrowerId);
      const borrower = await env.DB.prepare("SELECT id FROM borrowers WHERE id = ? AND archived_at IS NULL")
        .bind(entityId).first<{ id: string }>();
      if (!borrower) {
        await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").bind(actionId).run();
        return json({ error: "Borrower not found or already archived. No change was made." }, 404);
      }
      statement = claim.action_type === "update_borrower"
        ? env.DB.prepare("UPDATE borrowers SET full_name = ?, phone = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(payload.fullName, payload.phone ?? null, payload.notes ?? null, entityId)
        : env.DB.prepare("UPDATE borrowers SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(entityId);
    } else if (claim.action_type === "update_loan_terms") {
      entityType = "loan";
      entityId = String(payload.loanId);
      const loan = await env.DB.prepare("SELECT id FROM loans WHERE id = ? AND status = 'active'").bind(entityId).first<{ id: string }>();
      if (!loan) {
        await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").bind(actionId).run();
        return json({ error: "Active loan not found. No terms were changed." }, 404);
      }
      statement = env.DB.prepare("UPDATE loans SET interest_type = ?, interest_value = ?, interest_period = ?, interest_frequency = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(payload.interestType, payload.interestValue, payload.interestPeriod, payload.interestFrequency, entityId);
    } else if (claim.action_type === "create_loan") {
      entityType = "loan";
      let borrowerId = text(payload.borrowerId, 80) ? payload.borrowerId : null;
      if (text(payload.borrowerFullName, 160)) {
        const existing = await env.DB.prepare(
          "SELECT id, full_name FROM borrowers WHERE archived_at IS NULL AND (lower(full_name) = lower(?) OR (? IS NOT NULL AND phone = ?)) ORDER BY full_name LIMIT 3"
        ).bind(payload.borrowerFullName, payload.phone ?? null, payload.phone ?? null).all<{ id: string; full_name: string }>();
        if ((existing.results ?? []).length > 1) {
          await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").bind(actionId).run();
          return json({ error: "More than one borrower matches these details. Please review the borrower before saving.", matches: existing.results }, 409);
        }
        if ((existing.results ?? []).length === 1) {
          borrowerId = existing.results![0].id;
        } else {
          createdBorrowerId = crypto.randomUUID();
          borrowerId = createdBorrowerId;
          additionalStatements.push(env.DB.prepare(
            "INSERT INTO borrowers (id, full_name, phone, notes) VALUES (?, ?, ?, ?)"
          ).bind(createdBorrowerId, payload.borrowerFullName, payload.phone ?? null, null));
        }
      } else if (borrowerId) {
        const borrower = await env.DB.prepare("SELECT id FROM borrowers WHERE id = ? AND archived_at IS NULL")
          .bind(borrowerId).first<{ id: string }>();
        if (!borrower) {
          await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").bind(actionId).run();
          return json({ error: "Borrower not found or archived. No loan was created." }, 404);
        }
      }
      if (!borrowerId) throw new Error("Loan borrower is missing.");
      statement = env.DB.prepare(
        "INSERT INTO loans (id, borrower_id, principal_minor, currency, interest_type, interest_value, interest_period, notes, due_date, repayment_timing_note, repayment_frequency, installment_count, installment_amount_minor, interest_frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(entityId, borrowerId, payload.principalMinor, payload.currency ?? "PHP", payload.interestType, payload.interestValue, payload.interestPeriod, payload.notes ?? null, payload.dueDate ?? null, payload.repaymentTimingNote ?? null, payload.repaymentFrequency ?? "one_time", payload.installmentCount ?? null, payload.installmentAmountMinor ?? null, payload.interestFrequency ?? payload.interestPeriod);
    } else {
      entityType = "payment";
      const loan = await env.DB.prepare("SELECT id FROM loans WHERE id = ? AND status = 'active'")
        .bind(payload.loanId).first<{ id: string }>();
      if (!loan) {
        await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").bind(actionId).run();
        return json({ error: "Active loan not found. No payment was recorded." }, 404);
      }
      statement = env.DB.prepare(
        "INSERT INTO payments (id, loan_id, amount_minor, paid_at, notes) VALUES (?, ?, ?, ?, ?)"
      ).bind(entityId, payload.loanId, payload.amountMinor, payload.paidAt, payload.notes ?? null);
    }

    const auditStatements = createdBorrowerId
      ? [env.DB.prepare(
          "INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details_json) VALUES (?, 'owner', 'create_borrower', 'borrower', ?, ?)"
        ).bind(crypto.randomUUID(), createdBorrowerId, JSON.stringify({ fullName: payload.borrowerFullName, phone: payload.phone ?? null }))]
      : [];
    await env.DB.batch([
      ...additionalStatements,
      statement,
      ...auditStatements,
      env.DB.prepare(
        "INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details_json) VALUES (?, 'owner', ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), claim.action_type, entityType, entityId, JSON.stringify(payload)),
      env.DB.prepare(
        "UPDATE pending_actions SET status = 'confirmed', result_entity_id = ?, confirmed_at = ? WHERE id = ? AND status = 'confirming'"
      ).bind(entityId, now, actionId)
    ]);

    return json({ actionId, status: "confirmed", entityType, entityId, borrowerId: createdBorrowerId, borrowerCreated: Boolean(createdBorrowerId) }, 201);
  } catch {
    await env.DB.prepare("UPDATE pending_actions SET status = 'failed' WHERE id = ? AND status = 'confirming'").bind(actionId).run();
    return json({ error: "Could not save the confirmed action. Check records before retrying." }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "ai-workspace-api" });
    }

    if (!env.OWNER_API_TOKEN) return json({ error: "Service is not configured." }, 503);
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return json({ error: "Invalid request origin." }, 403);
      const body = await readJson(request);
      if (!isRecord(body) || !text(body.password, 512)) return json({ error: "Enter your owner passphrase." }, 400);
      let rateLimit: { limited: boolean; retryAfter: number };
      try {
        rateLimit = await loginRateLimitState(request, env.DB);
      } catch {
        return json({ error: "Login protection is temporarily unavailable. Please try again shortly." }, 503);
      }
      if (rateLimit.limited) {
        return new Response(JSON.stringify({ error: "Too many login attempts. Please wait before trying again." }), {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(rateLimit.retryAfter), "x-content-type-options": "nosniff" }
        });
      }
      const supplied = new TextEncoder().encode(body.password);
      const expected = new TextEncoder().encode(env.OWNER_API_TOKEN);
      let mismatch = supplied.length ^ expected.length;
      for (let i = 0; i < Math.max(supplied.length, expected.length); i++) mismatch |= (supplied[i] ?? 0) ^ (expected[i] ?? 0);
      if (mismatch !== 0) return json({ error: "Incorrect owner passphrase." }, 401);
      try {
        await clearLoginRateLimit(request, env.DB);
      } catch {
        return json({ error: "Login protection is temporarily unavailable. Please try again shortly." }, 503);
      }
      return new Response(JSON.stringify({ authenticated: true, expiresInSeconds: SESSION_SECONDS }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": await sessionCookie(env.OWNER_API_TOKEN), "x-content-type-options": "nosniff" }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "set-cookie": authCookie(true) }
      });
    }

    const bearerAuthorized = request.headers.get("authorization") === `Bearer ${env.OWNER_API_TOKEN}`;
    const cookieAuthorized = await hasValidSession(request, env.OWNER_API_TOKEN);
    if (!bearerAuthorized && !cookieAuthorized) return json({ error: "Unauthorized" }, 401);
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && (origin && origin !== url.origin || cookieAuthorized && origin !== url.origin)) {
      return json({ error: "Invalid request origin." }, 403);
    }
    if (request.method === "GET" && url.pathname === "/api/auth/session") return json({ authenticated: true, expiresInSeconds: SESSION_SECONDS });

    if (request.method === "GET" && url.pathname === "/api") {
      return json({ service: "lending-assistant-api", status: "transactions-enabled", ai: "enabled-when-configured" });
    }

    if (request.method === "POST" && url.pathname === "/api/assistant") {
      return assistantReply(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/admin/delete-all") {
      const body = await readJson(request);
      if (!isRecord(body) || !text(body.password, 512)) return json({ error: "Enter your owner password to continue." }, 400);
      let rateLimit: { limited: boolean; retryAfter: number };
      try { rateLimit = await loginRateLimitState(request, env.DB); }
      catch { return json({ error: "Password protection is temporarily unavailable. Please try again." }, 503); }
      if (rateLimit.limited) return new Response(JSON.stringify({ error: "Too many password attempts. Please wait before trying again." }), {
        status: 429, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(rateLimit.retryAfter), "x-content-type-options": "nosniff" }
      });
      const supplied = new TextEncoder().encode(body.password);
      const expected = new TextEncoder().encode(env.OWNER_API_TOKEN);
      let mismatch = supplied.length ^ expected.length;
      for (let i = 0; i < Math.max(supplied.length, expected.length); i++) mismatch |= (supplied[i] ?? 0) ^ (expected[i] ?? 0);
      if (mismatch !== 0) return json({ error: "Incorrect owner password. No records were deleted." }, 401);
      try {
        const [borrowers, loans, payments] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS count FROM borrowers").first<{ count: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM loans").first<{ count: number }>(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM payments").first<{ count: number }>()
        ]);
        const counts = { borrowers: borrowers?.count ?? 0, loans: loans?.count ?? 0, payments: payments?.count ?? 0 };
        await clearLoginRateLimit(request, env.DB);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM payments"),
          env.DB.prepare("DELETE FROM loans"),
          env.DB.prepare("DELETE FROM borrowers"),
          env.DB.prepare("DELETE FROM pending_actions"),
          env.DB.prepare("INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details_json) VALUES (?, 'owner', 'delete_all_records', 'workspace', 'all', ?)")
            .bind(crypto.randomUUID(), JSON.stringify({ deleted: counts, auditHistoryRetained: true }))
        ]);
        return json({ status: "deleted", deleted: counts, auditHistoryRetained: true });
      } catch {
        return json({ error: "Bulk deletion failed. Check the records before trying again." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/actions/prepare") {
      return prepareAction(request, env);
    }

    const cancelMatch = url.pathname.match(/^\/api\/actions\/([0-9a-f-]+)\/cancel$/i);
    if (request.method === "POST" && cancelMatch) return cancelPendingAction(cancelMatch[1], env);

    const confirmMatch = url.pathname.match(/^\/api\/actions\/([0-9a-f-]+)\/confirm$/i);
    if (request.method === "POST" && confirmMatch) return confirmAction(confirmMatch[1], env);

    if (request.method === "GET" && url.pathname === "/api/reports/payments") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
      if (!validDate(from) || !validDate(to) || from > to) return json({ error: "Provide a valid date range using YYYY-MM-DD." }, 400);
      const rows = await env.DB.prepare("SELECT date(paid_at) AS day, COUNT(*) AS payment_count, COALESCE(SUM(amount_minor), 0) AS total_minor FROM payments WHERE date(paid_at) >= date(?) AND date(paid_at) <= date(?) GROUP BY date(paid_at) ORDER BY day").bind(from, to).all<{ day: string; payment_count: number; total_minor: number }>();
      const daily = rows.results ?? [];
      return json({ from, to, paymentCount: daily.reduce((sum, row) => sum + row.payment_count, 0), totalMinor: daily.reduce((sum, row) => sum + row.total_minor, 0), byDay: daily });
    }
    const collections: Record<string, string> = {
      "/api/borrowers": "SELECT id, full_name, phone, notes, created_at, updated_at FROM borrowers WHERE archived_at IS NULL ORDER BY full_name",
      "/api/loans": "SELECT id, borrower_id, principal_minor, currency, interest_type, interest_value, interest_period, interest_frequency, due_date, repayment_timing_note, repayment_frequency, installment_count, installment_amount_minor, status, notes, created_at FROM loans ORDER BY created_at DESC",
      "/api/payments": "SELECT id, loan_id, amount_minor, paid_at, notes, created_at FROM payments ORDER BY paid_at DESC",
      "/api/activity": "SELECT id, action, entity_type, entity_id, details_json, created_at FROM audit_log ORDER BY created_at DESC LIMIT 100"
    };
    if (request.method === "GET" && collections[url.pathname]) {
      const result = await env.DB.prepare(collections[url.pathname]).all();
      return json({ results: result.results ?? [] });
    }

    return json({ error: "Not found" }, 404);
  }
};