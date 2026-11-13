import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { AccountHealth } from "../src/knowledge/accountHealth.js";
import { assertPublishAllowed } from "../src/knowledge/changeInbox.js";
import { DetectorScheduler } from "../src/knowledge/detectorScheduler.js";
import { KnowledgeService } from "../src/knowledge/service.js";
import { youtubeStatus } from "../src/knowledge/statusPoller.js";
import { DriftMonitor } from "../src/knowledge/driftMonitor.js";
import { recordChannelRevenue } from "../src/knowledge/metricInputs.js";
import { snapshotKnowledge, type KnowledgeEntry } from "@vg/shared";
import { isDue } from "../src/analytics/freshness.js";

let root: string, sqlite: ReturnType<typeof openDatabase>["sqlite"], health: AccountHealth;
let at = new Date("2026-11-11T05:00:00Z");
const now = () => at;
beforeEach(() => {
  at = new Date("2026-11-11T05:00:00Z"); root = mkdtempSync(join(tmpdir(), "vg-status-"));
  const opened = openDatabase(join(root, "test.db")); sqlite = opened.sqlite;
  migrateDatabase(opened.db, undefined, sqlite); health = new AccountHealth(sqlite, now);
  sqlite.prepare("INSERT INTO profiles (id,name,default_brief,guidelines,created_at,updated_at) VALUES ('p','Channel','{}','{}',?,?)").run(at.toISOString(), at.toISOString());
  const insert = sqlite.prepare(`INSERT INTO platform_accounts (id,profile_id,platform,display_name,format,connection,publish_settings,created_at,updated_at)
    VALUES (?,'p',?,?,'vertical','CONNECTED','{}',?,?)`);
  for (const [id, platform] of [["a", "youtube"], ["b", "youtube"], ["t", "tiktok"], ["f", "facebook_reels"]]) insert.run(id, platform, id, at.toISOString(), at.toISOString());
});
afterEach(() => { sqlite.close(); rmSync(root, { recursive: true, force: true }); });

describe("account and video signals", () => {
  it("loads coverage and verification from knowledge for every connected platform", () => {
    expect(health.checklist().find(x => x.accountId === "f")?.checks.some(x => x.entryId === "account.facebook.strikes" && x.due)).toBe(true);
    expect(health.policies("youtube").find(x => x.value.signal === "strikes")?.value.coverage).toBe("manual");
  });
  it("never interprets API failures/missing video as a strike or removal", () => {
    health.observe("a", { entryId: "account.youtube.strikes", state: "issue", detail: "404", source: "api" });
    expect(health.inbox.list()[0]?.severity).toBe("info");
    expect(health.inbox.activeHoldViews()).toHaveLength(0);
    expect(youtubeStatus(undefined, "missing").every(x => x.state === "unknown")).toBe(true);
    const explicit = youtubeStatus({ id: "video", status: { uploadStatus: "rejected" }, contentDetails: { contentRating: { ytRating: "ytAgeRestricted" }, regionRestriction: { blocked: ["GB"] } } }, "v");
    expect(explicit.find(x => x.signal === "upload")?.state).toBe("issue");
    expect(explicit.find(x => x.signal === "age")?.state).toBe("issue");
    expect(explicit.find(x => x.signal === "removal")?.state).toBe("unknown");
  });
  it("records owner manual checks as D7 and holds only that account on a confirmed strike", () => {
    health.manual({ accountId: "a", entryId: "account.youtube.strikes", outcome: "issue", policyName: "Community warning", note: "Thông báo trong Studio" });
    expect(health.inbox.list()[0]?.detector).toBe("D7");
    expect(() => assertPublishAllowed(sqlite, { id: "a", platform: "youtube" })).toThrow();
    expect(() => assertPublishAllowed(sqlite, { id: "b", platform: "youtube" })).not.toThrow();
    expect(() => assertPublishAllowed(sqlite, { id: "t", platform: "tiktok" })).not.toThrow();
    expect(health.checklist().find(x => x.accountId === "a")?.checks.find(x => x.entryId === "account.youtube.strikes")?.due).toBe(false);
    at = new Date(at.getTime() + 7 * 86_400_000);
    expect(health.checklist().find(x => x.accountId === "a")?.checks.find(x => x.entryId === "account.youtube.strikes")?.due).toBe(true);
  });
});

