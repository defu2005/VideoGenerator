import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TIKTOK_AUDIT_PRIVATE_WARNING_VI,
  TIKTOK_INBOX_SENT_WARNING_VI,
  TIKTOK_MAX_CHUNK_BYTES,
  TIKTOK_MIN_CHUNK_BYTES,
  TIKTOK_PREFERRED_CHUNK_BYTES,
  TIKTOK_SCOPES,
  type PublishInput,
  type TokenSet,
} from "@vg/shared";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig } from "../src/lib/config.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import { OAuthStateStore } from "../src/publishing/oauthState.js";
import {
  buildTikTokCaption,
  mapTikTokApiError,
  planTikTokChunks,
  resolveTikTokPrivacy,
  TikTokPublisher,
} from "../src/publishing/tiktokPublisher.js";
import { createHash } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "vg-tt-"));
let dataDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let vault: TokenVault;
let publisher: TikTokPublisher;
let fetchMock: ReturnType<typeof vi.fn>;
let accountId: string;
let profileId: string;

const tokens: TokenSet = {
  accessToken: "act.tiktok-access",
  refreshToken: "rft.tiktok-refresh",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scopes: [...TIKTOK_SCOPES],
  tokenType: "Bearer",
};

function baseInput(overrides: Partial<PublishInput> = {}): PublishInput {
  const videoPath = join(dataDir, "clip.mp4");
  writeFileSync(videoPath, Buffer.alloc(1024, 1));
  return {
    videoPath,
    format: "vertical",
    title: "Test caption",
    description: "unused on TikTok",
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

function okTikTok(data: Record<string, unknown>): unknown {
  return { data, error: { code: "ok", message: "", log_id: "log1" } };
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
    TIKTOK_CLIENT_KEY: "env-client-key",
    TIKTOK_CLIENT_SECRET: "env-client-secret",
    LLM_ENABLE_MOCK: "true",
    WORKER_ENABLED: "false",
  });
  vault = new TokenVault(sqlite, dataDir, undefined);
  fetchMock = vi.fn();
  publisher = new TikTokPublisher({
    config,
    vault,
    sqlite,
    fetchImpl: fetchMock as unknown as typeof fetch,
    sleep: async () => {},
    statusPollMaxMs: 5_000,
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
    JSON.stringify({ platform: "tiktok" }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    now,
    now,
  );
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, publish_settings, created_at, updated_at
    ) VALUES (?, ?, 'tiktok', 'TT', '@tt', NULL, 'vertical', 1, 'NOT_CONNECTED', NULL, NULL, ?, ?, ?)`,
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

describe("planTikTokChunks", () => {
  it("uses a single chunk for files under 5 MB and up to 64 MB", () => {
    expect(planTikTokChunks(1024)).toEqual({ chunkSize: 1024, totalChunkCount: 1 });
    expect(planTikTokChunks(TIKTOK_MIN_CHUNK_BYTES)).toEqual({
      chunkSize: TIKTOK_MIN_CHUNK_BYTES,
      totalChunkCount: 1,
    });
    expect(planTikTokChunks(TIKTOK_MAX_CHUNK_BYTES)).toEqual({
      chunkSize: TIKTOK_MAX_CHUNK_BYTES,
      totalChunkCount: 1,
    });
  });

  it("splits files larger than 64 MB into multiple chunks", () => {
    const size = TIKTOK_MAX_CHUNK_BYTES + TIKTOK_PREFERRED_CHUNK_BYTES;
    const plan = planTikTokChunks(size);
    expect(plan.totalChunkCount).toBeGreaterThanOrEqual(2);
    expect(plan.chunkSize).toBeGreaterThanOrEqual(TIKTOK_MIN_CHUNK_BYTES);
    expect(plan.chunkSize).toBeLessThanOrEqual(TIKTOK_MAX_CHUNK_BYTES);
    expect(plan.totalChunkCount).toBe(Math.floor(size / plan.chunkSize));
  });
});

describe("buildTikTokCaption / privacy", () => {
  it("merges hashtags into the caption and trims UTF-16 length", () => {
    expect(buildTikTokCaption("Hello", ["edu", "#history"])).toBe("Hello\n\n#edu #history");
    const long = "x".repeat(2300);
    expect(buildTikTokCaption(long, []).length).toBe(2200);
  });

  it("downgrades public to SELF_ONLY with the audit warning", () => {
    const resolved = resolveTikTokPrivacy("public", ["SELF_ONLY"]);
    expect(resolved.privacyLevel).toBe("SELF_ONLY");
    expect(resolved.warning).toBe(TIKTOK_AUDIT_PRIVATE_WARNING_VI);
    expect(resolved.visibilityUsed).toBe("private");
  });

  it("uses PUBLIC_TO_EVERYONE when available", () => {
    const resolved = resolveTikTokPrivacy("public", ["PUBLIC_TO_EVERYONE", "SELF_ONLY"]);
    expect(resolved.privacyLevel).toBe("PUBLIC_TO_EVERYONE");
    expect(resolved.warning).toBeUndefined();
  });
});

describe("OAuthStateStore PKCE for TikTok", () => {
  it("uses hex SHA-256 challenge when challengeEncoding is hex", () => {
    const store = new OAuthStateStore();
    const created = store.create({
      accountId,
      platform: "tiktok",
      redirectUri: "http://127.0.0.1:3001/api/oauth/tiktok/callback",
      challengeEncoding: "hex",
    });
    expect(created.codeChallenge).toBe(
      createHash("sha256").update(created.codeVerifier).digest("hex"),
    );
    expect(created.codeChallenge).toMatch(/^[0-9a-f]+$/);
  });
});

describe("TikTokPublisher OAuth", () => {
  it("builds auth URL with client_key, comma scopes and PKCE", () => {
    const url = new URL(publisher.oauth.buildAuthUrl({
      accountId,
      redirectUri: "http://127.0.0.1:3001/api/oauth/tiktok/callback",
      state: "state-1",
      codeChallenge: "hexchallenge",
    }));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("env-client-key");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(TIKTOK_SCOPES.join(","));
    expect(url.searchParams.get("code_challenge")).toBe("hexchallenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges code and refreshes tokens", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: "act.new",
      refresh_token: "rft.new",
      expires_in: 7200,
      refresh_expires_in: 86400,
      scope: TIKTOK_SCOPES.join(","),
      token_type: "Bearer",
      open_id: "oid1",
    }));
    const exchanged = await publisher.oauth.exchangeCode({
      code: "auth-code",
      redirectUri: "http://127.0.0.1:3001/api/oauth/tiktok/callback",
      codeVerifier: "verifier",
      accountId,
    }, AbortSignal.timeout(5_000));
    expect(exchanged.accessToken).toBe("act.new");
    expect(exchanged.refreshToken).toBe("rft.new");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://open.tiktokapis.com/v2/oauth/token/");
    expect(String(fetchMock.mock.calls[0]![1]?.body)).toContain("code_verifier=verifier");
    expect(String(fetchMock.mock.calls[0]![1]?.body)).toContain("client_key=env-client-key");

    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: "act.refreshed",
      refresh_token: "rft.rotated",
      expires_in: 7200,
      token_type: "Bearer",
    }));
    const refreshed = await publisher.oauth.refresh(exchanged, AbortSignal.timeout(5_000), accountId);
    expect(refreshed.accessToken).toBe("act.refreshed");
    expect(refreshed.refreshToken).toBe("rft.rotated");
  });

  it("parses user identity", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okTikTok({
      user: { open_id: "oid-abc", display_name: "My TT", username: "mytt" },
    })));
    const identity = await publisher.oauth.fetchIdentity(tokens, AbortSignal.timeout(5_000));
    expect(identity).toEqual({
      displayName: "My TT",
      handle: "@mytt",
      externalId: "oid-abc",
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("fields=open_id%2Cdisplay_name%2Cusername");
  });
});

describe("TikTokPublisher upload", () => {
  function mockHappyDirectPost(opts: {
    privacyOptions?: string[];
    statusSequence?: unknown[];
    fileSize?: number;
  } = {}) {
    const uploadUrl = "https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=tok";
    const size = opts.fileSize ?? 1024;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        privacy_level_options: opts.privacyOptions ?? ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
        max_video_post_duration_sec: 600,
        creator_username: "creator1",
      })))
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        publish_id: "v_pub~1",
        upload_url: uploadUrl,
      })))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    for (const statusBody of opts.statusSequence ?? [
      okTikTok({ status: "PROCESSING_UPLOAD" }),
      okTikTok({
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: ["712345"],
      }),
    ]) {
      fetchMock.mockResolvedValueOnce(jsonResponse(statusBody));
    }
    return { uploadUrl, size };
  }

  it("runs creator_info → init → chunk → status polling → complete", async () => {
    const progress: number[] = [];
    mockHappyDirectPost();
    const result = await publisher.upload(
      baseInput(),
      tokens,
      AbortSignal.timeout(10_000),
      (p) => progress.push(p),
    );
    expect(result.externalId).toBe("712345");
    expect(result.externalUrl).toContain("@creator1/video/712345");
    expect(progress[0]).toBe(2);
    expect(progress.at(-1)).toBe(100);

    expect(String(fetchMock.mock.calls[0]![0])).toContain("/creator_info/query/");
    const initBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {
      post_info: { privacy_level: string; is_aigc: boolean; title: string; disable_comment: boolean };
      source_info: { source: string; video_size: number; chunk_size: number; total_chunk_count: number };
    };
    expect(initBody.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(initBody.post_info.is_aigc).toBe(true);
    expect(initBody.post_info.disable_comment).toBe(false);
    expect(initBody.post_info.title).toContain("#edu");
    expect(initBody.source_info).toMatchObject({
      source: "FILE_UPLOAD",
      video_size: 1024,
      chunk_size: 1024,
      total_chunk_count: 1,
    });
    expect(fetchMock.mock.calls[2]![1]?.headers).toMatchObject({
      "Content-Range": "bytes 0-1023/1024",
    });
  });

  it("records privacy downgrade warning when public is not allowed", async () => {
    mockHappyDirectPost({ privacyOptions: ["SELF_ONLY"] });
    const result = await publisher.upload(
      baseInput({ visibility: "public" }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    expect(result.visibilityUsed).toBe("private");
    expect(result.warnings).toContain(TIKTOK_AUDIT_PRIVATE_WARNING_VI);
    const initBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {
      post_info: { privacy_level: string };
    };
    expect(initBody.post_info.privacy_level).toBe("SELF_ONLY");
  });

  it("fails clearly when duration exceeds creator max", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(okTikTok({
      privacy_level_options: ["SELF_ONLY"],
      max_video_post_duration_sec: 60,
      creator_username: "u",
    })));
    await expect(
      publisher.upload(
        baseInput({ durationSec: 120 }),
        tokens,
        AbortSignal.timeout(5_000),
        () => {},
      ),
    ).rejects.toThrow(/vượt giới hạn 60s/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects landscape format", async () => {
    await expect(
      publisher.upload(
        baseInput({ format: "landscape" }),
        tokens,
        AbortSignal.timeout(5_000),
        () => {},
      ),
    ).rejects.toThrow(/chỉ nhận video dọc/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when status is FAILED", async () => {
    mockHappyDirectPost({
      statusSequence: [
        okTikTok({ status: "FAILED", fail_reason: "picture_size_check_failed" }),
      ],
    });
    await expect(
      publisher.upload(baseInput(), tokens, AbortSignal.timeout(10_000), () => {}),
    ).rejects.toThrow(/kích thước/i);
  });

  it("inbox mode uses inbox init and treats SEND_TO_USER_INBOX as success", async () => {
    const uploadUrl = "https://open-upload.tiktokapis.com/video/?upload_id=inbox&upload_token=tok";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        privacy_level_options: ["SELF_ONLY"],
        max_video_post_duration_sec: 600,
        creator_username: "inboxuser",
      })))
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        publish_id: "v_inbox~9",
        upload_url: uploadUrl,
      })))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(okTikTok({ status: "SEND_TO_USER_INBOX" })));

    const result = await publisher.upload(
      baseInput({ tiktokUploadMode: "inbox" }),
      tokens,
      AbortSignal.timeout(10_000),
      () => {},
    );
    expect(result.externalId).toBe("v_inbox~9");
    expect(result.warnings).toContain(TIKTOK_INBOX_SENT_WARNING_VI);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/inbox/video/init/");
    // Inbox init has no post_info
    const initBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as Record<string, unknown>;
    expect(initBody.post_info).toBeUndefined();
  });

  it("uploads multi-chunk files with Content-Range per chunk", async () => {
    const bigSize = TIKTOK_MAX_CHUNK_BYTES + 1000;
    const videoPath = join(dataDir, "big.mp4");
    writeFileSync(videoPath, Buffer.alloc(bigSize, 7));
    const plan = planTikTokChunks(bigSize);
    expect(plan.totalChunkCount).toBeGreaterThanOrEqual(2);

    const uploadUrl = "https://open-upload.tiktokapis.com/video/?upload_id=big&upload_token=tok";
    fetchMock
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
        max_video_post_duration_sec: 600,
        creator_username: "big",
      })))
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        publish_id: "v_pub~big",
        upload_url: uploadUrl,
      })));
    for (let i = 0; i < plan.totalChunkCount - 1; i += 1) {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 206 }));
    }
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(okTikTok({
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: ["99"],
      })));

    await publisher.upload(
      baseInput({ videoPath }),
      tokens,
      AbortSignal.timeout(15_000),
      () => {},
    );

    const initBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)) as {
      source_info: { chunk_size: number; total_chunk_count: number; video_size: number };
    };
    expect(initBody.source_info.video_size).toBe(bigSize);
    expect(initBody.source_info.chunk_size).toBe(plan.chunkSize);
    expect(initBody.source_info.total_chunk_count).toBe(plan.totalChunkCount);

    const firstChunkHeaders = fetchMock.mock.calls[2]![1]?.headers as Record<string, string>;
    expect(firstChunkHeaders["Content-Range"]).toBe(
      `bytes 0-${plan.chunkSize - 1}/${bigSize}`,
    );
  });
});

describe("TikTok error mapping", () => {
  it("maps auth and rate-limit errors", () => {
    const creds = mapTikTokApiError({ error: { code: "access_token_invalid" } }, 401);
    expect(creds.message).toMatch(/kết nối lại/i);
    expect((creds as { retryable?: boolean }).retryable).toBe(false);

    const rate = mapTikTokApiError({ error: { code: "rate_limit_exceeded" } }, 429);
    expect(rate.message).toMatch(/429|giới hạn/i);
    expect((rate as { retryable?: boolean }).retryable).toBe(true);
  });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
