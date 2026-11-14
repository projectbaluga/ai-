import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

async function readMigrations() {
  const directory = fileURLToPath(new URL("./database/migrations", import.meta.url));
  const names = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async name => ({
    name,
    queries: (await readFile(new URL(`./database/migrations/${name}`, import.meta.url), "utf8"))
      .split(";")
      .map(query => query.trim())
      .filter(Boolean)
  })));
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./workers/api/src/index.ts",
      miniflare: {
        compatibilityDate: "2026-11-14",
        d1Databases: ["DB"],
        bindings: { TEST_MIGRATIONS: await readMigrations() }
      }
    }))
  ],
  test: {
    setupFiles: ["./tests/apply-migrations.ts"]
  }
});
