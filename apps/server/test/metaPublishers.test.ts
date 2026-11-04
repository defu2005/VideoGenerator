import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  META_GRAPH_VERSION,
  META_OAUTH_SCOPES,
  META_RECONNECT_SOON_VI,
  META_SCOPES,
  type PublishInput,
  type TokenSet,
} from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig } from "../src/lib/config.js";
import { FacebookReelsPublisher } from "../src/publishing/facebookReelsPublisher.js";
import { InstagramReelsPublisher } from "../src/publishing/instagramReelsPublisher.js";
import {
  buildMetaCaption,
  exchangeLongLivedUserToken,
  mapMetaGraphError,
  META_AUTH_DIALOG,
} from "../src/publishing/metaGraph.js";
import { TokenVault } from "../src/publishing/tokenVault.js";

const root = mkdtempSync(join(tmpdir(), "vg-meta-"));
let dataDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let vault: TokenVault;
let fetchMock: ReturnType<typeof vi.fn>;
let fb: FacebookReelsPublisher;
let ig: InstagramReelsPublisher;
let accountIdFb: string;
let accountIdIg: string;
let profileId: string;

const userTokens: TokenSet = {
  accessToken: "USER_LONG_LIVED",
  expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  scopes: [...META_SCOPES],
  tokenType: "Bearer",
};

const pageTokens: TokenSet = {
  accessToken: "PAGE_ACCESS_TOKEN",
  expiresAt: userTokens.expiresAt,
  scopes: [...META_SCOPES],
  tokenType: "Bearer",
};

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function baseInput(overrides: Partial<PublishInput> = {}): PublishInput {
  const videoPath = join(dataDir, "clip.mp4");
  writeFileSync(videoPath, Buffer.alloc(2048, 1));
  return {
    videoPath,
    format: "vertical",
    title: "Test reel",
    description: "Mô tả",
    tags: ["edu", "history"],
    visibility: "public",
    language: "vi",
    madeForKids: false,
    aiDisclosure: true,
    durationSec: 30,
    ...overrides,
  };
}

function insertAccount(platform: "facebook_reels" | "instagram_reels"): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, publish_settings, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, 'vertical', 1, 'NOT_CONNECTED', NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    profileId,
    platform,
    platform === "facebook_reels" ? "FB" : "IG",
    JSON.stringify({ visibility: "public", autoPublish: false }),
    now,
    now,
  );
  return id;
}

