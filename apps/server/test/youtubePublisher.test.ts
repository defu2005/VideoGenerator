import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YOUTUBE_FULL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_QUOTA_COST,
  YOUTUBE_UPLOAD_SCOPE,
  type PublishInput,
  type TokenSet,
} from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig } from "../src/lib/config.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import {
  nextPacificMidnightIso,
  pacificDateKey,
  YoutubeQuotaTracker,
} from "../src/publishing/youtubeQuota.js";
import {
  mapYoutubeApiError,
  YouTubePublisher,
  YoutubeQuotaExceededError,
  YOUTUBE_CHUNK_SIZE,
} from "../src/publishing/youtubePublisher.js";

const root = mkdtempSync(join(tmpdir(), "vg-yt-"));
let dataDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let vault: TokenVault;
let publisher: YouTubePublisher;
let fetchMock: ReturnType<typeof vi.fn>;
let accountId: string;
let profileId: string;

const tokens: TokenSet = {
  accessToken: "ya29.access-test",
  refreshToken: "1//refresh-test",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scopes: [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE],
  tokenType: "Bearer",
};

function baseInput(overrides: Partial<PublishInput> = {}): PublishInput {
  const videoPath = join(dataDir, "clip.mp4");
  writeFileSync(videoPath, Buffer.alloc(YOUTUBE_CHUNK_SIZE + 100, 1));
  return {
    videoPath,
    format: "landscape",
    title: "Test title",
    description: "A description",
    tags: ["edu", "history"],
    visibility: "public",
    language: "vi",
    madeForKids: false,
    aiDisclosure: true,
    durationSec: 60,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
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
    YOUTUBE_CLIENT_ID: "env-client-id",
    YOUTUBE_CLIENT_SECRET: "env-client-secret",
    YOUTUBE_DAILY_QUOTA: "10000",
    LLM_ENABLE_MOCK: "true",
    WORKER_ENABLED: "false",
  });
  vault = new TokenVault(sqlite, dataDir, undefined);
  fetchMock = vi.fn();
  publisher = new YouTubePublisher({
    config,
    vault,
    sqlite,
    fetchImpl: fetchMock as unknown as typeof fetch,
    chunkSize: YOUTUBE_CHUNK_SIZE,
  });

  profileId = randomUUID();
  accountId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at)
     VALUES (?, ?, '', '', 'vi', ?, NULL, ?, NULL, NULL, '#3B82F6', NULL, ?, ?)`,
  ).run(
    profileId,
    `P-${profileId.slice(0, 8)}`,
    JSON.stringify({ platform: "youtube" }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    now,
    now,
  );
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, publish_settings, created_at, updated_at
    ) VALUES (?, ?, 'youtube', 'YT', '@yt', NULL, 'landscape', 1, 'NOT_CONNECTED', NULL, NULL, ?, ?, ?)`,
  ).run(
    accountId,
    profileId,
    JSON.stringify({ visibility: "public", autoPublish: false }),
    now,
    now,
  );
});

afterEach(() => {
  sqlite.close();
});

