import { afterEach, beforeEach, expect, it } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { backfillWorkspaceKeys, migrateDatabase } from "../src/db/migrate.js";
import { runAsActor } from "../src/auth/requestContext.js";
import { actorWith } from "./testActor.js";
import { KnowledgeService } from "../src/knowledge/service.js";
import { snapshotKnowledge } from "@vg/shared";
import { listAgents, noteAgentSeen } from "../src/reports/skillReportService.js";
import { upsertYoutubeRevenueEntries } from "../src/finance/youtubeRevenue.js";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

let opened: ReturnType<typeof openDatabase>;
beforeEach(() => {
  opened = openDatabase(":memory:");
  migrateDatabase(opened.db, undefined, opened.sqlite);
  for (const id of ["A", "B"]) opened.sqlite.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES (?,?,?,?)").run(id,id,id,1);
});
afterEach(() => opened.sqlite.close());
const inWorkspace = <T>(id: string, fn: () => T) => runAsActor(actorWith({ role: "owner", workspaceId: id }), fn);

it("keeps identical knowledge slugs, pending decisions and revision history separate", () => {
  const service = new KnowledgeService(opened.sqlite);
  const entry = snapshotKnowledge("guideline.youtube")!;
  const a = inWorkspace("A", () => service.propose({ ...entry, notes: "A" }, "test"));
  const b = inWorkspace("B", () => service.propose({ ...entry, notes: "B" }, "test"));
  inWorkspace("A", () => {
    expect(service.proposals().map((p) => p.id)).toEqual([a.id]);
    expect(() => service.decide(b.id, "accepted")).toThrow();
    service.decide(a.id, "accepted");
    expect(service.get(entry.id)?.entry.notes).toBe("A");
  });
  inWorkspace("B", () => {
    service.decide(b.id, "accepted");
    expect(service.get(entry.id)?.entry.notes).toBe("B");
    expect(service.history(entry.id)).toHaveLength(1);
  });
  expect(opened.sqlite.prepare("SELECT DISTINCT id FROM knowledge_entries WHERE key=?").all(entry.id)).toHaveLength(2);
});

it("registers the same agent independently without sharing the throttle", () => {
  const agent = { kind: "hermes", name: "same", environment: "wsl", model: "mock" } as const;
  for (const workspace of ["A", "B"]) inWorkspace(workspace, () => {
    noteAgentSeen(opened.sqlite, agent, new Date("2026-11-15"));
    expect(listAgents(opened.sqlite)).toHaveLength(1);
  });
  expect(opened.sqlite.prepare("SELECT * FROM agents").all()).toHaveLength(2);
});

it("upserts identical revenue keys using the profile workspace even outside a request", () => {
  for (const workspace of ["A", "B"]) {
    opened.sqlite.prepare("INSERT INTO profiles (id,name,created_at,updated_at,workspace_id,default_brief,guidelines) VALUES (?,?,?,?,?,'{}','{}')").run(workspace, workspace, "now", "now", workspace);
    opened.sqlite.prepare("INSERT INTO platform_accounts (id,profile_id,platform,external_id,display_name,format,publish_settings,created_at,updated_at) VALUES (?,?,'youtube',?,'test','long','{}','now','now')").run(workspace, workspace, workspace);
    const options = { accountId: workspace, profileId: workspace, channelId: "shared", dayRows: [{ date: "2026-11-14", estimatedRevenue: 10, estimatedAdRevenue: 10, estimatedRedPartnerRevenue: 0 }], videoRows: [], publicationByExternalId: new Map<string,string>(), nowIso: "2026-11-15" };
    expect(upsertYoutubeRevenueEntries(opened.sqlite, options).inserted).toBe(1);
    expect(upsertYoutubeRevenueEntries(opened.sqlite, options).updated).toBe(1);
  }
  expect(opened.sqlite.prepare("SELECT * FROM revenue_entries").all()).toHaveLength(2);
});

