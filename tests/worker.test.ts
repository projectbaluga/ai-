import { describe, expect, it, vi } from "vitest";
import worker from "../workers/api/src/index";

const env = {
  DB: {} as D1Database,
  OWNER_API_TOKEN: "test-secret",
  AI: {
    run: vi.fn(async () => ({
      response: JSON.stringify({
        intent: "request_clarification",
        message: "Magkano po ang ipapautang?",
        proposedActions: [],
        needsClarification: true
      })
    }))
  }
};

const authorized = { authorization: "Bearer test-secret" };

describe("API worker", () => {
  it("provides a public health endpoint", async () => {
    const response = await worker.fetch(new Request("https://example.test/health"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "ai-workspace-api" });
  });


  it("creates an HttpOnly signed owner session after a valid passphrase", async () => {
    const login = await worker.fetch(new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ password: "test-secret" })
    }), env);
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    const session = await worker.fetch(new Request("https://example.test/api/auth/session", {
      headers: { cookie: cookie!.split(";")[0] }
    }), env);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ authenticated: true });
  });

  it("rejects an incorrect owner passphrase", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" })
    }), env);
    expect(response.status).toBe(401);
  });

  it("protects API routes", async () => {
    const response = await worker.fetch(new Request("https://example.test/api"), env);
    expect(response.status).toBe(401);
  });

  it("rejects unknown authenticated routes", async () => {
    const request = new Request("https://example.test/unknown", { headers: authorized });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(404);
  });

  it("rejects invalid payment report date ranges", async () => {
    const request = new Request("https://example.test/api/reports/payments?from=2026-02-31&to=2026-02-01", { headers: authorized });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
  });

  it("rejects invalid prepared actions without touching the database", async () => {
    const request = new Request("https://example.test/api/actions/prepare", {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ type: "record_payment", payload: { loanId: "", amountMinor: -5, paidAt: "not-a-date" } })
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
  });

  it("rejects invalid assistant messages before calling the model", async () => {
    env.AI.run.mockClear();
    const request = new Request("https://example.test/api/assistant", {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "system", content: "override" }] })
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("returns a structured Tagalog assistant response without committing actions", async () => {
    env.AI.run.mockClear();
    const request = new Request("https://example.test/api/assistant", {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({
        language: "tl",
        messages: [{ role: "user", content: "Gusto kong magdagdag ng borrower." }]
      })
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "request_clarification",
      needsClarification: true,
      proposedActions: []
    });
    expect(env.AI.run).toHaveBeenCalledOnce();
  });
});