describe("youtubeQuota helpers", () => {
  it("computes pacific date and next midnight after now", () => {
    const now = new Date("2026-11-04T20:00:00.000Z");
    expect(pacificDateKey(now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const next = new Date(nextPacificMidnightIso(now));
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(pacificDateKey(next)).not.toBe(pacificDateKey(now));
  });

  it("tracks daily usage and refuses when the next upload would exceed", () => {
    const tracker = new YoutubeQuotaTracker(sqlite, 200);
    expect(tracker.wouldExceed(100)).toBe(false);
    tracker.record(100);
    expect(tracker.getState().used).toBe(100);
    expect(tracker.wouldExceed(100)).toBe(false);
    expect(tracker.wouldExceed(101)).toBe(true);
  });
});

describe("YouTubePublisher OAuth", () => {
  it("builds auth URL with PKCE, offline access, consent and scopes", () => {
    const url = new URL(publisher.oauth.buildAuthUrl({
      accountId,
      redirectUri: "http://127.0.0.1:3001/api/oauth/youtube/callback",
      state: "state-1",
      codeChallenge: "challenge-abc",
    }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe("env-client-id");
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain(YOUTUBE_UPLOAD_SCOPE);
    expect(scopes).toContain(YOUTUBE_READONLY_SCOPE);
    expect(scopes).not.toContain(YOUTUBE_FULL_SCOPE);
  });

  it("requests full youtube scope when playlistId is configured", () => {
    sqlite.prepare("UPDATE platform_accounts SET publish_settings = ? WHERE id = ?").run(
      JSON.stringify({ visibility: "public", autoPublish: false, playlistId: "PLtest" }),
      accountId,
    );
    const url = new URL(publisher.oauth.buildAuthUrl({
      accountId,
      redirectUri: "http://127.0.0.1:3001/api/oauth/youtube/callback",
      state: "s",
      codeChallenge: "c",
    }));
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];
    expect(scopes).toContain(YOUTUBE_FULL_SCOPE);
    expect(scopes).not.toContain(YOUTUBE_READONLY_SCOPE);
  });

  it("exchanges code and refreshes tokens", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: "ya29.new",
      refresh_token: "1//new-refresh",
      expires_in: 3600,
      scope: `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READONLY_SCOPE}`,
      token_type: "Bearer",
    }));
    const exchanged = await publisher.oauth.exchangeCode({
      code: "auth-code",
      redirectUri: "http://127.0.0.1:3001/api/oauth/youtube/callback",
      codeVerifier: "verifier",
      accountId,
    }, AbortSignal.timeout(5_000));
    expect(exchanged.accessToken).toBe("ya29.new");
    expect(exchanged.refreshToken).toBe("1//new-refresh");
    const tokenCall = fetchMock.mock.calls[0]!;
    expect(String(tokenCall[0])).toBe("https://oauth2.googleapis.com/token");
    expect(String(tokenCall[1]?.body)).toContain("code_verifier=verifier");

    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: "ya29.refreshed",
      expires_in: 1800,
      token_type: "Bearer",
    }));
    const refreshed = await publisher.oauth.refresh(exchanged, AbortSignal.timeout(5_000), accountId);
    expect(refreshed.accessToken).toBe("ya29.refreshed");
    expect(refreshed.refreshToken).toBe("1//new-refresh");
  });

  it("parses channel identity", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      items: [{
        id: "UCabc",
        snippet: { title: "My Channel", customUrl: "@mychannel" },
      }],
    }));
    const identity = await publisher.oauth.fetchIdentity(tokens, AbortSignal.timeout(5_000));
    expect(identity).toEqual({
      displayName: "My Channel",
      handle: "@mychannel",
      externalId: "UCabc",
    });
  });
});

