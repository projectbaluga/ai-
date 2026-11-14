import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

const db = (env as unknown as { DB: D1Database }).DB;
const migrations = (env as unknown as {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}).TEST_MIGRATIONS;

await applyD1Migrations(db, migrations);
