import { describe, expect, it } from "vitest";
import { buildAiErrorDiagnostics } from "../workers/api/src/ai-diagnostics";

const context = {
  requestId: "req-123",
  model: "@cf/google/gemma-4-26b-a4b-it",
  maxTokens: 2400,
  enableThinking: false,
  systemPromptLength: 12000,
  messageCount: 2,
  totalMessageCharacters: 120
};

describe("AI error diagnostics", () => {
  it("records safe invocation metadata and a bounded error message", () => {
    const error = new Error("Workers AI request failed with status 503");
    Object.assign(error, { status: 503 });
    expect(buildAiErrorDiagnostics(error, context)).toMatchObject({
      ...context,
      errorName: "Error",
      errorMessage: "Workers AI request failed with status 503",
      errorStatus: 503
    });
  });

  it("redacts email addresses, Philippine phone numbers, and bearer tokens", () => {
    const error = new Error("contact user@example.com or 09171234567; bearer abc.def.ghi");
    const result = buildAiErrorDiagnostics(error, context);
    expect(result.errorMessage).not.toContain("user@example.com");
    expect(result.errorMessage).not.toContain("09171234567");
    expect(result.errorMessage).not.toContain("abc.def.ghi");
    expect(result.errorMessage).toContain("[email]");
    expect(result.errorMessage).toContain("[phone]");
    expect(result.errorMessage).toContain("[redacted]");
  });

  it("redacts labelled borrower and financial fields", () => {
    const error = new Error("borrower name: Maria Santos, PHP 12,500");
    const result = buildAiErrorDiagnostics(error, context);
    expect(result.errorMessage).not.toContain("Maria Santos");
    expect(result.errorMessage).not.toContain("12,500");
  });

  it("does not include stack traces or arbitrary error properties", () => {
    const error = new Error("failure");
    Object.assign(error, { stack: "private stack", headers: { authorization: "secret" } });
    const result = buildAiErrorDiagnostics(error, context);
    expect(result).not.toHaveProperty("stack");
    expect(result).not.toHaveProperty("headers");
  });

  it("truncates long messages to 200 characters", () => {
    const result = buildAiErrorDiagnostics(new Error("x".repeat(300)), context);
    expect(result.errorMessage.length).toBe(200);
  });

  it("handles non-Error values without throwing", () => {
    expect(buildAiErrorDiagnostics("failed", context)).toMatchObject({
      errorName: "UnknownError",
      errorMessage: "failed",
      errorStatus: null
    });
  });
});
