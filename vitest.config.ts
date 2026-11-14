import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { readD1Migrations } from "@cloudflare/vitest-plugin/config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "workers/api/wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(new URL("./database/migrations", import.meta.url).pathname)
        }
      }
    }))
  ],
  test: {
    setupFiles: ["./tests/apply-migrations.ts"]
  }
});