beforeEach(() => {
  dataDir = join(root, randomUUID());
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "app.db");
  const database = openDatabase(dbPath);
  sqlite = database.sqlite;
  migrateDatabase(database.db, undefined, database.sqlite);
  const config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: dbPath,
    META_APP_ID: "env-meta-app",
    META_APP_SECRET: "env-meta-secret",
    LLM_ENABLE_MOCK: "true",
    WORKER_ENABLED: "false",
  });
  vault = new TokenVault(sqlite, dataDir, undefined);
  fetchMock = vi.fn();
  const common = {
    config,
    vault,
    sqlite,
    fetchImpl: fetchMock as unknown as typeof fetch,
    sleep: async () => {},
    statusPollMaxMs: 5_000,
  };
  fb = new FacebookReelsPublisher(common);
  ig = new InstagramReelsPublisher(common);

  profileId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at)
     VALUES (?, ?, '', '', 'vi', ?, NULL, ?, NULL, NULL, '#3B82F6', NULL, ?, ?)`,
  ).run(
    profileId,
    `P-${profileId.slice(0, 8)}`,
    JSON.stringify({ platform: "facebook_reels" }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    now,
    now,
  );
  accountIdFb = insertAccount("facebook_reels");
  accountIdIg = insertAccount("instagram_reels");
});

afterEach(() => {
  sqlite.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Meta OAuth helpers", () => {
  it("builds Facebook dialog URL with required scopes", () => {
    const url = fb.oauth.buildAuthUrl({
      accountId: accountIdFb,
      redirectUri: "http://127.0.0.1:3001/api/oauth/facebook_reels/callback",
      state: "st",
      codeChallenge: "unused",
    });
    expect(url.startsWith(META_AUTH_DIALOG)).toBe(true);
    expect(url).toContain(`client_id=env-meta-app`);
    expect(url).toContain(encodeURIComponent(META_OAUTH_SCOPES));
    expect(url).toContain(META_GRAPH_VERSION);
  });

  it("exchanges code then swaps to a long-lived user token", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: "SHORT",
        expires_in: 3600,
        token_type: "bearer",
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: "LONG",
        expires_in: 5_184_000,
        token_type: "bearer",
      }));

    const tokens = await fb.oauth.exchangeCode({
      code: "auth-code",
      redirectUri: "http://127.0.0.1:3001/api/oauth/facebook_reels/callback",
      codeVerifier: "x",
      accountId: accountIdFb,
    }, AbortSignal.timeout(5_000));

    expect(tokens.accessToken).toBe("LONG");
    expect(tokens.expiresAt).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const longUrl = String(fetchMock.mock.calls[1]![0]);
    expect(longUrl).toContain("fb_exchange_token=SHORT");
  });

  it("discovers Pages and IG accounts from /me/accounts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        {
          id: "page-1",
          name: "My Page",
          access_token: "PAGE_TOK_1",
          instagram_business_account: { id: "ig-1", username: "brandig", name: "Brand IG" },
        },
        {
          id: "page-2",
          name: "No IG",
          access_token: "PAGE_TOK_2",
        },
      ],
    }));

    const pages = await fb.listTargets("USER_LONG_LIVED", AbortSignal.timeout(5_000));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ id: "page-1", kind: "page", pageAccessToken: "PAGE_TOK_1" });

    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [
        {
          id: "page-1",
          name: "My Page",
          access_token: "PAGE_TOK_1",
          instagram_business_account: { id: "ig-1", username: "brandig", name: "Brand IG" },
        },
        {
          id: "page-2",
          name: "No IG",
          access_token: "PAGE_TOK_2",
        },
      ],
    }));
    const igAccounts = await ig.listTargets("USER_LONG_LIVED", AbortSignal.timeout(5_000));
    expect(igAccounts).toHaveLength(1);
    expect(igAccounts[0]).toMatchObject({
      id: "ig-1",
      kind: "instagram",
      handle: "@brandig",
      pageId: "page-1",
      pageAccessToken: "PAGE_TOK_1",
    });
  });

  it("refresh of expired Meta token fails with reconnect message", async () => {
    try {
      await fb.oauth.refresh({
        ...pageTokens,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }, AbortSignal.timeout(1_000), accountIdFb);
      expect.fail("expected refresh to throw");
    } catch (error) {
      expect(error).toMatchObject({ status: 401 });
      expect((error as Error).message).toMatch(/kết nối lại/i);
    }
  });
});

describe("mapMetaGraphError", () => {
  it("maps token expiry, permission, and rate-limit codes", () => {
    const expired = mapMetaGraphError({ error: { code: 190, message: "expired" } }, 400);
    expect(expired).toMatchObject({ status: 401, retryable: false });
    expect(expired.message).toMatch(/kết nối lại/i);
    expect(mapMetaGraphError({ error: { code: 10, message: "perm" } }, 403))
      .toMatchObject({ status: 403, retryable: false });
    expect(mapMetaGraphError({ error: { code: 200, message: "perm" } }, 403))
      .toMatchObject({ status: 403, retryable: false });
    for (const code of [4, 17, 32, 613]) {
      expect(mapMetaGraphError({ error: { code, message: "limit" } }, 400))
        .toMatchObject({ status: 429, retryable: true });
    }
    expect(mapMetaGraphError({ error: { message: "boom" } }, 500))
      .toMatchObject({ status: 500, retryable: true });
  });
});

describe("FacebookReelsPublisher upload", () => {
  it("runs start → upload → finish → status and sets is_ai_generated", async () => {
    fb.bindExternalId("page-1");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ video_id: "vid-1" })) // start
      .mockResolvedValueOnce(jsonResponse({ success: true })) // rupload
      .mockResolvedValueOnce(jsonResponse({ success: true, video_id: "vid-1" })) // finish
      .mockResolvedValueOnce(jsonResponse({
        status: { video_status: "ready", publishing_phase: { publish_status: "published" } },
      }));

    const result = await fb.upload(baseInput(), pageTokens, AbortSignal.timeout(5_000), () => {});
    expect(result.externalId).toBe("vid-1");
    expect(result.externalUrl).toContain("facebook.com/reel/vid-1");

    const finishCall = fetchMock.mock.calls[2]!;
    const finishBody = String(finishCall[1]?.body);
    expect(finishBody).toContain("upload_phase=finish");
    expect(finishBody).toContain("video_state=PUBLISHED");
    expect(finishBody).toContain("is_ai_generated=true");

    const uploadCall = fetchMock.mock.calls[1]!;
    expect(String(uploadCall[0])).toContain(`rupload.facebook.com/video-upload/${META_GRAPH_VERSION}/vid-1`);
    expect((uploadCall[1]?.headers as Record<string, string>).offset).toBe("0");
  });

  it("schedules with SCHEDULED + scheduled_publish_time", async () => {
    fb.bindExternalId("page-1");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ video_id: "vid-2" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({
        status: { video_status: "ready" },
      }));

    await fb.upload(
      baseInput({ publishAt: "2026-12-01T10:00:00.000Z" }),
      pageTokens,
      AbortSignal.timeout(5_000),
      () => {},
    );
    const finishBody = String(fetchMock.mock.calls[2]![1]?.body);
    expect(finishBody).toContain("video_state=SCHEDULED");
    expect(finishBody).toContain("scheduled_publish_time=");
  });

  it("rejects landscape and out-of-range duration", async () => {
    fb.bindExternalId("page-1");
    await expect(
      fb.upload(baseInput({ format: "landscape" }), pageTokens, AbortSignal.timeout(1_000), () => {}),
    ).rejects.toMatchObject({ code: "FB_REELS_FORMAT" });
    await expect(
      fb.upload(baseInput({ durationSec: 120 }), pageTokens, AbortSignal.timeout(1_000), () => {}),
    ).rejects.toMatchObject({ code: "FB_REELS_DURATION" });
  });
});

describe("InstagramReelsPublisher upload", () => {
  it("creates container → upload → poll FINISHED → media_publish", async () => {
    ig.bindExternalId("ig-1");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        data: [{ quota_usage: 1, config: { quota_total: 50 } }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "container-1",
        uri: `https://rupload.facebook.com/ig-api-upload/${META_GRAPH_VERSION}/container-1`,
      }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "media-99" }));

    const result = await ig.upload(baseInput({ durationSec: 45 }), pageTokens, AbortSignal.timeout(5_000), () => {});
    expect(result.externalId).toBe("media-99");
    expect(result.externalUrl).toContain("instagram.com/reel/media-99");

    const createBody = String(fetchMock.mock.calls[1]![1]?.body);
    expect(createBody).toContain("media_type=REELS");
    expect(createBody).toContain("upload_type=resumable");
    expect(createBody).toContain("share_to_feed=true");
  });

  it("blocks when content_publishing_limit is exhausted", async () => {
    ig.bindExternalId("ig-1");
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: [{ quota_usage: 50, config: { quota_total: 50 } }],
    }));
    await expect(
      ig.upload(baseInput(), pageTokens, AbortSignal.timeout(5_000), () => {}),
    ).rejects.toMatchObject({ code: "IG_PUBLISH_LIMIT", status: 429, retryable: true });
  });

  it("rejects landscape and oversize duration", async () => {
    ig.bindExternalId("ig-1");
    await expect(
      ig.upload(baseInput({ format: "landscape" }), pageTokens, AbortSignal.timeout(1_000), () => {}),
    ).rejects.toMatchObject({ code: "IG_REELS_FORMAT" });
    await expect(
      ig.upload(baseInput({ durationSec: 20 * 60 }), pageTokens, AbortSignal.timeout(1_000), () => {}),
    ).rejects.toMatchObject({ code: "IG_REELS_DURATION" });
  });
});

