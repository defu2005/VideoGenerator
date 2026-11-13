import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { AccountHealth } from "../src/knowledge/accountHealth.js";
import { StatusPoller, facebookVideoStatus } from "../src/knowledge/statusPoller.js";
import { registerTikTokHealthWebhook, verifyTikTokSignature } from "../src/knowledge/tiktokWebhook.js";
import { Milestones, eligibilityNumbers } from "../src/knowledge/milestones.js";
import { KnowledgeService } from "../src/knowledge/service.js";
import { registerKnowledgeRoutes } from "../src/api/knowledge.js";
import { deliverChangeAlerts } from "../src/knowledge/changeAlerts.js";
import { noteExternalHttp, setExternalHttpObserver } from "../src/knowledge/httpSignal.js";
import { assertPublishAllowed } from "../src/knowledge/changeInbox.js";

let root: string, db: ReturnType<typeof openDatabase>["sqlite"], health: AccountHealth;
const now = () => new Date("2026-11-11T05:00:00Z");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vg-protocols-")); const opened = openDatabase(join(root, "test.db")); db = opened.sqlite;
  migrateDatabase(opened.db, undefined, db); health = new AccountHealth(db, now);
  db.prepare("INSERT INTO profiles(id,name,default_brief,guidelines,market,created_at,updated_at) VALUES ('p','Test','{}','{}','VN',?,?)").run(now().toISOString(), now().toISOString());
  const stmt = db.prepare("INSERT INTO platform_accounts(id,profile_id,platform,display_name,format,connection,external_id,publish_settings,created_at,updated_at) VALUES (?,'p',?,?,'vertical','CONNECTED',?,'{}',?,?)");
  for (const [id, platform] of [["t", "tiktok"], ["a", "youtube"], ["f", "facebook_reels"], ["i", "instagram_reels"]]) stmt.run(id, platform, id, id, now().toISOString(), now().toISOString());
});
afterEach(() => { setExternalHttpObserver(null); db.close(); rmSync(root, { recursive: true, force: true }); });
const token = { accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: [], expiresAt: "2026-12-01T00:00:00Z" };
const sign = (body: string, stamp = Math.floor(now().getTime() / 1000)) => `t=${stamp},s=${createHmac("sha256", "fixture-secret").update(`${stamp}.${body}`).digest("hex")}`;
function payload(event: string, content: object, createTime = Math.floor(now().getTime() / 1000)) {
  return JSON.stringify({ client_key: "fixture-client", user_openid: "t", create_time: createTime, event, content: JSON.stringify(content) });
}
function publication(accountId: string, externalId: string) {
  const ts = now().toISOString();
  db.prepare("INSERT INTO projects(id,title,topic,mode,settings,status,stage,created_at,updated_at) VALUES (?, 'Test','Test','AUTO','{}','DRAFT','TOPIC',?,?)").run(`j${accountId}`, ts, ts);
  db.prepare("INSERT INTO renders(id,project_id,input_hash,status,output_path,duration_sec,size_bytes,width,height,report,created_at) VALUES (?,?,'x','DONE','/fixture',10,10,100,100,'{}',?)").run(`r${accountId}`, `j${accountId}`, ts);
  db.prepare("INSERT INTO publications(id,project_id,render_id,account_id,status,visibility_requested,visibility_used,external_id,created_at,updated_at,published_at) VALUES (?,?,?,?,'PUBLISHED','public','public',?,?,?,?)")
    .run(`v${accountId}`, `j${accountId}`, `r${accountId}`, accountId, externalId, ts, ts, ts);
}

it("adapts real status payload shapes for all four platforms, with Graph190 remaining unknown", async () => {
  for (const [id, externalId] of [["a", "video"], ["f", "fbvideo"], ["t", "publishid"], ["i", "pending:container"]]) publication(id!, externalId!);
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const body = url.pathname.endsWith("/debug_token") ? { data: { is_valid: true } }
      : url.hostname === "www.googleapis.com" ? { items: [{ id: "video", status: { uploadStatus: "rejected" } }] }
      : url.hostname === "open.tiktokapis.com" ? { data: { status: "FAILED", fail_reason: "video_format_check_failed" }, error: { code: "ok" } }
      : url.pathname.endsWith("/container") ? { status_code: "ERROR" } : { error: { code: 190, message: "fixture-access must never leak" } };
    return new Response(JSON.stringify(body), { status: "error" in body && (body.error as { code: unknown }).code === 190 ? 400 : 200 });
  });
  const poller = new StatusPoller({ db, now, fetch: fetchMock, vault: { loadTokens: () => token, storeTokens: vi.fn(), loadAppCredentials: () => null },
    registry: { get: () => ({ oauth: { fetchIdentity: async () => ({ id: "fixture" }) } }) as never },
    metaCredentials: () => ({ appId: "fixture-app", appSecret: "fixture-secret" }) });
  await poller.poll(new AbortController().signal);
  const events = health.inbox.list();
  for (const id of ["a", "t", "i"]) expect(events.some(e => (e.evidence as { accountId: string; state: string; entryId: string }).accountId === id
    && (e.evidence as { state: string; entryId: string }).state === "issue" && (e.evidence as { entryId: string }).entryId.endsWith(".upload"))).toBe(true);
  expect(events.some(e => (e.evidence as { detail: string }).detail.includes("Graph code 190"))).toBe(true);
  expect(events.some(e => e.severity === "critical")).toBe(false);
  expect(JSON.stringify(events)).not.toContain("fixture-access");
});

