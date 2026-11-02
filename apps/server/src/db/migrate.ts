import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { FastifyBaseLogger } from "fastify";
import { migrate as runMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDatabase } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function migrateDatabase(db: AppDatabase, logger?: FastifyBaseLogger, sqlite?: Database.Database): void {
  try {
    runMigrations(db, { migrationsFolder });
  } catch (error) {
    const migration = pendingMigration(sqlite);
    logger?.error(
      { err: error, migration },
      `Database migration ${migration} failed. The development database may have been migrated by an older version of this file; delete data/app.db in development and restart.`,
    );
    throw new Error(
      `Database migration ${migration} failed. The development database may have been migrated by an older version of this file; delete data/app.db in development and restart.`,
      { cause: error },
    );
  }
}

function pendingMigration(sqlite?: Database.Database): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: { when: number; tag: string }[];
  };
  const table = sqlite?.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  ).get() as { name: string } | undefined;
  const applied = table
    ? sqlite?.prepare("SELECT MAX(created_at) AS created_at FROM __drizzle_migrations").get() as { created_at: number | null }
    : { created_at: null };
  return journal.entries.find((entry) => entry.when > (applied.created_at ?? 0))?.tag
    ?? journal.entries.at(-1)?.tag
    ?? "unknown";
}
