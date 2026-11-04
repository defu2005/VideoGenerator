import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type PlatformAccount, type ProfileDetail, type Project, type Publication } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";

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
  app = buildApp({ config });
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
  it("connects with PKCE, stores identity, rejects bad state", async () => {
    const profile = await createProfile();
    const account = await addMockAccount(profile.id);

    const bad = await app.inject({
      method: "GET",
      url: "/api/oauth/mock/callback?code=x&state=not-a-real-state",
    });
    expect(bad.statusCode).toBe(400);

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
      payload: { clientId: "yt-client-abcd", clientSecret: "super-secret-value" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ configured: true, idHint: "abcd" });
    assertNoSecrets(saved.json(), ["super-secret-value", "clientSecret"]);

    const after = await app.inject({
      method: "GET",
      url: `/api/profiles/${profile.id}/accounts/${account.id}/connection`,
    });
    expect(after.json().canConnect).toBe(true);
    expect(after.json().connectBlockedReason).toBeNull();
    expect(after.json().appCredentials).toEqual({ configured: true, idHint: "abcd" });
    assertNoSecrets(after.json(), ["super-secret-value", "yt-client-abcd"]);
  });

  it("treats .env fallback as enough to connect once a publisher exists", async () => {
    const dataDir = join(root, `data-env-${randomUUID()}`);
    const envApp = buildApp({
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