describe("scheduled detectors", () => {
  it("runs weekly/monthly/slow watches at their own cadence and shares the daily model cap", async () => {
    const knowledge = new KnowledgeService(sqlite, now), base = knowledge.list()[0]!;
    const list = ["weekly", "monthly", "stable"].map((volatility, i) => ({ ...base, entry: { ...base.entry, id: `fixture.watch${i}`,
      volatility: volatility as KnowledgeEntry["volatility"], watch: [{ url: `https://example.com/${i}`, kind: "policy_page" as const }] } }));
    vi.spyOn(knowledge, "list").mockReturnValue(list);
    health.inbox.putSetting("change.llmBudget", "1");
    const llm = vi.fn(async () => ({ effect: "none" as const }));
    const fetchPage = vi.fn(async (url: string) => ({ status: 200, url, text: `A changed official policy page with enough words to inspect. Date ${at.toISOString()}` }));
    const scheduler = new DetectorScheduler({ inbox: health.inbox, knowledge, now, online: () => true, eco: () => false, fetch: fetchPage, llm, npm: async () => ({}), audit: vi.fn() });
    await scheduler.tick(); expect(fetchPage).toHaveBeenCalledTimes(3); expect(llm).toHaveBeenCalledTimes(1);
    at = new Date(at.getTime() + 3.5 * 86_400_000); await scheduler.tick(); expect(fetchPage).toHaveBeenCalledTimes(5);
    at = new Date(at.getTime() + 3.5 * 86_400_000); await scheduler.tick(); expect(fetchPage).toHaveBeenCalledTimes(8);
  });
  it("uses persistent cadence, ECO budget, read-only fake runners and prunes expired hits", async () => {
    const knowledge = new KnowledgeService(sqlite, now);
    const sample = knowledge.list().slice(0, 1).map(x => ({ ...x, entry: { ...x.entry, volatility: "weekly" as const, watch: [{ url: "https://example.com/official", kind: "policy_page" as const }] } }));
    vi.spyOn(knowledge, "list").mockReturnValue(sample);
    const fetchPage = vi.fn(async () => ({ status: 200, url: "https://example.com/official", text: "Official page body with enough text to inspect the policy." }));
    const npm = vi.fn(async () => ({})), llm = vi.fn(), audit = vi.fn();
    sqlite.prepare("INSERT INTO change_signal_hits(id,fingerprint,seen_at) VALUES ('old','x',?),('new','x',?)")
      .run(new Date(at.getTime() - 8 * 86_400_000).toISOString(), at.toISOString());
    const scheduler = new DetectorScheduler({ inbox: health.inbox, knowledge, now, online: () => true, eco: () => true, fetch: fetchPage, npm, llm, audit });
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(fetchPage).toHaveBeenCalledTimes(1); expect(llm).not.toHaveBeenCalled();
    expect(npm.mock.calls.map(x => x[0])).toEqual(["npm outdated --json", "npm audit --json"]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM change_signal_hits").get()).toEqual({ n: 1 });
    await scheduler.tick(); expect(fetchPage).toHaveBeenCalledTimes(1);
    at = new Date(at.getTime() + 86_400_000); await scheduler.tick(); expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(npm).toHaveBeenCalledTimes(2);
    const offline = new DetectorScheduler({ inbox: health.inbox, knowledge, now, online: () => false, eco: () => false, fetch: fetchPage, npm, audit });
    await offline.tick(); expect(fetchPage).toHaveBeenCalledTimes(2); expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ status: "offline" }));
  });
});

