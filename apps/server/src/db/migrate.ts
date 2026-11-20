import type Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { FastifyBaseLogger } from "fastify";
import { migrate as runMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppDatabase } from "./client.js";
import { copyLegacyToolProposals } from "../operator/toolProposals.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function migrateDatabase(db: AppDatabase, logger?: FastifyBaseLogger, sqlite?: Database.Database): void {
  try {
    runMigrations(db, { migrationsFolder });
    backfillWorkspaceKeys(sqlite ?? db.$client);
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
  // TASK-074c-1 fix1: own try so a failed legacy copy is not reported as a migration failure. The copy is one transaction, so a failure leaves operator_tool_proposals unchanged.
  try {
    const copied = copyLegacyToolProposals(sqlite ?? db.$client);
    if (copied.skipped > 0) {
      logger?.warn({ skipped: copied.skipped }, "Legacy tool proposals skipped during copy to improvement_requests (unparseable or unknown status).");
    }
  } catch (error) {
    const message = "Legacy tool proposal copy into improvement_requests failed. operator_tool_proposals was not changed; fix the cause and restart.";
    logger?.error({ err: error }, message);
    throw new Error(message, { cause: error });
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

/** Idempotent data backfill after generated DDL. NULL legacy keys allow the unique index to be installed first. */
export function backfillWorkspaceKeys(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(knowledge_entries)").all() as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === "key")) return;
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE knowledge_entries SET key=id WHERE key IS NULL OR key=''").run();
    // Pending legacy proposals can precede the first accepted revision.
    const pending = sqlite.prepare("SELECT entry_id,kind,proposed,created_at FROM knowledge_proposals WHERE entry_id NOT IN (SELECT id FROM knowledge_entries)").all() as Array<{ entry_id: string; kind: string; proposed: string; created_at: string }>;
    for (const row of pending) {
      sqlite.prepare("INSERT OR IGNORE INTO knowledge_entries (id,key,kind,json,revision,updated_at) VALUES (?,?,?,NULL,0,?)")
        .run(row.entry_id, row.entry_id, row.kind, row.created_at);
    }
    const workspace = sqlite.prepare("SELECT id FROM organization ORDER BY created_at ASC, id ASC LIMIT 1").get() as { id: string } | undefined;
    if (!workspace) return;
    for (const table of ["agents", "knowledge_entries", "revenue_entries"]) {
      sqlite.prepare(`UPDATE ${table} SET workspace_id=? WHERE workspace_id IS NULL`).run(workspace.id);
    }
  })();
}
