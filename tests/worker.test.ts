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

  it("parses the Workers AI chat-completion choices message.content format", async () => {
    const payload = { intent: "answer_question", message: "Kumusta po!", proposedActions: [], needsClarification: false };
    env.AI.run.mockImplementationOnce(async () => ({
      id: "test-completion",
      object: "chat.completion",
      created: 1,
      model: "@cf/google/gemma-4-26b-a4b-it",
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(payload) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello?" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(env.AI.run).toHaveBeenCalledOnce();
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

  it("accepts conversational prose even when it contains braces or JSON-like examples", async () => {
    const reply = "Ganito ang sample format: { pangalan: borrower, amount: napagkasunduan }. Hindi ito transaction at wala akong ise-save.";
    env.AI.run.mockImplementationOnce(async () => ({ response: reply }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Paano ang format ng loan record?" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "answer_question",
      message: reply,
      proposedActions: [],
      needsClarification: false
    });
    expect(env.AI.run).toHaveBeenCalledOnce();
  });

  it("normalizes common borrower registration fields into the validated schema", async () => {
    const proposal = {
      intent: "prepare_action",
      message: "Ihahanda ko ang borrower profile para ma-review ninyo.",
      proposedActions: [{
        type: "create_borrower",
        payload: { name: "Wilson Villanueva", contactNumber: "0976153463" },
        summary: "I-register si Wilson Villanueva",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    env.AI.run.mockImplementationOnce(async () => ({ response: JSON.stringify(proposal) }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { role: "user", content: "Wilson Villanueva 0976153463" },
        { role: "assistant", content: "Ihahanda ko ang registration." },
        { role: "user", content: "paki register mo na po ito" }
      ] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "prepare_action",
      proposedActions: [{
        type: "create_borrower",
        payload: { fullName: "Wilson Villanueva", phone: "0976153463" },
        requiresConfirmation: true
      }]
    });
    expect(env.AI.run).toHaveBeenCalledOnce();
  });

  it("supplies the model with the natural-conversation playbook", async () => {
    let systemPrompt = "";
    env.AI.run.mockImplementationOnce(async (_model, input) => {
      const messages = input.messages as Array<{ role: string; content: string }>;
      systemPrompt = messages.find(message => message.role === "system")?.content ?? "";
      return { response: "Sige po, tutulungan kita." };
    });
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ language: "tl-en", messages: [{ role: "user", content: "Pwede ba tayo mag-usap?" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(systemPrompt).toContain("NATURAL HUMAN CONVERSATION");
    expect(systemPrompt).toContain("CONTEXT THREADING");
    expect(systemPrompt).toContain("NO REPEATED QUESTIONS");
    expect(systemPrompt).toContain("FINANCIAL CARE");
    expect(systemPrompt).toContain("ERROR RECOVERY");
    expect(systemPrompt).toContain("2026-11-14.7");
  });

  it("answers loan-process how-to questions naturally without treating them as write requests", async () => {
    const reply = "Para mag-process ng loan: piliin muna ang borrower, ilagay ang principal at napagkasunduang interest terms, i-review ang due dates, at kumpirmahin bago i-save.";
    env.AI.run.mockImplementationOnce(async () => ({ response: reply }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Paano mag process nang loan?" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "answer_question",
      message: reply,
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
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("could not format"), requestId: expect.any(String) });
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
    expect(env.AI.run).toHaveBeenCalledWith("@cf/google/gemma-4-26b-a4b-it", expect.objectContaining({ max_tokens: 1200, temperature: 0.35 }));
  });

  it("carries an explicit confirmation forward when the previous assistant turn named the write action", async () => {
    const proposal = {
      intent: "prepare_action",
      message: "Ihahanda ko ang registration ni Wilson para ma-review mo.",
      proposedActions: [{
        type: "create_borrower",
        payload: { fullName: "Wilson Villanueva", phone: "0976153463" },
        summary: "I-register si Wilson Villanueva",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    env.AI.run.mockImplementationOnce(async () => ({ response: JSON.stringify(proposal) }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { role: "user", content: "Wilson Villanueva 0976153463" },
        { role: "assistant", content: "I can register Wilson Villanueva as a borrower. Would you like me to prepare that?" },
        { role: "user", content: "Sige." }
      ] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "prepare_action",
      proposedActions: [{ type: "create_borrower", payload: { fullName: "Wilson Villanueva", phone: "0976153463" } }]
    });
    expect(env.AI.run).toHaveBeenCalledOnce();
  });


  it("treats a narrated borrowing event as a possible record request, not an already-saved loan", async () => {
    const clarification = {
      intent: "request_clarification",
      message: "I-register muna natin si Juan Dela Cruz bilang borrower. Wala pang loan na nase-save.",
      proposedActions: [],
      needsClarification: true
    };
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "Juan borrowed money and is registered now." }))
      .mockImplementationOnce(async () => ({ response: JSON.stringify(clarification) }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{
        role: "user",
        content: "Juan Dela Cruz nag borrow nang 1000 pesos at next month nya daw ito babayaran."
      }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "request_clarification",
      proposedActions: [],
      needsClarification: true
    });
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });

  it("returns a safe clarification instead of an unsupported-format error for malformed write output", async () => {
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "I have registered Juan Dela Cruz." }))
      .mockImplementationOnce(async () => ({ response: "Sorry, I cannot format that." }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "register Juan Dela Cruz" }] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "request_clarification",
      proposedActions: [],
      needsClarification: true
    });
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });
});
