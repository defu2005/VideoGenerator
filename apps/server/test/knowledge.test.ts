import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuidelinePackSchema, snapshotKnowledge, type Project } from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { KnowledgeService } from "../src/knowledge/service.js";
import { GuidelineService } from "../src/guidelines/service.js";
import { YoutubeQuotaTracker } from "../src/publishing/youtubeQuota.js";
import { registerKnowledgeRoutes } from "../src/api/knowledge.js";
import Fastify from "fastify";

let root: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let knowledge: KnowledgeService;
const now = () => new Date("2026-11-11T12:00:00Z");
const pack = snapshotKnowledge("guideline.youtube")!;
const limit = snapshotKnowledge("limit.youtube.shorts_max_sec")!;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vg-knowledge-"));
  const opened = openDatabase(join(root, "test.db"));
  sqlite = opened.sqlite;
  migrateDatabase(opened.db, undefined, sqlite);
  knowledge = new KnowledgeService(sqlite, now);
});
afterEach(() => {
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

describe("knowledge revisions", () => {
  it("applies a verified low-risk change, holds a high one, and restores as a new revision", () => {
    const source = pack.evidence[0]!;
    const low = { ...pack, notes: "Ghi chú thử", evidence: [{ ...source, quote: "A verified sentence" }] };
    sqlite.prepare(`INSERT INTO provider_intel_pages
      (id,url,provider_id,page_kind,content_hash,body_text,last_fetched_at,last_changed_at,status)
      VALUES ('test',?,'youtube','docs','hash','A verified sentence for the test',?,?,'ok')`).run(source.url, now().toISOString(), now().toISOString());
    const high = { ...limit, value: { ...(limit.value as object), value: 120 } };
    const imported = knowledge.import([low, high, {}], "test").results;
    expect(imported.map((r) => r.status)).toEqual(["accepted", "pending", "invalid"]);
    expect(knowledge.get(limit.id)?.entry).toEqual(limit);
    const proposal = knowledge.proposals()[0]!;
    knowledge.decide(proposal.id, "accepted");
    expect(knowledge.get(limit.id)?.entry.value).toEqual(high.value);
    knowledge.rollback(limit.id, 0);
    expect(knowledge.get(limit.id)?.entry).toEqual(limit);
    expect(knowledge.history(limit.id).map((r) => r.origin)).toEqual(["rollback", "import"]);
  });

  it("makes an accepted guideline live while retaining earlier rules until its effective date", () => {
    let date = now();
    knowledge = new KnowledgeService(sqlite, () => date);
    const service = new GuidelineService(sqlite, knowledge);
    const project = { id: "guideline-test", settings: { platform: "youtube" } } as Project;
    sqlite.prepare(`INSERT INTO projects (id,title,topic,mode,settings,status,stage,created_at,updated_at)
      VALUES (?, 'Test', 'Test', 'GUIDED', ?, 'DRAFT', 'TOPIC', ?, ?)`)
      .run(project.id, JSON.stringify(project.settings), date.toISOString(), date.toISOString());
    const currentHash = () => JSON.parse((sqlite.prepare("SELECT settings FROM projects WHERE id=?")
      .get(project.id) as { settings: string }).settings).knowledgeRev;
    const original = GuidelinePackSchema.parse(pack.value);
    const value = { ...original, rules: original.rules.map((rule, i) => i ? rule : { ...rule, text: "Quy tắc mới" }) };
    const first = knowledge.propose({ ...pack, value: { ...value, description: "Bản bị thay thế" } }, "first");
    const newer = knowledge.propose({ ...pack, value, validFrom: "2026-11-12", validUntil: "2026-11-15" }, "next");
    expect(() => knowledge.decide(first.id, "accepted")).toThrow();
    knowledge.decide(newer.id, "accepted");
    expect(service.activeFor(project).rules[0]?.text).toBe(original.rules[0]?.text);
    const hash = currentHash();
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
    date = new Date("2026-11-12");
    expect(service.activeFor(project).rules[0]?.text).toBe(value.rules[0]?.text);
    expect(currentHash()).not.toBe(hash);
    expect(knowledge.get(pack.id, new Date("2026-11-15"))).toBeUndefined();
  });

  it("refreshes identical data without approval or moving dates backwards", () => {
    const refreshed = { ...limit, evidence: limit.evidence.map((e) => ({ ...e, checkedAt: "2026-11-12" })) };
    expect(knowledge.import([refreshed, limit], "read again").results.map((r) => r.status)).toEqual(["refreshed", "refreshed"]);
    expect(knowledge.history(limit.id)).toHaveLength(1);
    expect(knowledge.get(limit.id)?.entry.evidence[0].checkedAt).toBe("2026-11-12");
  });

  it("rejects an agent or an untrusted origin on the user-only route", async () => {
    const app = Fastify();
    registerKnowledgeRoutes(app, knowledge, "http://127.0.0.1:5180");
    const { id } = knowledge.propose(limit, "test");
    const request = { method: "POST" as const, url: `/api/knowledge/proposals/${id}/accept`, payload: {} };
    try {
      expect((await app.inject(request)).statusCode).toBe(403);
      const headers = { origin: "http://127.0.0.1:5180", "sec-fetch-site": "same-origin" };
      expect((await app.inject({ ...request, headers: { ...headers, "x-vg-tool-source": "operator" } })).statusCode).toBe(403);
      expect((await app.inject({ ...request, headers })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it("isolates general, upload and search quota buckets", () => {
    const quota = new YoutubeQuotaTracker(sqlite, 50, now, knowledge);
    quota.setUsed(50);
    expect(quota.charge("videos.list")).toBe(false);
    expect(quota.charge("videos.insert", "videos.insert")).toBe(true);
    expect(quota.getState("videos.insert").used).toBe(1);
    quota.setUsed(quota.getLimit("videos.insert"), undefined, "videos.insert");
    expect(quota.charge("videos.insert", "videos.insert")).toBe(false);
    expect(quota.charge("search.list", "search.list")).toBe(true);
    expect(quota.getState().used).toBe(50);
  });
});
