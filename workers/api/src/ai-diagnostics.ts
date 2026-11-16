type DiagnosticContext = {
  requestId: string;
  model: string;
  maxTokens: number;
  enableThinking: boolean;
  systemPromptLength: number;
  messageCount: number;
  totalMessageCharacters: number;
  latencyMs?: number;
  retryCount?: number;
};

function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?63|0)\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g, "[phone]")
    .replace(/\b(?:bearer\s+)[A-Z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b(borrower(?:\s+name)?|full[_ -]?name|phone|email)\b\s*[:=]\s*[^,;]+/gi, "$1=[redacted]")
    .replace(/\bPHP\s*[\d,]+(?:\.\d{1,2})?\b/gi, "[amount]")
    .replace(/\b[A-Z0-9+/=_-]{24,}\b/g, "[redacted]")
    // Avoid leaking raw provider failure phrases into logs
    .replace(/\bprovider unavailable\b/gi, "[provider error]")
    .slice(0, 200);
}

export function buildAiErrorDiagnostics(error: unknown, context: DiagnosticContext) {
  const record = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : null;
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Unknown AI invocation error";
  const status = record?.["status"];

  return {
    ...context,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: sanitizeErrorMessage(rawMessage),
    errorStatus: typeof status === "number" && Number.isFinite(status) ? status : null
  };
}