describe("caption + reconnect copy", () => {
  it("builds caption with hashtags", () => {
    expect(buildMetaCaption("Title", "Desc", ["a", "#b"])).toContain("#a");
    expect(buildMetaCaption("Title", "Desc", ["a", "#b"])).toContain("#b");
  });

  it("exports reconnect warning copy", () => {
    expect(META_RECONNECT_SOON_VI).toBe("Cần kết nối lại");
  });

  it("exchangeLongLivedUserToken sets ~60 day expiry when expires_in missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "LL" }));
    const tokens = await exchangeLongLivedUserToken({
      shortLivedToken: "S",
      appId: "id",
      appSecret: "sec",
      fetchImpl: fetchMock as unknown as typeof fetch,
      signal: AbortSignal.timeout(5_000),
      scopes: [...META_SCOPES],
    });
    const ms = new Date(tokens.expiresAt!).getTime() - Date.now();
    expect(ms).toBeGreaterThan(50 * 24 * 60 * 60 * 1000);
  });
});

describe("pending identity", () => {
  it("fetchIdentity returns pending:* before Page selection", async () => {
    fb.bindExternalId(null);
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "user-9", name: "Lan" }));
    const identity = await fb.oauth.fetchIdentity(userTokens, AbortSignal.timeout(5_000));
    expect(identity.externalId).toBe("pending:user-9");
    expect(identity.displayName).toBe("Lan");
  });
});
