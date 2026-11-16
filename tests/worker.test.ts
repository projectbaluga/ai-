import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { buildFinancialLookupReply, buildVerifiedLoanProposal, extractExplicitDueDate, extractExplicitRepaymentFrequency, isLendingOverviewRequest, isRecordLookupRequest, parseAssistantOutput, removeInterestClarificationFromOverview } from "../workers/api/src/index";
import { buildLendingAssistantSystemPrompt } from "../workers/api/src/lending-assistant-prompt";

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
  it("recognizes amount-due questions as record lookups and answers with verified facts without inventing a balance", () => {
    expect(isRecordLookupRequest("Magkano ang bayarin ni Wilson Villanueva?")).toBe(true);
    const reply = buildFinancialLookupReply("Magkano ang bayarin ni Wilson Villanueva?", "tl", {
      searched: true,
      loans: [{
        id: "loan-wilson", borrower_name: "Wilson Villanueva", principal_minor: 100000,
        interest_type: "percentage", interest_value: 10, interest_frequency: "one_time",
        repayment_frequency: "one_time"
      }],
      payments: []
    });
    expect(reply?.message).toContain("₱1,000.00");
    expect(reply?.message).toContain("10% one_time interest");
    expect(reply?.message).toContain("Hindi ko pa maibibigay ang eksaktong kabuuang bayarin");
    expect(reply?.message).not.toContain("₱1,100");
  });

  it("does not let a model-generated one-time repayment default override the conversation", async () => {
    const originalDb = env.DB;
    env.DB = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true })
        }),
        all: async () => ({
          results: sql.includes("SELECT id, full_name, phone FROM borrowers")
            ? [{ id: "borrower-wilson", full_name: "Wilson Villanueva", phone: null }]
            : []
        }),
        first: async () => null,
        run: async () => ({ success: true })
      })
    } as unknown as D1Database;
    const modelProposal = {
      intent: "prepare_action",
      message: "Ready to save the loan.",
      proposedActions: [{
        type: "create_loan",
        payload: {
          borrowerId: "borrower-wilson", principalMinor: 100000, currency: "PHP",
          interestType: "percentage", interestValue: 10, interestPeriod: "one_time",
          interestFrequency: "one_time", repaymentFrequency: "one_time"
        },
        summary: "Save Wilson's loan",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    env.AI.run.mockImplementationOnce(async () => ({ response: JSON.stringify(modelProposal) }));
    try {
      const response = await worker.fetch(new Request("https://example.test/api/assistant", {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "user", content: "nagpautang ako kay Wilson Villanueva nang 1000 pesos" },
          { role: "assistant", content: "May interest po ba?" },
          { role: "user", content: "10% one-time interest" },
          { role: "assistant", content: "Please confirm and save the loan after specifying the repayment schedule?" },
          { role: "user", content: "save" }
        ] })
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "request_clarification",
        proposedActions: [],
        needsClarification: true
      });
    } finally {
      env.DB = originalDb;
    }
  });

  it("recovers Nora's no-interest one-time loan when the repayment question is phrased in Tagalog", async () => {
    const originalDb = env.DB;
    env.DB = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true })
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true })
      })
    } as unknown as D1Database;
    env.AI.run
            .mockImplementationOnce(async () => ({ response: "not valid json" }))
      .mockImplementationOnce(async () => ({ response: "not valid json" }));
    try {
      const response = await worker.fetch(new Request("https://example.test/api/assistant", {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "user", content: "pinautang ko si nora nang 400 pesos" },
          { role: "assistant", content: "May interest ba ang utang ni Nora o wala?" },
          { role: "user", content: "Walang interest" },
          { role: "assistant", content: "Sige, i-record natin ang utang ni Nora na ₱400 nang walang interest. Paano ang schedule ng bayad—isang beses lang ba ito babayaran (one-time) o may schedule gaya ng lingguhan o buwanan?" },
          { role: "user", content: "one-time lang po" }
        ] })
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "prepare_action",
        proposedActions: [{
          type: "create_loan",
          payload: {
            borrowerFullName: "nora",
            principalMinor: 40000,
            interestType: "none",
            interestValue: 0,
            repaymentFrequency: "one_time"
          },
          requiresConfirmation: true
        }],
        needsClarification: false
      });
      expect(env.AI.run).toHaveBeenCalledTimes(2);
    } finally {
      env.DB = originalDb;
    }
  });

  it("requires an explicit repayment answer and never treats one-time interest as one-time repayment", () => {
    const context = {
      available: true,
      borrowers: [{ id: "borrower-wilson", full_name: "Wilson Villanueva", phone: null }]
    };
    const noSchedule = buildVerifiedLoanProposal([
      { role: "user", content: "pinautang ko si Wilson Villanueva nang 1000 pesos" },
      { role: "assistant", content: "May interest po ba?" },
      { role: "user", content: "10% one-time interest" },
      { role: "assistant", content: "Ano po ang repayment schedule?" },
      { role: "user", content: "save" }
    ], context);
    expect(extractExplicitRepaymentFrequency([
      { role: "user", content: "pinautang ko si Wilson Villanueva nang 1000 pesos" },
      { role: "assistant", content: "May interest po ba?" },
      { role: "user", content: "10% one-time interest" },
      { role: "assistant", content: "Ano po ang repayment schedule?" },
      { role: "user", content: "save" }
    ])).toBeNull();
    expect(noSchedule).toMatchObject({
      intent: "request_clarification",
      proposedActions: [],
      needsClarification: true
    });
    expect(noSchedule?.message).toContain("paraan ng bayad");

    const explicitSchedule = buildVerifiedLoanProposal([
      { role: "user", content: "pinautang ko si Wilson Villanueva nang 1000 pesos" },
      { role: "assistant", content: "May interest po ba?" },
      { role: "user", content: "10% one-time interest" },
      { role: "assistant", content: "Ano po ang repayment schedule?" },
      { role: "user", content: "isang bayaran" }
    ], context);
    expect(explicitSchedule?.proposedActions[0].payload).toMatchObject({
      interestFrequency: "one_time",
      repaymentFrequency: "one_time"
    });
    expect(extractExplicitRepaymentFrequency([
      { role: "assistant", content: "Ano po ang repayment schedule?" },
      { role: "user", content: "weekly" }
    ])).toBe("weekly");
  });

  it("prepares Allan Lobrigo's no-interest full-payment loan from a natural Tagalog sentence", () => {
    const proposal = buildVerifiedLoanProposal([
      { role: "user", content: "pinautang ko si allan lobrigo nang 1000 pesos at babayaran nya daw po ito next month nang buo at wala po itong interest" }
    ], { available: true, borrowers: [] });
    expect(proposal).toMatchObject({
      intent: "prepare_action",
      proposedActions: [{
        type: "create_loan",
        payload: {
          borrowerFullName: "allan lobrigo",
          principalMinor: 100000,
          interestType: "none",
          interestValue: 0,
          repaymentFrequency: "one_time",
          repaymentTimingNote: "next month"
        },
        requiresConfirmation: true
      }],
      needsClarification: false
    });
    expect(proposal?.proposedActions[0].payload).not.toHaveProperty("dueDate");
  });

  it("keeps a read-only lending overview from reopening an interest-terms conversation", () => {
    expect(isLendingOverviewRequest("Show my lending overview")).toBe(true);
    expect(isLendingOverviewRequest("How do I calculate interest?")).toBe(false);
    expect(removeInterestClarificationFromOverview(
      "Narito ang overview ng loans. Ano ang napagkasunduan ninyo sa interest?"
    )).toBe("Narito ang overview ng loans.");
    expect(removeInterestClarificationFromOverview(
      "Narito ang overview ng loans. May gusto ka bang i-update?"
    )).toBe("Narito ang overview ng loans. May gusto ka bang i-update?");
  });

  it("combines a new borrower registration and loan into one validated approval", () => {
    const parsed = parseAssistantOutput({
      intent: "prepare_action",
      message: "Ise-save natin si Allan Lobrigo at ang kanyang loan na ₱1,000.",
      proposedActions: [
        { type: "create_borrower", payload: { fullName: "Allan Lobrigo" }, summary: "I-register si Allan Lobrigo", requiresConfirmation: true },
        { type: "create_loan", payload: { borrowerId: "PENDING_BORROWER_ID", principalMinor: 100000, currency: "PHP", interestType: "percentage", interestValue: 5, interestPeriod: "one_time" }, summary: "I-record ang ₱1,000 loan", requiresConfirmation: true }
      ],
      needsClarification: false
    });
    expect(parsed).toMatchObject({
      intent: "prepare_action",
      proposedActions: [{
        type: "create_loan",
        payload: {
          borrowerFullName: "Allan Lobrigo",
          principalMinor: 100000,
          currency: "PHP",
          interestType: "percentage",
          interestValue: 5,
          interestPeriod: "one_time"
        },
        requiresConfirmation: true
      }]
    });
    expect(parsed?.proposedActions).toHaveLength(1);
  });

  it("accepts a composite new-borrower loan payload but rejects an unresolved borrower placeholder", () => {
    const base = {
      intent: "prepare_action",
      message: "Pakireview ang loan.",
      proposedActions: [{
        type: "create_loan",
        payload: { borrowerFullName: "Allan Lobrigo", principalMinor: 100000, currency: "PHP", interestType: "percentage", interestValue: 5, interestPeriod: "one_time" },
        summary: "I-save ang loan",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    expect(parseAssistantOutput(base)?.proposedActions[0].payload).toMatchObject({ borrowerFullName: "Allan Lobrigo" });
    expect(parseAssistantOutput({ ...base, proposedActions: [{ ...base.proposedActions[0], payload: { ...base.proposedActions[0].payload, borrowerFullName: undefined, borrowerId: "PENDING_BORROWER_ID" } }] })).toBeNull();
  });
  it("accepts expanded interest and repayment terms and rejects impossible due dates", () => {
    const base = {
      intent: "prepare_action",
      message: "Pakireview ang weekly loan.",
      proposedActions: [{
        type: "create_loan",
        payload: {
          borrowerFullName: "Mica",
          principalMinor: 10000,
          currency: "PHP",
          interestType: "percentage",
          interestValue: 2,
          interestPeriod: "one_time",
          interestFrequency: "weekly",
          dueDate: "2026-11-21",
          repaymentTimingNote: "sa susunod na linggo",
          repaymentFrequency: "weekly",
          installmentCount: 4
        },
        summary: "I-save ang loan ni Mica",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    expect(parseAssistantOutput(base)?.proposedActions[0].payload).toMatchObject({
      interestFrequency: "weekly",
      repaymentFrequency: "weekly",
      dueDate: "2026-11-21",
      installmentCount: 4
    });
    const invalid = structuredClone(base);
    invalid.proposedActions[0].payload.dueDate = "2026-02-31";
    expect(parseAssistantOutput(invalid)).toBeNull();
  });

  beforeEach(() => {
    loginAttempts = 0;
    env.AI.run.mockReset();
    env.AI.run.mockImplementation(async () => ({
      response: JSON.stringify({
        intent: "request_clarification",
        message: "Magkano po ang ipapautang?",
        proposedActions: [],
        needsClarification: true
      })
    }));
  });
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

  it("supplies the model with the natural-conversation playbook", () => {
    const systemPrompt = buildLendingAssistantSystemPrompt({
      language: "tl-en",
      recordContext: { available: false },
      targetedMatches: { searched: false }
    });
    expect(systemPrompt).toContain("NATURAL HUMAN CONVERSATION");
    expect(systemPrompt).toContain("LANGUAGE ADAPTATION");
    expect(systemPrompt).toContain("CONTEXT THREADING");
    expect(systemPrompt).toContain("NO REPEATED QUESTIONS");
    expect(systemPrompt).toContain("FINANCIAL FACT BOUNDARIES");
    expect(systemPrompt).toContain("ERROR RECOVERY");
    expect(systemPrompt).toContain("TRANSACTION PACING");
    expect(systemPrompt).toContain("MULTI-TURN TRANSACTION STATE");
    expect(systemPrompt).toContain("TRANSACTION LIFECYCLE");
    expect(systemPrompt).toContain("REASONING DISCIPLINE");
    expect(systemPrompt).toContain("Use the required JSON object only");
    expect(systemPrompt).toContain("2026-11-15.3");
    expect(systemPrompt).toContain("PHILIPPINE LENDING KNOWLEDGE BASE");
    expect(systemPrompt).toContain("SEC MC 20 SERIES OF 2026");
    expect(systemPrompt).toContain("6% per month");
    expect(systemPrompt).toContain("not a universal interest-rate ceiling");
  });

  it("keeps an English loan narration active when the owner supplies interest terms in a later turn", async () => {
    const clarification = {
      intent: "request_clarification",
      message: "Nakuha ko po: ₱1,000 kay Jeffrey Peconcillo at 5% fixed. May iba pa bang napagkasunduang term na kailangan kong malaman?",
      proposedActions: [],
      needsClarification: true
    };
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "I can prepare that loan now." }))
      .mockImplementationOnce(async () => ({ response: JSON.stringify(clarification) }));
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
        { role: "assistant", content: "What interest terms did you agree on?" },
        { role: "user", content: "5% fixed." }
      ] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "request_clarification",
      proposedActions: [],
      needsClarification: true
    });
    expect(env.AI.run).toHaveBeenCalledTimes(2);
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

  it("prepares a verified loan proposal when the model twice fails to format a complete Tagalog loan request", async () => {
    const originalDb = env.DB;
    env.DB = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true })
        }),
        all: async () => ({
          results: sql.includes("SELECT id, full_name, phone FROM borrowers")
            ? [{ id: "borrower-allan", full_name: "Allan Lobrigo", phone: null }]
            : []
        }),
        first: async () => null,
        run: async () => ({ success: true })
      })
    } as unknown as D1Database;
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "I will prepare the loan." }))
      .mockImplementationOnce(async () => ({ response: "Sorry, I could not format this." }));
    try {
      const response = await worker.fetch(new Request("https://example.test/api/assistant", {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "user", content: "nagpautang ako nang 1000 pesos kay Allan Lobrigo ngayon araw at nais nya na bayaran ito next month at napagka-sunduan namin na may 5% interest" },
          { role: "assistant", content: "Ano po ang interest type: one-time o monthly?" },
          { role: "user", content: "one-time lang po" },
          { role: "assistant", content: "Ano po ang repayment schedule?" },
          { role: "user", content: "one-time payment" }
        ] })
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "prepare_action",
        proposedActions: [{
          type: "create_loan",
          payload: {
            borrowerId: "borrower-allan",
            principalMinor: 100000,
            currency: "PHP",
            interestType: "percentage",
            interestValue: 5,
            interestPeriod: "one_time"
          },
          requiresConfirmation: true
        }]
      });
      expect(env.AI.run).toHaveBeenCalledTimes(2);
    } finally {
      env.DB = originalDb;
    }
  });

  it("prepares one atomic loan proposal for a borrower who is not registered yet", async () => {
    const originalDb = env.DB;
    env.DB = {
      prepare: (sql: string) => ({
        bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true })
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true })
      })
    } as unknown as D1Database;
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "I will prepare the loan." }))
      .mockImplementationOnce(async () => ({ response: "Sorry, I could not format this." }));
    try {
      const response = await worker.fetch(new Request("https://example.test/api/assistant", {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "user", content: "nagpautang ako nang 1000 pesos kay Allan Lobrigo" },
          { role: "assistant", content: "May interest po ba?" },
          { role: "user", content: "May interest na 5% one-time." },
          { role: "assistant", content: "Ano po ang repayment schedule?" },
          { role: "user", content: "isang bayaran" }
        ] })
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "prepare_action",
        proposedActions: [{
          type: "create_loan",
          payload: {
            borrowerFullName: "Allan Lobrigo",
            principalMinor: 100000,
            currency: "PHP",
            interestType: "percentage",
            interestValue: 5,
            interestPeriod: "one_time"
          },
          requiresConfirmation: true
        }]
      });
    } finally {
      env.DB = originalDb;
    }
  });

  it("recovers a no-interest loan and relative repayment note from Tagalog conversation history", async () => {
    const originalDb = env.DB;
    env.DB = {
      prepare: (_sql: string) => ({
        bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true })
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true })
      })
    } as unknown as D1Database;
    env.AI.run
      .mockImplementationOnce(async () => ({ response: "I will prepare the loan." }))
      .mockImplementationOnce(async () => ({ response: "Sorry, I could not format this." }));
    try {
      const response = await worker.fetch(new Request("https://example.test/api/assistant", {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "user", content: "pinautang ko si Mica nang 100 pesos ngayon araw. Babayaran niya sa susunod na linggo." },
          { role: "assistant", content: "May interest po ba?" },
          { role: "user", content: "5% one-time interest" },
          { role: "assistant", content: "Ire-record ko ang 5% one-time interest." },
          { role: "user", content: "Walang interest" },
          { role: "assistant", content: "Ano po ang repayment schedule?" },
          { role: "user", content: "isang bayaran" },
          { role: "assistant", content: "Kung tama na ang detalye, sabihin save para maitala ang loan." },
          { role: "user", content: "save" }
        ] })
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "prepare_action",
        proposedActions: [{
          type: "create_loan",
          payload: {
            borrowerFullName: "Mica",
            principalMinor: 10000,
            interestType: "none",
            interestValue: 0,
            interestFrequency: "one_time",
            repaymentTimingNote: "sa susunod na linggo",
            repaymentFrequency: "one_time"
          },
          requiresConfirmation: true
        }]
      });
    } finally {
      env.DB = originalDb;
    }
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
    expect(env.AI.run).toHaveBeenCalledWith("@cf/google/gemma-4-26b-a4b-it", expect.objectContaining({ max_tokens: 2400, temperature: 0.35, chat_template_kwargs: { enable_thinking: true } }));
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

  it("stops a cancelled transaction before calling the model or preparing an action", async () => {
    env.AI.run.mockClear();
    const response = await worker.fetch(new Request("https://example.test/api/assistant", {
      method: "POST", headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ language: "en", messages: [
        { role: "user", content: "I lent Jeffrey Peconcillo 1000 pesos." },
        { role: "assistant", content: "What interest terms did you agree on?" },
        { role: "user", content: "Cancel that loan." }
      ] })
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      intent: "answer_question",
      message: "Understood. I won't proceed with that transaction. No records were changed.",
      proposedActions: [],
      needsClarification: false
    });
    expect(env.AI.run).not.toHaveBeenCalled();
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
  it("resolves month-name due dates and treats a single dated repayment as one-time", () => {
    const now = new Date("2026-11-16T08:00:00.000Z");
    expect(extractExplicitDueDate("babayaran sa December 30", now)).toBe("2026-12-30");
    expect(extractExplicitDueDate("due on 30 Dec", now)).toBe("2026-12-30");
    expect(extractExplicitDueDate("babayaran sa March 2", now)).toBe("2027-03-02");
    expect(extractExplicitDueDate("babayaran sa February 30", now)).toBeNull();
    expect(extractExplicitRepaymentFrequency([
      { role: "user", content: "Pinautang ko si Juan Dela Cruz ng ₱1,000, walang interest, babayaran sa December 30." }
    ])).toBe("one_time");
    expect(extractExplicitRepaymentFrequency([
      { role: "user", content: "Pinautang ko si Juan ng ₱1,000, walang interest, babayaran sa December 30 nang hulugan weekly." }
    ])).toBe("weekly");
  });

  it("prepares a single-payment loan proposal for a natural Tagalog calendar-date request", () => {
    const proposal = buildVerifiedLoanProposal([
      { role: "user", content: "Pinautang ko si Juan Dela Cruz ng ₱1,000, walang interest, babayaran sa December 30, 2026." }
    ], { available: true, borrowers: [] });
    expect(proposal).toMatchObject({
      intent: "prepare_action",
      proposedActions: [{
        type: "create_loan",
        payload: {
          borrowerFullName: "Juan Dela Cruz",
          principalMinor: 100000,
          interestType: "none",
          interestValue: 0,
          dueDate: "2026-12-30",
          repaymentFrequency: "one_time"
        },
        requiresConfirmation: true
      }],
      needsClarification: false
    });
  });

  it("asks the AI to resolve a false loan clarification before using the verified fallback", async () => {
    const originalDb = env.DB;
    env.DB = {
      prepare: (_sql: string) => ({
        bind: (..._values: unknown[]) => ({
          all: async () => ({ results: [] }),
          first: async () => null,
          run: async () => ({ success: true })
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
        run: async () => ({ success: true })
      })
    } as unknown as D1Database;
    const clarification = {
      intent: "request_clarification",
      message: "Ano po ang paraan ng bayad?",
      proposedActions: [],
      needsClarification: true
    };
    const proposal = {
      intent: "prepare_action",
      message: "Nakuha ko po. Ihahanda ko ang loan para kay Juan Dela Cruz: ₱1,000, walang interest, due December 30, 2026, isang bayaran. Pakireview bago i-save.",
      proposedActions: [{
        type: "create_loan",
        payload: {
          borrowerFullName: "Juan Dela Cruz",
          principalMinor: 100000,
          currency: "PHP",
          interestType: "none",
          interestValue: 0,
          interestPeriod: "one_time",
          interestFrequency: "one_time",
          dueDate: "2026-12-30",
          repaymentFrequency: "one_time"
        },
        summary: "Gumawa ng loan record para kay Juan Dela Cruz na ₱1,000 at walang interest",
        requiresConfirmation: true
      }],
      needsClarification: false
    };
    env.AI.run.mockClear();
    env.AI.run
      .mockImplementationOnce(async () => ({ response: JSON.stringify(clarification) }))
      .mockImplementationOnce(async () => ({ response: JSON.stringify(proposal) }));
    try {
      const response = await worker.fetch(new Request("https://example.test/api/assistant", {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ messages: [{
          role: "user",
          content: "Pinautang ko si Juan Dela Cruz ng ₱1,000, walang interest, babayaran sa December 30, 2026."
        }] })
      }), env);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        intent: "prepare_action",
        proposedActions: [{
          type: "create_loan",
          payload: { borrowerFullName: "Juan Dela Cruz", principalMinor: 100000, dueDate: "2026-12-30", repaymentFrequency: "one_time" },
          requiresConfirmation: true
        }]
      });
      expect(env.AI.run).toHaveBeenCalledTimes(2);
    } finally {
      env.DB = originalDb;
    }
  });

});
