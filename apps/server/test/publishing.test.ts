import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTONOMY_PRESETS, type PlatformAccount, type ProfileDetail, type Project, type Publication } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { testActor } from "./testActor.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import Database from "better-sqlite3";
import { saveAutonomyBudget } from "../src/operator/autonomyBudget.js";
import { saveAutonomySettings } from "../src/operator/autonomy.js";
import { recoverMissedPublications } from "../src/publishing/recoverSchedule.js";

const root = mkdtempSync(join(tmpdir(), "vg-publish-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  config = parseConfig({
    DATA_DIR: join(root, "data"),
    DATABASE_PATH: join(root, "publish.db"),
    PORT: "3001",
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    CORS_ORIGIN: "http://localhost:5173",
    LLM_ENABLE_MOCK: "true",
    LLM_DEFAULT_PROVIDER: "mock",
    TTS_PROVIDER: "mock",
    WORKER_ENABLED: "true",
    JOB_MAX_ATTEMPTS: "3",
    JOB_RETRY_BASE_MS: "10",
    FAKE_STAGE_DELAY_MS: "0",
  });
});

beforeEach(() => {
  const dataDir = join(root, `data-${randomUUID()}`);
  config = {
    ...config,
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
  };
  app = buildApp({ testActor,  config });
});

afterEach(async () => {
  await app.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function createProfile(): Promise<ProfileDetail> {
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",
    payload: { name: `Pub ${randomUUID().slice(0, 8)}` },
  });
  expect(response.statusCode).toBe(201);
  return response.json<ProfileDetail>();
}