it("verifies exact webhook bytes, timestamp and secret; scoped parser leaves other JSON routes intact", async () => {
  const raw = payload("authorization.removed", { reason: 4 });
  expect(verifyTikTokSignature(Buffer.from(raw), sign(raw), "fixture-secret", now())).toBe(true);
  expect(verifyTikTokSignature(Buffer.from(raw + " "), sign(raw), "fixture-secret", now())).toBe(false);
  expect(verifyTikTokSignature(Buffer.from(raw), sign(raw, 1), "fixture-secret", now())).toBe(false);
  const app = Fastify(); app.post("/normal", async req => req.body);
  registerTikTokHealthWebhook(app, db, () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }), now);
  try {
    expect((await app.inject({ method: "POST", url: "/normal", payload: { parsed: true } })).json()).toEqual({ parsed: true });
    expect((await app.inject({ method: "POST", url: "/api/knowledge/webhooks/tiktok", payload: raw, headers: { "content-type": "application/json", "tiktok-signature": "t=1,s=bad" } })).statusCode).toBe(403);
    const request = { method: "POST" as const, url: "/api/knowledge/webhooks/tiktok", payload: raw, headers: { "content-type": "application/json", "tiktok-signature": sign(raw) } };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(health.inbox.list().filter(e => e.severity === "critical")).toHaveLength(2);
    expect((await app.inject(request)).json()).toMatchObject({ duplicate: true });
    expect(health.inbox.list()).toHaveLength(2);
    const old = payload("authorization.removed", { reason: 0 }, Math.floor(now().getTime() / 1000) - 60);
    await app.inject({ ...request, payload: old, headers: { ...request.headers, "tiktok-signature": sign(old) } });
    expect(health.inbox.list()).toHaveLength(2);
  } finally { await app.close(); }
});

it("does not turn disconnect or lost visibility into a ban/removal", async () => {
  const app = Fastify(); registerTikTokHealthWebhook(app, db, () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }), now);
  try {
    for (const [event, content] of [["authorization.removed", { reason: 1 }], ["post.publish.no_longer_publicaly_available", { publish_id: "unmatched" }]] as const) {
      const raw = payload(event, content);
      expect((await app.inject({ method: "POST", url: "/api/knowledge/webhooks/tiktok", payload: raw, headers: { "content-type": "application/json", "tiktok-signature": sign(raw) } })).statusCode).toBe(200);
    }
    const events = health.inbox.list();
    expect(events.filter(e => e.severity === "critical")).toHaveLength(1);
    expect(events.filter(e => e.severity === "high")).toHaveLength(0);
    expect(events.filter(e => (e.evidence as { state: string }).state === "unknown")).toHaveLength(2);
  } finally { await app.close(); }
});

it("polls Meta debug_token without leaking app/access tokens into stored evidence", async () => {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toContain("/debug_token");
    return new Response(JSON.stringify({ data: { is_valid: false } }), { status: 200 });
  });
  const poller = new StatusPoller({ db, now, fetch: fetchMock, vault: { loadTokens: () => token, storeTokens: vi.fn(), loadAppCredentials: () => null },
    registry: { get: () => undefined }, metaCredentials: () => ({ appId: "fixture-app", appSecret: "fixture-secret" }) });
  await poller.poll(new AbortController().signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(health.inbox.list())).not.toMatch(/fixture-(secret|access)/);
  expect(health.inbox.activeHoldViews()).toHaveLength(0);
  expect(health.inbox.list()[0]?.evidence).toMatchObject({ state: "unknown", accountId: "f" });
  expect(facebookVideoStatus({ video_status: "ready", processing_phase: { status: "error" } })).toBe("issue");
  expect(facebookVideoStatus({ video_status: "ready" })).toBe("clear");
});

