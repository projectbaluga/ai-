import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "../workers/api/src/index";

const db = (env as unknown as { DB: D1Database }).DB;

let capturedSystemPrompt = "";
const testEnv = {
  DB: db,
  OWNER_API_TOKEN: "d1-integration-test-secret",
  AI: { run: async (_model: string, input: Record<string, unknown>) => {
    const messages = input.messages as Array<{ role: string; content: string }>;
    capturedSystemPrompt = messages.find(message => message.role === "system")?.content ?? "";
    return { response: JSON.stringify({ intent: "search_records", message: "Nahanap ko ang record.", proposedActions: [], needsClarification: false }) };
  } }
};

const headers = {
  authorization: "Bearer d1-integration-test-secret",
  "content-type": "application/json"
};

async function prepare(type: string, payload: Record<string, unknown>) {
  const response = await worker.fetch(new Request("https://integration.test/api/actions/prepare", {
    method: "POST",
    headers,
    body: JSON.stringify({ type, payload })
  }), testEnv);
  expect(response.status).toBe(201);
  return await response.json() as { actionId: string };
}

async function confirm(actionId: string) {
  return worker.fetch(new Request(`https://integration.test/api/actions/${actionId}/confirm`, {
    method: "POST",
    headers
  }), testEnv);
}

async function seedBorrowerAndLoan() {
  const borrowerId = crypto.randomUUID();
  const loanId = crypto.randomUUID();
  await db.prepare("INSERT INTO borrowers (id, full_name) VALUES (?, ?)")
    .bind(borrowerId, "Integration Borrower").run();
  await db.prepare(
    "INSERT INTO loans (id, borrower_id, principal_minor, currency, interest_type, interest_value, interest_period) VALUES (?, ?, 100000, 'PHP', 'none', 0, 'one_time')"
  ).bind(loanId, borrowerId).run();
  return { borrowerId, loanId };
}