async function addMockAccount(profileId: string): Promise<PlatformAccount> {
  const response = await app.inject({
    method: "POST",
    url: `/api/profiles/${profileId}/accounts`,
    payload: { platform: "mock", displayName: "Mock Channel", handle: "@mock" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<PlatformAccount>();
}

async function connectMockAccount(accountId: string): Promise<void> {
  const start = await app.inject({
    method: "GET",
    url: `/api/oauth/mock/start?accountId=${accountId}`,
  });
  expect(start.statusCode).toBe(302);
  const location = start.headers.location as string;
  expect(location).toContain("code_challenge=");
  const authUrl = new URL(location);
  const state = authUrl.searchParams.get("state");
  expect(state).toBeTruthy();

  const callback = await app.inject({
    method: "GET",
    url: `/api/oauth/mock/callback?code=test-code&state=${state}`,
  });
  expect(callback.statusCode).toBe(302);
  expect(callback.headers.location).toContain("/profiles/");
}

async function createProject(profileId: string): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { topic: "Publish test topic", profileId, title: "Publish test" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function seedRender(projectId: string, aspectRatio: string | null = null): string {
  const renderId = randomUUID();
  const now = new Date().toISOString();
  const absolute = join(config.DATA_DIR, "projects", projectId, "renders", `${renderId}.mp4`);
  mkdirSync(join(config.DATA_DIR, "projects", projectId, "renders"), { recursive: true });
  writeFileSync(absolute, Buffer.from("fake-video"));
  const sqlite = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
  sqlite.prepare(
    `INSERT INTO renders (
      id, project_id, input_hash, status, output_path, credits_path, srt_path,
      duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at,
      review_thread_id, metadata_snapshot, aspect_ratio, variant_of
    ) VALUES (?, ?, 'hash', 'DONE', ?, NULL, NULL, 30, 1000, 1920, 1080, ?, ?, 1, NULL, 0, NULL, NULL, NULL, ?, NULL)`,
  ).run(
    renderId,
    projectId,
    absolute,
    JSON.stringify({ ok: true, issues: [] }),
    now,
    aspectRatio,
  );
  sqlite.prepare(
    `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
     VALUES (?, 'hash', ?, NULL, 'CODE', ?, ?)`,
  ).run(
    projectId,
    JSON.stringify({
      titles: ["Tiêu đề đăng thử"],
      description: "Mô tả video test",
      tags: ["history", "test"],
      hashtags: ["#lichsu"],
      thumbnailText: ["Test"],
    }),
    now,
    now,
  );
  return renderId;
}

async function waitForPublication(
  publicationId: string,
  predicate: (item: Publication) => boolean,
  timeoutMs = 5_000,
): Promise<Publication> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await app.vgPublish.worker.tick();
    const list = await app.inject({ method: "GET", url: `/api/publications` });
    const items = list.json<{ items: Publication[] }>().items;
    const found = items.find((item) => item.id === publicationId);
    if (found && predicate(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for publication ${publicationId}`);
}

function assertNoSecrets(payload: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

describe("OAuth mock publisher", () => {
  it("shows a Vietnamese HTML denial and sets the account from a valid state to ERROR", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    const { state } = app.vgPublish.oauthState.create({ accountId: account.id, platform: "mock", redirectUri: "http://127.0.0.1/callback" });
    const result = await app.inject({ method: "GET",
      url: `/api/oauth/mock/callback?state=${state}&error=access_denied&error_description=%3Cscript%3Efixture-secret%3C%2Fscript%3E` });
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ "cache-control": "no-store", "referrer-policy": "no-referrer" });
    expect(result.body).toContain("Bạn đã từ chối quyền truy cập");
    expect(result.body).not.toContain("fixture-secret");
    expect(app.vgPublish.service.requireAccount(account.id)).toMatchObject({ connection: "ERROR" });
  });

  it("keeps failed exchange details private and shows the invalid grant recovery", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    vi.spyOn(app.vgPublish.registry.require("mock").oauth, "exchangeCode").mockRejectedValueOnce(
      Object.assign(new Error("fixture-secret-raw"), { code: "invalid_grant" }));
    const { state } = app.vgPublish.oauthState.create({ accountId: account.id, platform: "mock", redirectUri: "http://127.0.0.1/callback" });
    const result = await app.inject({ method: "GET", url: `/api/oauth/mock/callback?state=${state}&code=fixture` });
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("Mã đăng nhập đã dùng hoặc hết hạn");
    expect(result.body).not.toContain("fixture-secret-raw");
    expect(app.vgPublish.service.requireAccount(account.id)).toMatchObject({ connection: "ERROR" });
  });

  it.each(["youtube", "tiktok", "facebook_reels"] as const)("keeps the appropriate success flow for %s", async (platform) => {
    const profile = await createProfile();
    const account = (await app.inject({ method: "POST", url: `/api/profiles/${profile.id}/accounts`,
      payload: { platform, displayName: "Fixture" } })).json<PlatformAccount>();
    const oauth = app.vgPublish.registry.require(platform).oauth;
    vi.spyOn(oauth, "exchangeCode").mockResolvedValueOnce({ accessToken: "fixture-secret-token", scopes: [] });
    vi.spyOn(oauth, "fetchIdentity").mockResolvedValueOnce({ externalId: "fixture-channel", displayName: "<script>Fixture</script>", handle: "@fixture" });
    const { state } = app.vgPublish.oauthState.create({ accountId: account.id, platform, redirectUri: "http://127.0.0.1/callback" });
    const result = await app.inject({ method: "GET", url: `/api/oauth/${platform}/callback?state=${state}&code=fixture` });
    expect(result.body).not.toContain("fixture-secret-token");
    if (platform === "facebook_reels") {
      expect(result.statusCode).toBe(302);
      expect(result.headers.location).toContain(`metaPick=${account.id}`);
    } else {
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain("&lt;script&gt;Fixture&lt;/script&gt;");
      expect(result.body).not.toContain("<script>");
    }
  });

  it("connects with PKCE, stores identity, rejects bad state", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);

    const bad = await app.inject({
      method: "GET",
      url: "/api/oauth/mock/callback?code=x&state=not-a-real-state",
    });
    expect(bad.statusCode).toBe(200);
    expect(bad.headers["content-type"]).toContain("text/html");
    expect(bad.body).toContain("Phiên đăng nhập đã hết hạn");

    await connectMockAccount(account.id);

    const detail = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.connection).toBe("CONNECTED");
    expect(body.displayName).toBe("Mock Channel");
    expect(body.handle).toBe("@mock_channel");
    expect(body.externalId).toBe("mock-ext-1");
    expect(body.scopes.length).toBeGreaterThan(0);
    expect(body.redirectUri).toContain("/api/oauth/mock/callback");
    expect(body.canConnect).toBe(true);
    expect(body.connectBlockedReason).toBeNull();
    assertNoSecrets(body, ["mock-access-", "mock-refresh-", "accessToken", "refreshToken"]);

    const profileGet = await app.inject({ method: "GET", url: `/api/profiles/${profile.id}` });
    const updated = profileGet.json<ProfileDetail>().accounts.find((item) => item.id === account.id);
    expect(updated?.connection).toBe("CONNECTED");
    expect(updated?.externalId).toBe("mock-ext-1");
  });

  it("disconnects, revokes, and clears credentials", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    expect(app.vgPublish.mock).toBeTruthy();

    const disconnect = await app.inject({
      method: "DELETE",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(disconnect.statusCode).toBe(200);
    expect(app.vgPublish.mock?.behavior.revokeCalled).toBe(true);
    expect(app.vgPublish.vault.loadTokens(account.id)).toBeNull();

    const detail = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(detail.json().connection).toBe("NOT_CONNECTED");
  });
});

describe("canConnect / connectBlockedReason", () => {
  it("allows mock without app credentials", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    const detail = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.canConnect).toBe(true);
    expect(body.connectBlockedReason).toBeNull();
  });

  it("blocks Facebook Reels when publisher exists but Meta app credentials are missing", async () => {
    const profile = await createProfile();
    const created = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: { platform: "facebook_reels", displayName: "FB" },
    });
    expect(created.statusCode).toBe(201);
    const account = created.json<PlatformAccount>();

    const detail = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.canConnect).toBe(false);
    expect(body.connectBlockedReason).toContain("Chưa có thông tin ứng dụng");
  });

  it("blocks TikTok when publisher exists but app credentials are missing", async () => {
    const profile = await createProfile();
    const created = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: { platform: "tiktok", displayName: "TT" },
    });
    const account = created.json<PlatformAccount>();

    const detail = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(detail.json().canConnect).toBe(false);
    expect(detail.json().connectBlockedReason).toContain("Chưa có thông tin ứng dụng");
  });

  it("blocks YouTube when publisher exists but app credentials are missing", async () => {
    const profile = await createProfile();
    const created = await app.inject({
      method: "POST",
      url: `/api/profiles/${profile.id}/accounts`,
      payload: { platform: "youtube", displayName: "YT" },
    });
    const account = created.json<PlatformAccount>();

    const detail = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(detail.json().canConnect).toBe(false);
    expect(detail.json().connectBlockedReason).toContain("Chưa có thông tin ứng dụng");

    const saved = await app.inject({
      method: "PUT",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/app-credentials`,
      payload: { clientId: "1234-fixture.apps.googleusercontent.com", clientSecret: "super-secret-value" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ configured: true, idHint: ".com" });
    assertNoSecrets(saved.json(), ["super-secret-value", "clientSecret"]);

    const after = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(after.json().canConnect).toBe(true);
    expect(after.json().connectBlockedReason).toBeNull();
    expect(after.json().appCredentials).toEqual({ configured: true, idHint: ".com" });
    assertNoSecrets(after.json(), ["super-secret-value", "1234-fixture.apps.googleusercontent.com"]);
  });

  it("treats .env fallback as enough to connect once a publisher exists", async () => {
    const dataDir = join(root, `data-env-${randomUUID()}`);
    const envApp = buildApp({ testActor, 
      config: parseConfig({
        DATA_DIR: dataDir,
        DATABASE_PATH: join(dataDir, "app.db"),
        PORT: "3001",
        HOST: "127.0.0.1",
        LOG_LEVEL: "silent",
        CORS_ORIGIN: "http://localhost:5173",
        LLM_ENABLE_MOCK: "true",
        LLM_DEFAULT_PROVIDER: "mock",
        TTS_PROVIDER: "mock",
        WORKER_ENABLED: "false",
        YOUTUBE_CLIENT_ID: "env-client-id",
        YOUTUBE_CLIENT_SECRET: "env-client-secret",
      }),
    });
    try {
      const profileRes = await envApp.inject({
        method: "POST",
        url: "/api/profiles",
        payload: { name: "Env profile" },
      });
      const profile = profileRes.json<ProfileDetail>();
      const accountRes = await envApp.inject({
        method: "POST",
        url: `/api/profiles/${profile.id}/accounts`,
        payload: { platform: "youtube", displayName: "YT env" },
      });
      const account = accountRes.json<PlatformAccount>();
      envApp.vgPublish.registry.register({
        platform: "youtube",
        oauth: {
          buildAuthUrl: () => "https://example.invalid/auth",
          exchangeCode: async () => ({ accessToken: "x", scopes: [] }),
          refresh: async (tokens) => tokens,
          fetchIdentity: async () => ({ displayName: "YT", externalId: "1" }),
        },
        upload: async () => ({ externalId: "1", externalUrl: "https://example.invalid", warnings: [] }),
        limits: {
          maxDurationSec: 60,
          maxTitleChars: 100,
          maxDescriptionChars: 500,
          maxTags: 5,
          supportsScheduledPublishAt: false,
        },
      });
      const detail = await envApp.inject({
        method: "GET",
        url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
      });
      expect(detail.json().canConnect).toBe(true);
      expect(detail.json().connectBlockedReason).toBeNull();
      expect(detail.json().appCredentials.configured).toBe(false);
    } finally {
      await envApp.close();
    }
  });
});

describe("Publish jobs", () => {
  it.each([
    { lateHours: 1, level: "autonomous", expected: "QUEUED" },
    { lateHours: 3, level: "autonomous", expected: "SCHEDULED" },
    { lateHours: 3, level: "supervised", expected: "FAILED" },
  ] as const)("recovers an automatic slot late by $lateHours hours with $level grants", async ({ lateHours, level, expected }) => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    const project = await createProject(profile.id);
    const renderId = seedRender(project.id);
    const { sqlite } = app.vgAssistant.service.toolContext();
    const now = new Date(Date.now() + 24 * 60 * 60_000);
    const slot = new Date(now.getTime() - lateHours * 60 * 60_000).toISOString();
    const heartbeat = new Date(now.getTime() - 9 * 60 * 60_000).toISOString();
    const id = randomUUID();
    saveAutonomySettings(sqlite, { level: "autonomous", grants: AUTONOMY_PRESETS.autonomous });
    saveAutonomySettings(sqlite, { level, grants: AUTONOMY_PRESETS[level] }, profile.id);
    sqlite.prepare("UPDATE profiles SET automation = ? WHERE id = ?")
      .run(JSON.stringify({ enabled: true, publishTimes: ["19:00"] }), profile.id);
    sqlite.prepare(`INSERT INTO profile_topics (id, profile_id, topic, source, status, project_id, scheduled_for, created_at, updated_at)
      VALUES (?, ?, 'Fixture', 'USER', 'IN_PRODUCTION', ?, ?, ?, ?)`)
      .run(randomUUID(), profile.id, project.id, slot, heartbeat, heartbeat);
    sqlite.prepare(`INSERT INTO publications (id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
      scheduled_for, created_at, updated_at) VALUES (?, ?, ?, ?, 'SCHEDULED', 'private', 'private', ?, ?, ?)`)
      .run(id, project.id, renderId, account.id, slot, heartbeat, heartbeat);
    const recovered = recoverMissedPublications(sqlite, heartbeat, now);
    expect(recovered).toEqual({ rescheduled: expected === "SCHEDULED" ? 1 : 0, needsReview: expected === "FAILED" ? 1 : 0 });
    expect(recoverMissedPublications(sqlite, heartbeat, now)).toEqual({ rescheduled: 0, needsReview: 0 });
    expect(app.vgPublish.service.promoteDueScheduled(now)).toBe(expected === "QUEUED" ? 1 : 0);
    expect(app.vgPublish.service.promoteDueScheduled(now)).toBe(0);
    const publication = app.vgPublish.service.require(id);
    expect(publication.status).toBe(expected);
    if (expected === "SCHEDULED") expect(Date.parse(publication.scheduledFor!)).toBeGreaterThan(now.getTime());
    if (expected === "FAILED") expect(publication.lastError).toContain("bị lỡ hơn hai giờ");
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM jobs WHERE stage = 'PUBLISH' AND scope = ?").get(id))
      .toEqual({ count: expected === "QUEUED" ? 1 : 0 });
  });
  it("leaves uploads over the account limit queued without blocking a different account", async () => {
    const profile = await createProfile();
    const capped = await addMockAccount(profile.id);
    const other = await addMockAccount(profile.id);
    await connectMockAccount(capped.id);
    await connectMockAccount(other.id);
    const { sqlite } = app.vgAssistant.service.toolContext();
    saveAutonomyBudget(sqlite, { maxPublishesPerDayPerAccount: 1 }, profile.id);
    const create = async (accountId: string) => {
      const project = await createProject(profile.id);
      seedRender(project.id);
      const res = await app.inject({
        method: "POST", url: `/api/projects/${project.id}/publications`, payload: { accountIds: [accountId] },
      });
      expect(res.statusCode).toBe(201);
      return res.json<{ items: Publication[] }>().items[0]!;
    };
    const first = await create(capped.id);
    await waitForPublication(first.id, (item) => item.status === "PUBLISHED");
    const blocked = await create(capped.id);
    const allowed = await create(other.id);
    await waitForPublication(allowed.id, (item) => item.status === "PUBLISHED");
    expect(sqlite.prepare("SELECT status FROM publications WHERE id = ?").get(blocked.id)).toEqual({ status: "QUEUED" });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM autonomy_job_claims WHERE account_id = ?").get(capped.id)).toEqual({ count: 1 });
  });
  it("happy path uploads and never leaks tokens in API output", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    seedRender(project.id);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id] },
    });
    expect(created.statusCode).toBe(201);
    const publication = created.json<{ items: Publication[] }>().items[0]!;
    expect(publication.status).toBe("QUEUED");
    assertNoSecrets(created.json(), ["mock-access-", "mock-refresh-"]);

    const published = await waitForPublication(publication.id, (item) => item.status === "PUBLISHED");
    expect(published.externalUrl).toContain("https://mock.local/watch/");
    expect(published.visibilityUsed).toBe("public");
    expect(published.guardrailReason).toBeNull();

    const list = await app.inject({ method: "GET", url: `/api/projects/${project.id}/publications` });
    assertNoSecrets(list.json(), ["mock-access-", "mock-refresh-", "clientSecret"]);
  });

  it("guardrail forces private with reason", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    const renderId = seedRender(project.id);
    const sqlite = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
    sqlite.prepare(
      `INSERT INTO guideline_findings (
        id, project_id, stage, source, rule_id, severity, scene_id, text, quote, suggestion, status, dismissed_by, created_at, updated_at
      ) VALUES (?, ?, 'SCRIPT', 'CODE', 'must.rule', 'MUST', NULL, 'Bad', NULL, NULL, 'OPEN', NULL, ?, ?)`,
    ).run(randomUUID(), project.id, new Date().toISOString(), new Date().toISOString());
    void renderId;

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id], visibility: "public" },
    });
    const publication = created.json<{ items: Publication[] }>().items[0]!;
    expect(publication.visibilityRequested).toBe("public");
    expect(publication.visibilityUsed).toBe("private");
    expect(publication.guardrailReason).toContain("MUST");

    const published = await waitForPublication(publication.id, (item) => item.status === "PUBLISHED");
    expect(published.visibilityUsed).toBe("private");
  });

  it.each(["QUEUED", "QUEUED_WITH_MARKERS", "UPLOADING", "PUBLISHED"] as const)(
    "reconciles the %s publication checkpoint after restart",
    async (checkpoint) => {
      const profile = await createProfile();
      const account = await addMockAccount(profile.id);
      await connectMockAccount(account.id);
      const project = await createProject(profile.id);
      seedRender(project.id);
      const created = await app.inject({
        method: "POST", url: `/api/projects/${project.id}/publications`,
        payload: { accountIds: [account.id] },
      });
      const { id } = created.json<{ items: Publication[] }>().items[0]!;
      await waitForPublication(id, (item) => item.status === "PUBLISHED");
      await app.close();

      const db = new Database(config.DATABASE_PATH);
      try {
        if (checkpoint === "QUEUED") {
          db.prepare(`UPDATE publications SET status = 'QUEUED', published_at = NULL, external_id = NULL, external_url = NULL
            WHERE id = ?`).run(id);
        } else {
          db.prepare("UPDATE publications SET status = ? WHERE id = ?")
            .run(checkpoint === "QUEUED_WITH_MARKERS" ? "QUEUED" : checkpoint, id);
        }
        db.prepare("UPDATE jobs SET status = 'RUNNING' WHERE scope = ? AND stage = 'PUBLISH'").run(id);
      } finally {
        db.close();
      }
      app = buildApp({ testActor,  config });
      await app.ready();
      const expectedStatus = checkpoint === "UPLOADING" ? "FAILED" : "PUBLISHED";
      const publication = await waitForPublication(id, (item) => item.status === expectedStatus);
      const sqlite = (app.vgPublish.service as unknown as { sqlite: Database.Database }).sqlite;
      expect(sqlite.prepare("SELECT status FROM jobs WHERE scope = ? AND stage = 'PUBLISH'").get(id))
        .toEqual({ status: expectedStatus === "FAILED" ? "FAILED" : "SUCCEEDED" });
      expect(app.vgPublish.mock!.uploadCallCount).toBe(checkpoint === "QUEUED" ? 1 : 0);
      if (checkpoint === "UPLOADING") expect(publication.lastError).toContain("Kiểm tra trên nền tảng");
    },
  );

  it("retries after 429 then succeeds", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    seedRender(project.id);
    app.vgPublish.mock!.queueUploadStatuses(429, 200);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id] },
    });
    const publication = created.json<{ items: Publication[] }>().items[0]!;
    const published = await waitForPublication(publication.id, (item) => item.status === "PUBLISHED", 8_000);
    expect(published.status).toBe("PUBLISHED");
    expect(app.vgPublish.mock!.uploadCallCount).toBeGreaterThanOrEqual(2);
  });

  it("fails without retry on 401", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    seedRender(project.id);
    app.vgPublish.mock!.queueUploadStatuses(401);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id] },
    });
    const publication = created.json<{ items: Publication[] }>().items[0]!;
    const failed = await waitForPublication(publication.id, (item) => item.status === "FAILED", 5_000);
    expect(failed.lastError).toMatch(/kết nối|Unauthorized/i);
    expect(app.vgPublish.mock!.uploadCallCount).toBe(1);
  });

  it("refreshes tokens before upload when near expiry", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    seedRender(project.id);

    const tokens = app.vgPublish.vault.loadTokens(account.id)!;
    app.vgPublish.vault.storeTokens(account.id, {
      ...tokens,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), // < 5 min
    });
    const before = app.vgPublish.vault.loadTokens(account.id)!.accessToken;

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id] },
    });
    const publication = created.json<{ items: Publication[] }>().items[0]!;
    await waitForPublication(publication.id, (item) => item.status === "PUBLISHED");
    const after = app.vgPublish.vault.loadTokens(account.id)!.accessToken;
    expect(after).not.toBe(before);
    expect(after).toContain("refreshed");
  });

  it("schedule ticker promotes due jobs", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    seedRender(project.id);

    // Mock supports scheduledPublishAt, so future schedule uploads immediately as private+publishAt.
    // To exercise SCHEDULED path, temporarily disable supportsScheduledPublishAt.
    const limits = app.vgPublish.mock!.limits;
    (limits as { supportsScheduledPublishAt: boolean }).supportsScheduledPublishAt = false;

    const past = new Date(Date.now() - 1_000).toISOString();
    const sqlite = (app.vgPublish.service as unknown as { sqlite: import("better-sqlite3").Database }).sqlite;
    const id = randomUUID();
    const renderId = sqlite.prepare(
      "SELECT id FROM renders WHERE project_id = ? LIMIT 1",
    ).get(project.id) as { id: string };
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO publications (
        id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
        guardrail_reason, scheduled_for, external_id, external_url, attempts, last_error, progress,
        created_at, updated_at, published_at
      ) VALUES (?, ?, ?, ?, 'SCHEDULED', 'public', 'public', NULL, ?, NULL, NULL, 0, NULL, 0, ?, ?, NULL)`,
    ).run(id, project.id, renderId.id, account.id, past, now, now);

    expect(app.vgPublish.service.promoteDueScheduled()).toBe(1);
    const published = await waitForPublication(id, (item) => item.status === "PUBLISHED");
    expect(published.status).toBe("PUBLISHED");

    (limits as { supportsScheduledPublishAt: boolean }).supportsScheduledPublishAt = true;
  });

  it("idempotency returns existing publication unless force", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);
    await connectMockAccount(account.id);
    const project = await createProject(profile.id);
    seedRender(project.id);

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id] },
    });
    const a = first.json<{ items: Publication[] }>().items[0]!;
    await waitForPublication(a.id, (item) => item.status === "PUBLISHED");

    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id] },
    });
    expect(second.json<{ items: Publication[] }>().items[0]!.id).toBe(a.id);

    const forced = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publications`,
      payload: { accountIds: [account.id], force: true },
    });
    expect(forced.json<{ items: Publication[] }>().items[0]!.id).not.toBe(a.id);
  });
});