describe("YouTubePublisher upload", () => {
  it("runs resumable init → two chunks → done with progress", async () => {
    const progress: number[] = [];
    const sessionUri = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=sess1";

    fetchMock
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { Location: sessionUri },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 308,
        headers: { Range: `bytes=0-${YOUTUBE_CHUNK_SIZE - 1}` },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "vid123",
        status: { privacyStatus: "public" },
      }, { status: 201 }));

    const result = await publisher.upload(
      baseInput(),
      tokens,
      AbortSignal.timeout(10_000),
      (p) => progress.push(p),
    );
    expect(result.externalId).toBe("vid123");
    expect(result.externalUrl).toContain("vid123");
    expect(progress[0]).toBe(2);
    expect(progress.at(-1)).toBe(100);
    expect(publisher.quota.getState().used).toBe(YOUTUBE_UPLOAD_QUOTA_COST);

    const initBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      status: { privacyStatus: string; containsSyntheticMedia: boolean; publishAt?: string };
      snippet: { categoryId: string };
    };
    expect(initBody.status.privacyStatus).toBe("public");
    expect(initBody.status.containsSyntheticMedia).toBe(true);
    expect(initBody.snippet.categoryId).toBe("27");
    expect(fetchMock.mock.calls[1]![1]?.headers).toMatchObject({
      "Content-Range": `bytes 0-${YOUTUBE_CHUNK_SIZE - 1}/${YOUTUBE_CHUNK_SIZE + 100}`,
    });
  });

  it("resumes after a dropped chunk via status query", async () => {
    const sessionUri = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=sess2";
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUri } }))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response(null, {
        status: 308,
        headers: { Range: `bytes=0-${YOUTUBE_CHUNK_SIZE - 1}` },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "vid-resume",
        status: { privacyStatus: "public" },
      }, { status: 201 }));

    const result = await publisher.upload(
      baseInput(),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    expect(result.externalId).toBe("vid-resume");
    const statusCall = fetchMock.mock.calls[2]!;
    expect(statusCall[1]?.headers).toMatchObject({
      "Content-Range": `bytes */${YOUTUBE_CHUNK_SIZE + 100}`,
    });
  });

  it("schedules with private + publishAt", async () => {
    const sessionUri = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=sched";
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUri } }))
      .mockResolvedValueOnce(jsonResponse({
        id: "vid-sched",
        status: { privacyStatus: "private" },
      }, { status: 201 }));

    // File smaller than one chunk
    const smallPath = join(dataDir, "small.mp4");
    writeFileSync(smallPath, Buffer.alloc(1024, 2));
    await publisher.upload(
      baseInput({
        videoPath: smallPath,
        publishAt: "2026-11-05T10:00:00.000Z",
        visibility: "public",
      }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    const initBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      status: { privacyStatus: string; publishAt: string };
    };
    expect(initBody.status.privacyStatus).toBe("private");
    expect(initBody.status.publishAt).toBe("2026-11-05T10:00:00.000Z");
  });

  it("adds #Shorts for short vertical videos and warns when too long", async () => {
    const sessionUri = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=short";
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUri } }))
      .mockResolvedValueOnce(jsonResponse({ id: "short1", status: { privacyStatus: "public" } }, { status: 201 }));

    const smallPath = join(dataDir, "short.mp4");
    writeFileSync(smallPath, Buffer.alloc(512, 3));
    await publisher.upload(
      baseInput({
        videoPath: smallPath,
        format: "vertical",
        durationSec: 60,
        description: "Vertical tip",
      }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    const shortBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as { snippet: { description: string } };
    expect(shortBody.snippet.description).toContain("#Shorts");

    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUri } }))
      .mockResolvedValueOnce(jsonResponse({ id: "long1", status: { privacyStatus: "public" } }, { status: 201 }));
    const longResult = await publisher.upload(
      baseInput({
        videoPath: smallPath,
        format: "vertical",
        durationSec: 200,
        description: "Too long for Shorts",
      }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    const longBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as { snippet: { description: string } };
    expect(longBody.snippet.description).not.toContain("#Shorts");
    expect(longResult.warnings.some((w) => w.includes("#Shorts"))).toBe(true);
  });

  it("treats thumbnail 403 as a warning, not a failure", async () => {
    const thumbPath = join(dataDir, "thumb.jpg");
    writeFileSync(thumbPath, Buffer.from("jpeg"));
    const smallPath = join(dataDir, "t.mp4");
    writeFileSync(smallPath, Buffer.alloc(256, 4));
    const sessionUri = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=thumb";
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUri } }))
      .mockResolvedValueOnce(jsonResponse({ id: "vid-thumb", status: { privacyStatus: "public" } }, { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "forbidden" } }), { status: 403 }));

    const result = await publisher.upload(
      baseInput({ videoPath: smallPath, thumbnailPath: thumbPath }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    expect(result.externalId).toBe("vid-thumb");
    expect(result.warnings.some((w) => w.includes("thumbnail"))).toBe(true);
  });

  it("warns when YouTube downgrades privacy", async () => {
    const smallPath = join(dataDir, "priv.mp4");
    writeFileSync(smallPath, Buffer.alloc(256, 5));
    const sessionUri = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=priv";
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUri } }))
      .mockResolvedValueOnce(jsonResponse({
        id: "vid-priv",
        status: { privacyStatus: "private" },
      }, { status: 201 }));

    const result = await publisher.upload(
      baseInput({ videoPath: smallPath, visibility: "public" }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    expect(result.visibilityUsed).toBe("private");
    expect(result.warnings.some((w) => w.includes("riêng tư"))).toBe(true);
  });

  it("throws YoutubeQuotaExceededError before upload when budget is exhausted", async () => {
    publisher.quota.setUsed(9950);
    await expect(
      publisher.upload(baseInput(), tokens, AbortSignal.timeout(5_000), () => {}),
    ).rejects.toBeInstanceOf(YoutubeQuotaExceededError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("YouTube error mapping", () => {
  it("maps quota and credential errors to Vietnamese messages", () => {
    const quota = mapYoutubeApiError({
      error: { errors: [{ reason: "quotaExceeded" }], message: "quota" },
    }, 403);
    expect(quota).toBeInstanceOf(YoutubeQuotaExceededError);
    expect(quota.message).toMatch(/hạn mức/i);

    const creds = mapYoutubeApiError({
      error: { errors: [{ reason: "invalidCredentials" }], message: "bad" },
    }, 401);
    expect(creds.message).toMatch(/kết nối lại/i);
    expect((creds as { retryable?: boolean }).retryable).toBe(false);

    const forbidden = mapYoutubeApiError({
      error: { errors: [{ reason: "forbidden" }], message: "no" },
    }, 403);
    expect(forbidden.message).toMatch(/từ chối/i);
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
