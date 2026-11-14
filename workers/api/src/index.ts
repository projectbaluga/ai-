export interface Env {
  DB: D1Database;
  AI: Ai;
  OWNER_API_TOKEN: string;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "ai-workspace-api" });
    }

    if (!env.OWNER_API_TOKEN) {
      return json({ error: "Service is not configured." }, 503);
    }

    const supplied = request.headers.get("authorization") ?? "";
    if (supplied !== `Bearer ${env.OWNER_API_TOKEN}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method === "GET" && url.pathname === "/api") {
      return json({ service: "lending-assistant-api", status: "starter" });
    }

    return json({ error: "Not found" }, 404);
  }
};