import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";

const root = mkdtempSync(join(tmpdir(), "vg-mr-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const upsert = (db: Database.Database, ws: string, month: string, json: string) =>
  db.prepare(`INSERT INTO monthly_reports (month, json, created_at, workspace_id) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, month) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`).run(month, json, "t", ws);
const read = (db: Database.Database, ws: string, month: string) =>
  (db.prepare("SELECT json FROM monthly_reports WHERE month = ? AND workspace_id = ?").get(month, ws) as { json: string } | undefined)?.json;

describe("monthly_reports is keyed by (workspace_id, month)", () => {
  it("keeps each workspace's report apart and rebuild touches only its own row", () => {
    const db = new Database(join(root, "a.db"));
    migrate(drizzle(db), { migrationsFolder: join(__dirname, "..", "drizzle") });
    upsert(db, "wsA", "2026-10", '{"n":1}');
    upsert(db, "wsB", "2026-10", '{"n":2}');
    expect(read(db, "wsA", "2026-10")).toBe('{"n":1}');
    expect(read(db, "wsB", "2026-10")).toBe('{"n":2}');
    upsert(db, "wsA", "2026-10", '{"n":3}');
    expect(read(db, "wsA", "2026-10")).toBe('{"n":3}');
    expect(read(db, "wsB", "2026-10")).toBe('{"n":2}');
    expect(() => db.prepare("INSERT INTO monthly_reports (month, json, created_at, workspace_id) VALUES ('2026-11','{}','t',NULL)").run()).toThrow();
    db.close();
  });

  it("the backfill SQL gives NULL rows to the oldest organization, or deletes them when none exists", () => {
    const sql = readFileSync(join(__dirname, "..", "drizzle", "0069_monthly_reports_backfill.sql"), "utf8").split("--> statement-breakpoint");
    const make = (name: string) => {
      const db = new Database(join(root, name));
      db.exec("CREATE TABLE organization (id text, created_at integer); CREATE TABLE monthly_reports (workspace_id text, month text PRIMARY KEY, json text, created_at text);");
      db.exec("INSERT INTO monthly_reports VALUES (NULL,'2026-01','{}','t'), ('wsB','2026-02','{}','t')");
      return db;
    };
    const withOrgs = make("b.db");
    withOrgs.exec("INSERT INTO organization VALUES ('newer', 20), ('oldest', 10)");
    for (const stmt of sql) withOrgs.exec(stmt);
    expect(withOrgs.prepare("SELECT workspace_id FROM monthly_reports WHERE month='2026-01'").get()).toEqual({ workspace_id: "oldest" });
    expect(withOrgs.prepare("SELECT workspace_id FROM monthly_reports WHERE month='2026-02'").get()).toEqual({ workspace_id: "wsB" });
    withOrgs.close();
    const noOrgs = make("c.db");
    for (const stmt of sql) noOrgs.exec(stmt);
    expect(noOrgs.prepare("SELECT month FROM monthly_reports").all()).toEqual([{ month: "2026-02" }]);
    noOrgs.close();
  });
});
