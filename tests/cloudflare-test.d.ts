declare module "cloudflare:test" {
  export function applyD1Migrations(
    db: D1Database,
    migrations: unknown[],
    migrationTableName?: string
  ): Promise<void>;
}
