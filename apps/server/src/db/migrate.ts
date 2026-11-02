import { migrate as runMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import type { AppDatabase } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function migrateDatabase(db: AppDatabase): void {
  runMigrations(db, { migrationsFolder });
}