it("refresh failure remains unknown and does not create an enforcement hold", async () => {
  const poller = new StatusPoller({ db, now, vault: { loadTokens: () => ({ ...token, expiresAt: "2020-01-01T00:00:00Z" }), storeTokens: vi.fn(), loadAppCredentials: () => null },
    registry: { get: () => ({ oauth: { refresh: async () => { throw new Error("invalid_grant"); } } }) as never }, fetch: vi.fn() });
  await poller.poll(new AbortController().signal);
  expect(health.inbox.list().every(e => (e.evidence as { state: string }).state === "unknown")).toBe(true);
  expect(health.inbox.activeHoldViews()).toHaveLength(0);
});

it("scopes D2 invalid_grant emitted inside a publisher refresh to the polled account", async () => {
  setExternalHttpObserver(note => health.inbox.observe(note));
  const poller = new StatusPoller({ db, now,
    vault: { loadTokens: id => id === "a" ? { ...token, expiresAt: "2020-01-01T00:00:00Z" } : null, storeTokens: vi.fn(), loadAppCredentials: () => null },
    registry: { get: () => ({ oauth: { refresh: async () => {
      noteExternalHttp({ provider: "youtube", endpoint: "oauth.token", error: "invalid_grant" }); throw new Error("invalid_grant");
    } } }) as never }, fetch: vi.fn() });
  await poller.poll(new AbortController().signal);
  expect(health.inbox.list().find(x => x.detector === "D2")?.subject).toEqual({ type: "account", id: "a" });
  expect(() => assertPublishAllowed(db, { id: "a", platform: "youtube" })).toThrow();
  expect(() => assertPublishAllowed(db, { id: "another-youtube", platform: "youtube" })).not.toThrow();
  expect(() => assertPublishAllowed(db, { id: "t", platform: "tiktok" })).not.toThrow();
});

it("requires exact qualified eligibility windows, all numeric prerequisites and fresh observations", () => {
  const rule = { followers: 1000, uploads: 3, uploadsWindowDays: 90, anyOf: [{ views: 1000, windowDays: 90 }, { watchHours: 4000, windowDays: 365 }] };
  expect(eligibilityNumbers(rule, { followers: 2000, windows: [{ days: 90, views: 2000, uploads: 3, qualified: false }] })).toBe("unknown");
  expect(eligibilityNumbers(rule, { followers: 2000, windows: [{ days: 30, views: 2000, uploads: 3, qualified: true }] })).toBe("unknown");
  expect(eligibilityNumbers(rule, { followers: 2000, windows: [{ days: 90, views: 2000, uploads: 3, qualified: true }] })).toBe("met");
  const research = JSON.parse(readFileSync(new URL("../../../docs/research/monetization/knowledge.json", import.meta.url), "utf8"));
  const entry = (Array.isArray(research) ? research : research.entries).find((e: { id: string }) => e.id === "youtube.ypp.ads");
  const knowledge = new KnowledgeService(db, now); const proposed = knowledge.propose(entry, "fixture"); knowledge.decide(proposed.id, "accepted");
  const milestones = new Milestones(db, now);
  expect(milestones.saveManual("a", { followers: 1200, age: 20, windows: [{ days: 90, qualified: false, views: 12_000_000 }] })).toBe(0);
  expect(milestones.saveManual("a", { followers: 1200, age: 20, windows: [{ days: 90, qualified: true, views: 12_000_000 }] })).toBe(1);
  expect(health.inbox.list()[0]).toMatchObject({ category: "E3", severity: "info" });
  expect(new Milestones(db, () => new Date("2026-11-20")).check("a")).toBe(0);
});

it("keeps manual status and metric mutations owner-only, validates public webhook URL, notifies new urgent events once", async () => {
  const app = Fastify(); registerKnowledgeRoutes(app, new KnowledgeService(db, now), "http://127.0.0.1:5180", db);
  const headers = { origin: "http://127.0.0.1:5180", "sec-fetch-site": "same-origin" };
  const request = { method: "POST" as const, url: "/api/knowledge/health/checks", payload: { accountId: "a", entryId: "account.youtube.strikes", outcome: "clear" } };
  try {
    expect((await app.inject(request)).statusCode).toBe(403);
    expect((await app.inject({ ...request, headers: { ...headers, "x-vg-tool-source": "mcp" } })).statusCode).toBe(403);
    expect((await app.inject({ ...request, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/knowledge/metrics", payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/knowledge/health/settings", headers, payload: { offline: false, eco: true, webhookUrl: "https://127.0.0.1/api/knowledge/webhooks/tiktok" } })).statusCode).not.toBe(200);
    health.manual({ accountId: "a", entryId: "account.youtube.strikes", outcome: "issue", policyName: "fixture" });
    const notify = vi.fn(async () => undefined); await deliverChangeAlerts(db, notify); await deliverChangeAlerts(db, notify);
    expect(notify).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});