describe("Worker D1 transaction integration", () => {
  beforeEach(async () => {
    await db.batch([
      db.prepare("DROP TRIGGER IF EXISTS force_audit_failure"),
      db.prepare("DELETE FROM payments"),
      db.prepare("DELETE FROM audit_log"),
      db.prepare("DELETE FROM pending_actions"),
      db.prepare("DELETE FROM loans"),
      db.prepare("DELETE FROM borrowers")
    ]);
  });

  it("commits the borrower, audit event, and pending-action status together", async () => {
    const { actionId } = await prepare("create_borrower", { fullName: "Atomic Borrower" });
    const response = await confirm(actionId);

    expect(response.status).toBe(201);
    const result = await response.json() as { entityId: string };
    const borrower = await db.prepare("SELECT full_name FROM borrowers WHERE id = ?")
      .bind(result.entityId).first<{ full_name: string }>();
    const audit = await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_id = ?")
      .bind(result.entityId).first<{ count: number }>();
    const pending = await db.prepare("SELECT status, result_entity_id FROM pending_actions WHERE id = ?")
      .bind(actionId).first<{ status: string; result_entity_id: string }>();

    expect(borrower?.full_name).toBe("Atomic Borrower");
    expect(audit?.count).toBe(1);
    expect(pending).toEqual({ status: "confirmed", result_entity_id: result.entityId });
  });

  it("allows only one winner when the same action is confirmed concurrently", async () => {
    const { actionId } = await prepare("create_borrower", { fullName: "Single Commit" });
    const responses = await Promise.all([confirm(actionId), confirm(actionId)]);

    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const borrowerCount = await db.prepare("SELECT COUNT(*) AS count FROM borrowers")
      .first<{ count: number }>();
    const auditCount = await db.prepare("SELECT COUNT(*) AS count FROM audit_log")
      .first<{ count: number }>();
    expect(borrowerCount?.count).toBe(1);
    expect(auditCount?.count).toBe(1);
  });

  it("rolls back the entity write when the audit write fails", async () => {
    await db.prepare(`CREATE TRIGGER force_audit_failure BEFORE INSERT ON audit_log
      BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;`).run();
    const { actionId } = await prepare("create_borrower", { fullName: "Must Roll Back" });
    const response = await confirm(actionId);

    expect(response.status).toBe(500);
    const borrowerCount = await db.prepare("SELECT COUNT(*) AS count FROM borrowers")
      .first<{ count: number }>();
    const auditCount = await db.prepare("SELECT COUNT(*) AS count FROM audit_log")
      .first<{ count: number }>();
    const pending = await db.prepare("SELECT status FROM pending_actions WHERE id = ?")
      .bind(actionId).first<{ status: string }>();
    expect(borrowerCount?.count).toBe(0);
    expect(auditCount?.count).toBe(0);
    expect(pending?.status).toBe("failed");
  });

  it("records payments against an existing loan and keeps the audit trail", async () => {
    const { loanId } = await seedBorrowerAndLoan();
    const { actionId } = await prepare("record_payment", {
      loanId,
      amountMinor: 2500,
      paidAt: "2026-11-14T09:00:00.000Z"
    });
    const response = await confirm(actionId);

    expect(response.status).toBe(201);
    const payment = await db.prepare("SELECT loan_id, amount_minor FROM payments")
      .first<{ loan_id: string; amount_minor: number }>();
    const audit = await db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'record_payment'")
      .first<{ count: number }>();
    expect(payment).toEqual({ loan_id: loanId, amount_minor: 2500 });
    expect(audit?.count).toBe(1);
  });

  it("finds a borrower outside the first 30 records for AI context", async () => {
    for (let index = 0; index < 35; index++) {
      await db.prepare("INSERT INTO borrowers (id, full_name) VALUES (?, ?)")
        .bind(crypto.randomUUID(), `Aardvark Borrower ${String(index).padStart(2, "0")}`).run();
    }
    const olderId = crypto.randomUUID();
    await db.prepare("INSERT INTO borrowers (id, full_name) VALUES (?, ?)")
      .bind(olderId, "Zelda Older Borrower").run();

    capturedSystemPrompt = "";
    const response = await worker.fetch(new Request("https://integration.test/api/assistant", {
      method: "POST",
      headers,
      body: JSON.stringify({ language: "en", messages: [{ role: "user", content: "Find Zelda Older" }] })
    }), testEnv);

    expect(response.status).toBe(200);
    expect(capturedSystemPrompt).toContain("Zelda Older Borrower");
    expect(capturedSystemPrompt).toContain(olderId);
    expect(capturedSystemPrompt).toContain('"searched":true');
  });

  it("resolves a short follow-up using the borrower's name from earlier conversation", async () => {
    const borrowerId = crypto.randomUUID();
    await db.prepare("INSERT INTO borrowers (id, full_name) VALUES (?, ?)")
      .bind(borrowerId, "Juan Dela Cruz").run();

    capturedSystemPrompt = "";
    const response = await worker.fetch(new Request("https://integration.test/api/assistant", {
      method: "POST",
      headers,
      body: JSON.stringify({
        language: "tl-en",
        messages: [
          { role: "user", content: "Hanapin si Juan Dela Cruz" },
          { role: "assistant", content: "May nahanap akong borrower na si Juan Dela Cruz." },
          { role: "user", content: "Pakita mo yung record niya." }
        ]
      })
    }), testEnv);

    expect(response.status).toBe(200);
    expect(capturedSystemPrompt).toContain("Juan Dela Cruz");
    expect(capturedSystemPrompt).toContain(borrowerId);
    expect(capturedSystemPrompt).toContain('"searched":true');
  });

  it("applies the latest pending-action migration and updates active loan terms", async () => {
    const { loanId } = await seedBorrowerAndLoan();
    const { actionId } = await prepare("update_loan_terms", {
      loanId,
      interestType: "percentage",
      interestValue: 2.5,
      interestPeriod: "monthly"
    });
    const response = await confirm(actionId);

    expect(response.status).toBe(201);
    const loan = await db.prepare("SELECT interest_type, interest_value, interest_period FROM loans WHERE id = ?")
      .bind(loanId).first<{ interest_type: string; interest_value: number; interest_period: string }>();
    expect(loan).toEqual({
      interest_type: "percentage",
      interest_value: 2.5,
      interest_period: "monthly"
    });
  });
});
