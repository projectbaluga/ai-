import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../workers/api/src/index";

let loginAttempts = 0;
const mockDb = {
  prepare: (_sql: string) => ({
    bind: (..._values: unknown[]) => ({
      first: async () => ({ attempts: ++loginAttempts, window_started_at: Math.floor(Date.now() / 1000) }),
      run: async () => { loginAttempts = 0; return { success: true }; }
    })
  })
};

const env = {
  DB: mockDb as unknown as D1Database,
  OWNER_API_TOKEN: "test-secret",
  AI: {
    run: vi.fn(async (): Promise<unknown> => ({
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
  beforeEach(() => { loginAttempts = 0; });
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

  it("rejects cookie-authenticated writes without a same-origin Origin header", async () => {
    const login = await worker.fetch(new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.test" },
      body: JSON.stringify({ password: "test-secret" })
    }), env);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    for (const origin of [undefined, "https://attacker.test"]) {
      const headers = new Headers({ cookie, "content-type": "application/json" });
      if (origin) headers.set("origin", origin);
      const response = await worker.fetch(new Request("https://example.test/api/actions/prepare", {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "create_borrower", payload: { fullName: "Test" } })
      }), env);
      expect(response.status).toBe(403);
    }
  });

  it("rejects an incorrect owner passphrase", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong-password" })
    }), env);
    expect(response.status).toBe(401);
  });

  it("returns 429 after five failed owner login attempts from the same IP", async () => {
    const makeLogin = (password: string) => worker.fetch(new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10" },
      body: JSON.stringify({ password })
    }), env);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await makeLogin("wrong-password")).status).toBe(401);
    }
    const blocked = await makeLogin("test-secret");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
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

  it("rejects oversized combined AI conversation context before calling the model", async () => {
    env.AI.run.mockClear();
    const request = new Request("https://example.test/api/assistant", {
      method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "assistant", content: "a".repeat(4000) },
          { role: "assistant", content: "b".repeat(4000) },
          { role: "assistant", content: "c".repeat(4000) },
          { role: "user", content: "d".repeat(1) }
        ]
      })
    });
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("parses fenced JSON with a short preamble", async () => {
    const payload = { intent: "answer_question", message: "Kumusta po!", proposedActions: [], needsClarification: false };
    env.AI.run.mockImplementationOnce(async () => ({ response: "Narito ang sagot:\n```json\n" + JSON.stringify(payload) + "\n```" }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello?" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it("accepts nested Workers AI response wrappers", async () => {
    const payload = { intent: "answer_question", message: "Hello!", proposedActions: [], needsClarification: false };
    env.AI.run.mockImplementationOnce(async () => ({ result: { response: JSON.stringify(payload) } }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello?" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });

  it("accepts plain text for ordinary non-transactional conversation", async () => {
    env.AI.run.mockImplementationOnce(async () => ({ response: "Kumusta po! Paano kita matutulungan?" }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello!" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "answer_question",
      message: "Kumusta po! Paano kita matutulungan?",
      proposedActions: [],
      needsClarification: false
    });
    expect(env.AI.run).toHaveBeenCalledOnce();
  });

  it("retries malformed output once for a lending action and still requires a structured proposal", async () => {
    const proposal = {
      intent: "prepare_action",
      message: "Ihahanda ko ang borrower record para ma-review mo.",
      proposedActions: [{
        type: "create_borrower",
        payload: { fullName: "Sir Erdz" },
        summary: "Magdagdag ng borrower na Sir Erdz",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "I have added Sir Erdz." }))
      .mockImplementationOnce(async () => ({ response: JSON.stringify(proposal) }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Paki lista si Sir Erdz bilang borrower." }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(proposal);
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });

  it("returns a traceable 502 for malformed model output without logging user content", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    env.AI.run
      .mockImplementationOnce(async () => ({ response: '{"intent": invalid}' }))
      .mockImplementationOnce(async () => ({ response: '{"intent": invalid}' }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "private test message" }] })
    }), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("unsupported format"), requestId: expect.any(String) });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(env.AI.run).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[0][1])).not.toContain("private test message");
    errorSpy.mockRestore();
  });

  it("returns a traceable 503 when the Workers AI request throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    env.AI.run.mockImplementationOnce(async () => { throw new Error("provider unavailable"); });
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello?" }] })
    }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ requestId: expect.any(String) });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][1])).not.toContain("provider unavailable");
    errorSpy.mockRestore();
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
    expect(env.AI.run).toHaveBeenCalledWith("@cf/google/gemma-4-26b-a4b-it", expect.objectContaining({ max_tokens: 480, temperature: 0.35 }));
  });
});