it("backfills legacy slugs and preserves revision links idempotently", () => {
  opened.sqlite.prepare("INSERT INTO knowledge_entries (id,kind,json,revision,updated_at) VALUES ('legacy','test',NULL,1,'now')").run();
  opened.sqlite.prepare("INSERT INTO knowledge_revisions (id,entry_id,revision,patch,origin,actor,reason,created_at) VALUES ('r','legacy',1,'[]','test','user','test','now')").run();
  backfillWorkspaceKeys(opened.sqlite);
  backfillWorkspaceKeys(opened.sqlite);
  expect(opened.sqlite.prepare("SELECT e.key, e.workspace_id FROM knowledge_entries e JOIN knowledge_revisions r ON e.id=r.entry_id").get()).toEqual({ key: "legacy", workspace_id: "A" });
});

it("upgrades a pre-132 fixture with multiple same-kind legacy entries without index collisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-migration132-"));
  const legacy = openDatabase(":memory:");
  try {
    const source = fileURLToPath(new URL("../drizzle/", import.meta.url));
    mkdirSync(join(dir, "meta"));
    const journal = JSON.parse(readFileSync(join(source, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 76);
    writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
    for (const file of readdirSync(source).filter((name) => name.endsWith(".sql") && !name.startsWith("0076_"))) copyFileSync(join(source, file), join(dir, file));
    migrate(legacy.db, { migrationsFolder: dir });
    legacy.sqlite.prepare("INSERT INTO organization (id,name,slug,created_at) VALUES ('old','Old','old',1)").run();
    for (const key of ["one", "two"]) legacy.sqlite.prepare("INSERT INTO knowledge_entries (id,kind,json,revision,updated_at,workspace_id) VALUES (?,'same',NULL,1,'now',NULL)").run(key);
    legacy.sqlite.prepare("INSERT INTO agents (id,kind,name,environment,first_seen_at,last_seen_at) VALUES ('agent','hermes','legacy','wsl','now','now')").run();
    legacy.sqlite.prepare("INSERT INTO revenue_entries (id,source,external_key,kind,period_start,period_end,amount,currency,created_at) VALUES ('revenue','manual','legacy','other','2026-11-14','2026-11-14',1,'USD','now')").run();
    legacy.sqlite.prepare("INSERT INTO knowledge_revisions (id,entry_id,revision,patch,origin,actor,reason,created_at) VALUES ('r','one',1,'[]','test','user','test','now')").run();
    migrateDatabase(legacy.db, undefined, legacy.sqlite);
    expect(legacy.sqlite.prepare("SELECT key FROM knowledge_entries ORDER BY key").all()).toEqual([{ key: "one" }, { key: "two" }]);
    expect(legacy.sqlite.prepare("SELECT e.id FROM knowledge_entries e JOIN knowledge_revisions r ON e.id=r.entry_id").get()).toEqual({ id: "one" });
    for (const table of ["agents", "knowledge_entries", "revenue_entries"]) {
      expect(legacy.sqlite.prepare(`SELECT DISTINCT workspace_id FROM ${table}`).all()).toEqual([{ workspace_id: "old" }]);
    }
    expect(() => legacy.sqlite.prepare("INSERT INTO knowledge_entries (id,key,kind,json,revision,updated_at,workspace_id) VALUES ('duplicate','one','same',NULL,0,'now','old')").run()).toThrow(/UNIQUE/);
    expect(() => legacy.sqlite.prepare("INSERT INTO agents (id,kind,name,environment,first_seen_at,last_seen_at,workspace_id) VALUES ('duplicate','hermes','legacy','wsl','now','now','old')").run()).toThrow(/UNIQUE/);
    expect(() => legacy.sqlite.prepare("INSERT INTO revenue_entries (id,source,external_key,kind,period_start,period_end,amount,currency,created_at,workspace_id) VALUES ('duplicate','manual','legacy','other','2026-11-14','2026-11-14',1,'USD','now','old')").run()).toThrow(/UNIQUE/);
  } finally {
    legacy.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
