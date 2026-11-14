export interface Env {
  DB: D1Database;
  OWNER_API_TOKEN: string;
}

type ActionType = "create_borrower" | "create_loan" | "record_payment";
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

function validateAction(type: unknown, payload: unknown): { type: ActionType; payload: JsonObject } | null {
  if (!isRecord(payload)) return null;

  if (type === "create_borrower") {
    if (!text(payload.fullName, 160)) return null;
    if (payload.phone !== undefined && payload.phone !== null && !text(payload.phone, 40)) return null;
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") return null;
    return { type, payload };
  }

  if (type === "create_loan") {
    if (!text(payload.borrowerId, 80)) return null;
    if (!Number.isSafeInteger(payload.principalMinor) || (payload.principalMinor as number) <= 0) return null;
    if (payload.currency !== undefined && payload.currency !== "PHP") return null;
    if (!["none", "fixed", "percentage"].includes(String(payload.interestType))) return null;
    if (typeof payload.interestValue !== "number" || !Number.isFinite(payload.interestValue) || payload.interestValue < 0) return null;
    if (!["one_time", "monthly"].includes(String(payload.interestPeriod))) return null;
    if (payload.interestType === "none" && payload.interestValue !== 0) return null;
    if (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string") return null;
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

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function prepareAction(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!isRecord(body)) return json({ error: "Expected a JSON object." }, 400);
  const action = validateAction(body.type, body.payload);
  if (!action) return json({ error: "Invalid action type or payload." }, 400);

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
  const entityId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    let statement: D1PreparedStatement;
    let entityType: string;

    if (claim.action_type === "create_borrower") {
      entityType = "borrower";
      statement = env.DB.prepare(
        "INSERT INTO borrowers (id, full_name, phone, notes) VALUES (?, ?, ?, ?)"
      ).bind(entityId, payload.fullName, payload.phone ?? null, payload.notes ?? null);
    } else if (claim.action_type === "create_loan") {
      entityType = "loan";
      const borrower = await env.DB.prepare("SELECT id FROM borrowers WHERE id = ? AND archived_at IS NULL")
        .bind(payload.borrowerId).first<{ id: string }>();
      if (!borrower) {
        await env.DB.prepare("UPDATE pending_actions SET status = 'rejected' WHERE id = ?").bind(actionId).run();
        return json({ error: "Borrower not found or archived. No loan was created." }, 404);
      }
      statement = env.DB.prepare(
        "INSERT INTO loans (id, borrower_id, principal_minor, currency, interest_type, interest_value, interest_period, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(entityId, payload.borrowerId, payload.principalMinor, payload.currency ?? "PHP", payload.interestType, payload.interestValue, payload.interestPeriod, payload.notes ?? null);
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

    await env.DB.batch([
      statement,
      env.DB.prepare(
        "INSERT INTO audit_log (id, actor, action, entity_type, entity_id, details_json) VALUES (?, 'owner', ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), claim.action_type, entityType, entityId, JSON.stringify(payload)),
      env.DB.prepare(
        "UPDATE pending_actions SET status = 'confirmed', result_entity_id = ?, confirmed_at = ? WHERE id = ? AND status = 'confirming'"
      ).bind(entityId, now, actionId)
    ]);

    return json({ actionId, status: "confirmed", entityType, entityId }, 201);
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
    if (request.headers.get("authorization") !== `Bearer ${env.OWNER_API_TOKEN}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method === "GET" && url.pathname === "/api") {
      return json({ service: "lending-assistant-api", status: "transactions-enabled" });
    }

    if (request.method === "POST" && url.pathname === "/api/actions/prepare") {
      return prepareAction(request, env);
    }

    const confirmMatch = url.pathname.match(/^\/api\/actions\/([0-9a-f-]+)\/confirm$/i);
    if (request.method === "POST" && confirmMatch) return confirmAction(confirmMatch[1], env);

    const collections: Record<string, string> = {
      "/api/borrowers": "SELECT id, full_name, phone, notes, created_at, updated_at FROM borrowers WHERE archived_at IS NULL ORDER BY full_name",
      "/api/loans": "SELECT id, borrower_id, principal_minor, currency, interest_type, interest_value, interest_period, status, notes, created_at FROM loans ORDER BY created_at DESC",
      "/api/payments": "SELECT id, loan_id, amount_minor, paid_at, notes, created_at FROM payments ORDER BY paid_at DESC"
    };
    if (request.method === "GET" && collections[url.pathname]) {
      const result = await env.DB.prepare(collections[url.pathname]).all();
      return json({ results: result.results ?? [] });
    }

    return json({ error: "Not found" }, 404);
  }
};