describe("drift inbox integration", () => {
  it("distinguishes a format-only shift from a known project knowledge revision", () => {
    const monitor = new DriftMonitor(sqlite, now);
    const add = (format: string, changed: boolean, revision = false) => {
      for (let i = 0; i < 17; i++) monitor.record({ accountId: "a", platform: "youtube", metric: revision ? "avgViewPct" : "views48h", format, point: {
        date: new Date(Date.UTC(2026, 9, 25 + i)).toISOString().slice(0, 10), value: changed && i >= 14 ? 60 : 100,
        samples: 4, knowledgeRev: revision && i >= 14 ? "v2" : "v1", format, definition: "fixture:v1",
      } });
    };
    add("explainer", true); add("story", false); add("*", true, true);
    expect(monitor.run()).toBe(2);
    const events = health.inbox.list().filter(x => x.detector === "D4");
    expect(events.some(x => (x.evidence as { likelyCategory: string }).likelyCategory === "C2")).toBe(true);
    expect(events.some(x => (x.evidence as { likelyCause: string }).likelyCause === "our_change")).toBe(true);
    expect(events.every(x => x.category === "E4" && x.reaction.levels.includes("R5"))).toBe(true);
  });
  it("requests the first 48-hour sample before analytics slows its regular cadence", () => {
    const published = new Date("2026-11-05T08:00:00Z"), at48 = new Date("2026-11-07T08:30:00Z");
    expect(isDue(published, new Date("2026-11-07T07:00:00Z"), at48)).toBe(true);
    expect(isDue(published, new Date("2026-11-07T08:10:00Z"), at48)).toBe(false);
  });
  it("keeps exact 48-hour cohorts, closed days, unsupported nulls and full-channel RPM denominators", () => {
    const ts = at.toISOString();
    sqlite.prepare("INSERT INTO projects(id,title,topic,mode,settings,status,stage,created_at,updated_at) VALUES ('j','Test','Test','AUTO',?,'DRAFT','TOPIC',?,?)")
      .run(JSON.stringify({ format: "explainer" }), ts, ts);
    sqlite.prepare("INSERT INTO renders(id,project_id,input_hash,status,output_path,duration_sec,size_bytes,width,height,report,created_at) VALUES ('r','j','x','DONE','/fixture',10,10,100,100,'{}',?)").run(ts);
    sqlite.prepare("INSERT INTO publications(id,project_id,render_id,account_id,status,visibility_requested,visibility_used,external_id,created_at,updated_at,published_at) VALUES ('v','j','r','a','PUBLISHED','public','public','video',?,?,'2026-11-05T08:00:00.000Z')").run(ts, ts);
    const insert = sqlite.prepare("INSERT INTO publication_metrics_snapshots(id,publication_id,fetched_at,views,avg_view_pct,raw) VALUES (?,'v',?,?,60,?)");
    insert.run("s1", "2026-11-07T08:30:00.000Z", 500, JSON.stringify({ knowledgeRev: "v1" }));
    insert.run("s2", "2026-11-07T15:00:00.000Z", 900, JSON.stringify({ knowledgeRev: "v1" }));
    insert.run("s3", "2026-11-11T01:00:00.000Z", 5000, JSON.stringify({ ctr: 0.9, knowledgeRev: "v2" }));
    sqlite.prepare("INSERT INTO channel_metrics_daily(account_id,date,views,fetched_at) VALUES ('a','2026-11-07',1000,?)").run(ts);
    recordChannelRevenue(sqlite, "a", [{ date: "2026-11-07", estimatedRevenue: 0 }, { date: "2026-11-08", estimatedRevenue: 2 }], ts);
    const monitor = new DriftMonitor(sqlite, now); monitor.collect();
    const channel = (metric: string) => monitor.series().find(x => x.accountId === "a" && x.metric === metric && x.format === "*")!;
    expect(channel("views48h").points[0]).toMatchObject({ value: 500, samples: 1, date: "2026-11-07" });
    expect(channel("ctr").points[0]?.value).toBeNull(); expect(channel("ctr").points.every(x => x.date < "2026-11-11")).toBe(true);
    expect(channel("rpm").points.map(x => x.value)).toEqual([0, null]);
    monitor.recordManual({ accountId: "a", date: "2026-11-07", metric: "ctr", format: "*", value: 0.05, samples: 500, sourceUrl: "https://studio.youtube.com/fixture" });
    monitor.collect(); expect(channel("ctr").points[0]?.value).toBe(0.05);
    expect(() => monitor.recordManual({ accountId: "a", date: "2026-11-11", metric: "ctr", value: 0.1, samples: 3, sourceUrl: "https://studio.youtube.com/fixture" })).toThrow();
    expect(() => monitor.recordManual({ accountId: "a", date: "2026-11-10", metric: "ctr", value: 5, samples: 3, sourceUrl: "https://studio.youtube.com/fixture" })).toThrow();
  });
  it("creates a measured G1 proposal while keeping the accepted industry range unchanged", () => {
    const industry: KnowledgeEntry = { ...snapshotKnowledge("limit.youtube.shorts_max_sec")!, id: "tactic.reference", kind: "creator_tactic",
      value: { name: "Reference", summary: "Fixture", kpi: "views48h", howToAutomate: "Compare", metricBaseline: { metric: "views48h", definition: "fixed48h", format: "*", min: 50, max: 150 } },
      evidence: [{ url: "https://example.com/industry", checkedAt: "2026-11-11", type: "industry" }] };
    const knowledge = new KnowledgeService(sqlite, now), pending = knowledge.propose(industry, "fixture"); knowledge.decide(pending.id, "accepted");
    const monitor = new DriftMonitor(sqlite, now);
    for (let i = 0; i < 14; i++) monitor.record({ accountId: "a", platform: "youtube", metric: "views48h", format: "*", point: {
      date: new Date(Date.UTC(2026, 9, 28 + i)).toISOString().slice(0, 10), value: 200, samples: 3, knowledgeRev: "v1", format: "*", definition: "fixed48h",
    } });
    monitor.run();
    expect(health.inbox.list().find(x => x.category === "G1")?.reaction.proposalId).toBeTruthy();
    expect(knowledge.get(industry.id)?.entry.value).toEqual(industry.value);
    expect(knowledge.proposals()).toHaveLength(1);
  });
  it("opens an E4 investigation and cross-checks every connected channel on that platform", () => {
    const monitor = new DriftMonitor(sqlite, now);
    for (const accountId of ["a", "b"]) for (let i = 0; i < 17; i++) monitor.record({ accountId, platform: "youtube", metric: "views48h", format: "*", point: {
      date: new Date(Date.UTC(2026, 10, i - 5)).toISOString().slice(0, 10), value: i < 14 ? 100 : 60, samples: 4, knowledgeRev: "v1", format: "*", definition: "fixed48h",
    } });
    expect(monitor.run()).toBe(2);
    const events = health.inbox.list().filter(x => x.detector === "D4");
    expect(events).toHaveLength(2); expect(events.every(x => x.category === "E4" && x.reaction.levels.includes("R5"))).toBe(true);
    expect(events.map(x => (x.evidence as { likelyCategory: string }).likelyCategory)).toEqual(["B4", "B4"]);
    expect(monitor.run()).toBe(0);
  });
});
