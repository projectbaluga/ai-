import { describe, expect, it } from "vitest";
import worker from "../workers/api/src/index";

const env = {
  DB: {} as D1Database,
  AI: {} as Ai,
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
});