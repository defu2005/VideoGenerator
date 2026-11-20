import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";

// TASK-143: a restored copy must open with the app's real openDatabase and migrateDatabase, not a bare better-sqlite3 handle.
describe("restored database opens with the app's real open and migrate path", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("migrates a source DB, copies it as a restore would, and reopens it with integrity ok", () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-restore-open-"));
    dirs.push(dir);
    const source = join(dir, "source.db");
    const first = openDatabase(source);
    migrateDatabase(first.db, undefined, first.sqlite);
    first.sqlite.close();

    const restored = join(dir, "restored.db");
    copyFileSync(source, restored);

    const reopened = openDatabase(restored);
    try {
      expect(reopened.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      const tables = reopened.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const names = new Set(tables.map((t) => t.name));
      for (const required of ["projects", "jobs", "__drizzle_migrations"]) expect(names.has(required)).toBe(true);
      migrateDatabase(reopened.db, undefined, reopened.sqlite);
    } finally {
      reopened.sqlite.close();
    }
  });
});
