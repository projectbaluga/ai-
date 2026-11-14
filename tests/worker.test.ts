import { describe, expect, it } from "vitest";
import worker from "../workers/api/src/index";

const env = {
  DB: {} as D1Database,
  OWNER_API_TOKEN: "test-secret"
};

describe("API worker", () => {
  it("provides a public health endpoint", async () => {
    const response = await worker.fetch(new Request("https://example.test/health"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "ai-workspace-api" });
  });

  it("protects API routes", async () => {
    const response = await worker.fetch(new Request("https://example.test/api"), env);
    expect(response.status).toBe(401);
  });

  it("rejects unknown authenticated routes", async () => {
    const request = new Request("https://example.test/unknown", {
      headers: { authorization: "Bearer test-secret" }
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(404);
  });

  it("rejects invalid prepared actions without touching the database", async () => {
    const request = new Request("https://example.test/api/actions/prepare", {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({ type: "record_payment", payload: { loanId: "", amountMinor: -5, paidAt: "not-a-date" } })
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
  });
});
