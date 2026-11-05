import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  type PlatformId,
  type TokenSet,
} from "@vg/shared";
import { FacebookCommentFetcher, InstagramCommentFetcher } from "../src/comments/metaFetchers.js";
import { YoutubeCommentFetcher } from "../src/comments/youtubeFetcher.js";
import { CommentInboxService } from "../src/comments/inboxService.js";
import { openDatabase } from "../src/db/client.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { LlmProviderRegistry } from "../src/providers/llm/registry.js";
import * as structuredLlm from "../src/providers/llm/structured.js";
import { PublisherRegistry } from "../src/publishing/registry.js";
import { TokenVault } from "../src/publishing/tokenVault.js";
import type { Publisher } from "../src/publishing/types.js";
import { YoutubeQuotaTracker } from "../src/publishing/youtubeQuota.js";

const root = mkdtempSync(join(tmpdir(), "vg-comments-"));
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const ACCESS_SECRET = "ya29.comment-secret-NEVER-LEAK";

let dataDir: string;
let sqlite: ReturnType<typeof openDatabase>["sqlite"];
let vault: TokenVault;
let config: AppConfig;
let nowMs: number;
const now = () => new Date(nowMs);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  dataDir = join(root, randomUUID());
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "app.db");
  const database = openDatabase(dbPath);
  sqlite = database.sqlite;
  migrateDatabase(database.db, undefined, database.sqlite);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: dbPath,
    LLM_ENABLE_MOCK: "true",
    LLM_CACHE_ENABLED: "false",
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
    WEB_BASE_URL: "http://localhost:5180",
  });
  vault = new TokenVault(sqlite, dataDir, ENCRYPTION_KEY);
  nowMs = Date.parse("2026-11-05T12:00:00.000Z");
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore cleanup races on Windows
  }
});

function seedProfile(settings?: unknown): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO profiles (id, name, description, direction, language, default_brief, voice, guidelines, llm, avatar_path, color, archived_at, created_at, updated_at, comment_settings)
     VALUES (?, ?, '', 'Kể chuyện ngắn', 'vi', ?, NULL, ?, NULL, NULL, '#3B82F6', NULL, ?, ?, ?)`,
  ).run(
    id,
    `P-${id.slice(0, 8)}`,
    JSON.stringify({ platform: "youtube" }),
    JSON.stringify({ platformPack: "auto", customRules: [] }),
    ts,
    ts,
    settings ? JSON.stringify(settings) : null,
  );
  return id;
}

function seedAccount(profileId: string, platform: PlatformId, enabledComments = false): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO platform_accounts (
      id, profile_id, platform, display_name, handle, external_id, format, enabled,
      connection, connection_error, last_checked_at, publish_settings, created_at, updated_at, comments_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, 'landscape', 1, 'CONNECTED', NULL, NULL, ?, ?, ?, ?)`,
  ).run(
    id,
    profileId,
    platform,
    `${platform}-channel`,
    `@${platform}`,
    `channel-${platform}`,
    JSON.stringify({ visibility: "public", autoPublish: false }),
    ts,
    ts,
    enabledComments ? 1 : 0,
  );
  return id;
}

function seedProject(profileId: string): { projectId: string; renderId: string } {
  const projectId = randomUUID();
  const renderId = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO projects (
      id, title, description, topic, mode, run_mode, settings, status, stage,
      thumbnail_path, duration_sec, version, profile_id, created_at, updated_at, archived_at
    ) VALUES (?, 'Biển đêm', '', 'biển', 'BALANCED', 'ASSISTED', ?, 'COMPLETED', 'DONE', NULL, 60, 1, ?, ?, ?, NULL)`,
  ).run(
    projectId,
    JSON.stringify({
      language: "vi",
      budget: { mode: "BALANCED" },
      llm: { default: { provider: "mock", model: "mock-v1" } },
    }),
    profileId,
    ts,
    ts,
  );
  sqlite.prepare(
    `INSERT INTO renders (
      id, project_id, input_hash, status, output_path, credits_path, srt_path,
      duration_sec, size_bytes, width, height, report, created_at, version, note, pinned, deleted_at,
      review_thread_id, metadata_snapshot, aspect_ratio, variant_of
    ) VALUES (?, ?, 'hash', 'DONE', '/tmp/x.mp4', NULL, NULL, 60, 1000, 1920, 1080, ?, ?, 1, NULL, 0, NULL, NULL, NULL, NULL, NULL)`,
  ).run(renderId, projectId, JSON.stringify({ ok: true, issues: [] }), ts);
  sqlite.prepare(
    `INSERT INTO scenes (
      id, project_id, "order", kind, section_id, label, narration, visual_notes, visual_description,
      no_visual, visual_queries, music_mood, energy, est_duration_sec, duration_override_sec, start_sec,
      transition_note, origin, edited, input_hash, created_at, updated_at
    ) VALUES (?, ?, 0, 'narration', NULL, 'Mở', 'Biển đêm rất yên.', '', '', 0, ?, 'calm', 'low', 10, NULL, 0, '', 'generated', 0, 'h', ?, ?)`,
  ).run(randomUUID(), projectId, JSON.stringify({ primary: "sea", alternatives: [] }), ts, ts);
  return { projectId, renderId };
}

function seedPublication(opts: {
  projectId: string;
  renderId: string;
  accountId: string;
  externalId?: string;
  publishedAt?: string;
}): string {
  const id = randomUUID();
  const ts = now().toISOString();
  sqlite.prepare(
    `INSERT INTO publications (
      id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
      guardrail_reason, scheduled_for, external_id, external_url, attempts, last_error, progress,
      warnings, latest_metrics, metrics_synced_at, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, 'PUBLISHED', 'public', 'public', NULL, NULL, ?, ?, 0, NULL, 100, '[]', NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    opts.projectId,
    opts.renderId,
    opts.accountId,
    opts.externalId ?? "vid-1",
    `https://example.com/${opts.externalId ?? "vid-1"}`,
    ts,
    ts,
    opts.publishedAt ?? "2026-11-05T11:00:00.000Z",
  );
  return id;
}

function storeTokens(accountId: string, scopes: string[]): void {
  const tokens: TokenSet = {
    accessToken: ACCESS_SECRET,
    refreshToken: "refresh",
    expiresAt: new Date(nowMs + 3600_000).toISOString(),
    scopes,
    tokenType: "Bearer",
  };
  vault.storeTokens(accountId, tokens, scopes);
}

function registryFor(platform: PlatformId): PublisherRegistry {
  const registry = new PublisherRegistry();
  const publisher: Publisher = {
    platform,
    oauth: {
      buildAuthUrl: () => "https://example.com/auth",
      exchangeCode: async () => ({ accessToken: "x", scopes: [] }),
      refresh: async (tokens) => ({ ...tokens, accessToken: "refreshed-token" }),
      fetchIdentity: async () => ({ displayName: "Ch", externalId: "ext" }),
    },
    upload: async () => ({ externalId: "vid", externalUrl: "https://example.com/v" }),
    limits: {
      maxDurationSec: 600,
      maxTitleChars: 100,
      maxDescriptionChars: 5000,
      maxTags: 10,
      supportsScheduledPublishAt: false,
    },
  };
  registry.register(publisher);
  return registry;
}

function ytThread(
  id: string,
  text: string,
  publishedAt: string,
  author = "Lan",
  authorId = `uc-${id}`,
  withReply = false,
) {
  return {
    snippet: {
      topLevelComment: {
        id,
        snippet: {
          authorDisplayName: author,
          authorChannelId: { value: authorId },
          textOriginal: text,
          likeCount: 2,
          publishedAt,
        },
      },
    },
    replies: withReply ? {
      comments: [{
        id: `${id}-r`,
        snippet: {
          authorDisplayName: "Minh",
          authorChannelId: { value: `uc-${id}-r` },
          textOriginal: `trả lời ${id}`,
          likeCount: 0,
          publishedAt,
          parentId: id,
        },
      }],
    } : undefined,
  };
}

describe("comment fetchers", () => {
  it("maps YouTube threads and stops after an old comment", async () => {
    const urls: string[] = [];
    const fetcher = new YoutubeCommentFetcher({
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const page = new URL(url).searchParams.get("pageToken");
        if (!page) {
          return jsonResponse({
            nextPageToken: "p2",
            items: [ytThread("c-new", "Mới", "2026-11-05T11:30:00.000Z", "Lan", "uc-new", true)],
          });
        }
        return jsonResponse({
          items: [ytThread("c-old", "Cũ", "2026-11-01T00:00:00.000Z", "Lan", "uc-old", true)],
        });
      },
    });
    const all = await fetcher.fetchComments({
      externalId: "vid-1",
      accessToken: ACCESS_SECRET,
      since: null,
      signal: AbortSignal.timeout(1000),
    });
    expect(all.map((item) => item.externalId)).toEqual(["c-new", "c-new-r", "c-old", "c-old-r"]);
    expect(all[1]?.parentExternalId).toBe("c-new");
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("order=time");
    expect(urls.join(" ")).not.toContain(ACCESS_SECRET);

    urls.length = 0;
    const incremental = await fetcher.fetchComments({
      externalId: "vid-1",
      accessToken: ACCESS_SECRET,
      since: "2026-11-05T12:00:00.000Z",
      signal: AbortSignal.timeout(1000),
    });
    expect(incremental).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it("maps Instagram comments and paginates", async () => {
    const urls: string[] = [];
    const fetcher = new InstagramCommentFetcher({
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (!url.includes("after=")) {
          return jsonResponse({
            data: [{
              id: "ig1",
              text: "Hay quá",
              username: "lan",
              timestamp: "2026-11-05T11:00:00+0000",
              like_count: 3,
              replies: { data: [{ id: "ig1r", text: "cảm ơn", username: "minh", timestamp: "2026-11-05T11:05:00+0000", like_count: 0 }] },
            }],
            paging: { cursors: { after: "cursor-2" } },
          });
        }
        return jsonResponse({
          data: [{ id: "ig2", text: "Cũ", username: "old", timestamp: "2026-11-01T00:00:00+0000", like_count: 0 }],
        });
      },
    });
    const fresh = await fetcher.fetchComments({
      externalId: "media-1",
      accessToken: ACCESS_SECRET,
      since: "2026-11-04T00:00:00.000Z",
      signal: AbortSignal.timeout(1000),
    });
    expect(fresh.map((item) => item.externalId)).toEqual(["ig1", "ig1r"]);
    expect(fresh[0]?.authorName).toBe("lan");
    expect(urls).toHaveLength(2);
  });

  it("maps Facebook comments and paginates", async () => {
    const urls: string[] = [];
    const fetcher = new FacebookCommentFetcher({
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (!url.includes("after=")) {
          return jsonResponse({
            data: [{
              id: "fb1",
              message: "Câu hỏi?",
              created_time: "2026-11-05T11:00:00+0000",
              like_count: 1,
              from: { id: "u1", name: "Lan" },
              comments: { data: [{ id: "fb1r", message: "rep", created_time: "2026-11-05T11:02:00+0000", from: { id: "u2", name: "Minh" } }] },
            }],
            paging: { cursors: { after: "fb-2" } },
          });
        }
        return jsonResponse({ data: [] });
      },
    });
    const rows = await fetcher.fetchComments({
      externalId: "post-1",
      accessToken: ACCESS_SECRET,
      since: null,
      signal: AbortSignal.timeout(1000),
    });
    expect(rows.map((item) => item.externalId)).toEqual(["fb1", "fb1r"]);
    expect(rows[0]?.authorExternalId).toBe("u1");
    expect(urls).toHaveLength(2);
  });
});

describe("comment inbox", () => {
  function service(platform: PlatformId, fetchImpl: typeof fetch, extra: { quota?: YoutubeQuotaTracker; notify?: (event: unknown) => Promise<void> } = {}) {
    return new CommentInboxService({
      sqlite,
      vault,
      registry: registryFor(platform),
      llm: new LlmProviderRegistry(config),
      youtubeQuota: extra.quota,
      config,
      now,
      fetchImpl,
      notifications: extra.notify ? { notify: extra.notify } as never : undefined,
    });
  }

  it("marks spam in code and does not call the LLM", async () => {
    const profileId = seedProfile({
      mode: "off",
      repliesPerVideoPerDay: 10,
      repliesPerAccountPerDay: 30,
      tone: "thân thiện",
      emoji: false,
      signature: "",
      spamPhrases: ["kiếm tiền nhanh"],
    });
    const accountId = seedAccount(profileId, "youtube", true);
    storeTokens(accountId, [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_FORCE_SSL_SCOPE]);
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId });
    const spy = vi.spyOn(structuredLlm, "generateRoutedStructured");
    const inbox = service("youtube", async () => jsonResponse({
      items: [
        ytThread("s1", "xem http://spam.test/a", "2026-11-05T11:10:00.000Z", "A", "a"),
        ytThread("s2", "gọi 0901234567", "2026-11-05T11:11:00.000Z", "B", "b"),
        ytThread("s3", "wow!!!!!!", "2026-11-05T11:12:00.000Z", "C", "c"),
        ytThread("s4", "Kiếm tiền nhanh nhé", "2026-11-05T11:13:00.000Z", "D", "d"),
        ytThread("s5", "Xin chào bạn", "2026-11-05T11:14:00.000Z", "E", "e"),
        ytThread("s6", "xin   chào bạn", "2026-11-05T11:15:00.000Z", "E", "e"),
      ],
    }));
    await inbox.tick(AbortSignal.timeout(5000));
    expect(spy).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(spy.mock.calls[0]?.[0]);
    expect(prompt).not.toContain("http://spam");
    expect(prompt).not.toContain("0901234567");
    expect(prompt).not.toContain("wow!!!!!");
    expect(prompt).not.toContain("Kiếm tiền nhanh");
    const rows = sqlite.prepare("SELECT text, status, classification FROM comments").all() as Array<{
      text: string;
      status: string;
      classification: string | null;
    }>;
    const spam = rows.filter((row) => row.classification === "spam");
    expect(spam).toHaveLength(5);
    expect(spam.every((row) => row.status === "spam")).toBe(true);
    expect(rows.some((row) => row.text === "Xin chào bạn" && row.classification !== "spam")).toBe(true);
    expect(rows.some((row) => row.text.includes(ACCESS_SECRET))).toBe(false);
  });

  it("classifies comments in batches of 20", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube", true);
    storeTokens(accountId, [YOUTUBE_FORCE_SSL_SCOPE]);
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId });
    const items = Array.from({ length: 21 }, (_, index) =>
      ytThread(`q${index}`, `Câu ${index}?`, `2026-11-05T11:${String(index).padStart(2, "0")}:00.000Z`, `N${index}`, `id-${index}`),
    );
    const spy = vi.spyOn(structuredLlm, "generateRoutedStructured");
    const inbox = service("youtube", async () => jsonResponse({ items }));
    await inbox.tick(AbortSignal.timeout(8000));
    expect(spy).toHaveBeenCalledTimes(2);
    const classified = sqlite.prepare(
      "SELECT classification FROM comments WHERE status = 'new' OR classification IS NOT NULL",
    ).all() as Array<{ classification: string | null }>;
    const questions = classified.filter((row) => row.classification === "question");
    expect(questions.length).toBeGreaterThanOrEqual(21);
  });

  it("enforces auto-reply limits and never replies to complaint, toxic, old or duplicate text", async () => {
    const settings = {
      mode: "auto_reply",
      repliesPerVideoPerDay: 10,
      repliesPerAccountPerDay: 30,
      tone: "thân thiện",
      emoji: false,
      signature: "",
      spamPhrases: [],
    };
    const profileId = seedProfile(settings);
    const accountId = seedAccount(profileId, "youtube", true);
    storeTokens(accountId, [YOUTUBE_FORCE_SSL_SCOPE]);
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId, externalId: "vid-limits" });
    const posts: string[] = [];
    const hides: string[] = [];
    const inbox = service("youtube", async (input, init) => {
      const url = String(input);
      if (url.includes("commentThreads")) {
        return jsonResponse({
          items: [
            ytThread("p1", "Video hay quá", "2026-11-05T11:00:00.000Z", "An", "an"),
            ytThread("p2", "Thật tuyệt", "2026-11-05T11:01:00.000Z", "Binh", "binh"),
            ytThread("bad", "Video tệ quá", "2026-11-05T11:02:00.000Z", "Chi", "chi"),
            ytThread("tox", "đồ ngốc", "2026-11-05T11:03:00.000Z", "Dung", "dung"),
            ytThread("old", "Hay không?", "2026-10-01T00:00:00.000Z", "Em", "em"),
            ytThread("ask1", "Mấy giờ đăng?", "2026-11-05T11:04:00.000Z", "Giang", "giang"),
            ytThread("ask2", "Có phụ đề?", "2026-11-05T11:05:00.000Z", "Giang", "giang"),
          ],
        });
      }
      if (url.includes("setModerationStatus")) {
        hides.push(url);
        return jsonResponse({});
      }
      if (url.includes("/comments?") && init?.method === "POST") {
        posts.push(String(init.body));
        return jsonResponse({ id: `reply-${posts.length}` });
      }
      return jsonResponse({});
    });
    await inbox.tick(AbortSignal.timeout(8000));
    const parentIds = posts.map((body) => JSON.parse(body) as { snippet: { parentId: string } }).map((body) => body.snippet.parentId);
    expect(parentIds).toContain("p1");
    expect(parentIds).not.toContain("p2");
    expect(parentIds).not.toContain("bad");
    expect(parentIds).not.toContain("tox");
    expect(parentIds).not.toContain("old");
    expect(parentIds.filter((id) => id === "ask1" || id === "ask2")).toHaveLength(1);
    expect(hides.some((url) => url.includes("tox"))).toBe(true);
    const log = sqlite.prepare("SELECT message FROM automation_log").all() as Array<{ message: string }>;
    expect(log.some((row) => row.message.includes("Tự trả lời"))).toBe(true);
    expect(log.some((row) => row.message.includes("Tự ẩn"))).toBe(true);
  });

  it("stops at the per-video and per-account caps", async () => {
    const profileId = seedProfile({
      mode: "auto_reply",
      repliesPerVideoPerDay: 1,
      repliesPerAccountPerDay: 1,
      tone: "thân thiện",
      emoji: false,
      signature: "",
      spamPhrases: [],
    });
    const accountId = seedAccount(profileId, "youtube", true);
    storeTokens(accountId, [YOUTUBE_FORCE_SSL_SCOPE]);
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId, externalId: "vid-a" });
    seedPublication({ projectId, renderId, accountId, externalId: "vid-b" });
    let posts = 0;
    const inbox = service("youtube", async (input, init) => {
      const url = String(input);
      const videoId = new URL(url).searchParams.get("videoId");
      if (url.includes("commentThreads")) {
        const id = videoId === "vid-b" ? "b1" : "a1";
        return jsonResponse({
          items: [ytThread(id, `${id} có không?`, "2026-11-05T11:00:00.000Z", id, id)],
        });
      }
      if (init?.method === "POST" && url.includes("/comments?")) {
        posts += 1;
        return jsonResponse({ id: `r-${posts}` });
      }
      return jsonResponse({});
    });
    await inbox.tick(AbortSignal.timeout(8000));
    expect(posts).toBe(1);
  });

  it("does not reply when YouTube quota is under 20%", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube", true);
    storeTokens(accountId, [YOUTUBE_FORCE_SSL_SCOPE]);
    const { projectId, renderId } = seedProject(profileId);
    const publicationId = seedPublication({ projectId, renderId, accountId });
    const commentId = randomUUID();
    sqlite.prepare(
      `INSERT INTO comments (
        id, publication_id, platform, external_id, author_name, text, like_count, published_at, fetched_at,
        status, classification, priority, suggested_reply, toxic, confidence
      ) VALUES (?, ?, 'youtube', 'c-quota', 'Lan', 'Hay', 0, ?, ?, 'new', 'praise', 20, 'Cảm ơn', 0, 'high')`,
    ).run(commentId, publicationId, now().toISOString(), now().toISOString());
    const quota = new YoutubeQuotaTracker(sqlite, 1000, now);
    quota.setUsed(850);
    let called = 0;
    const inbox = service("youtube", async () => {
      called += 1;
      return jsonResponse({ id: "should-not" });
    }, { quota });
    await expect(inbox.reply(commentId, "Cảm ơn bạn")).rejects.toMatchObject({ code: "YOUTUBE_QUOTA_FLOOR" });
    expect(called).toBe(0);
  });

  it("sets needs_reconnect and does not call the API when the comment scope is missing", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "youtube", true);
    storeTokens(accountId, [YOUTUBE_UPLOAD_SCOPE, YOUTUBE_READONLY_SCOPE]);
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId });
    let called = 0;
    const inbox = service("youtube", async () => {
      called += 1;
      return jsonResponse({ items: [] });
    });
    await inbox.tick(AbortSignal.timeout(3000));
    expect(called).toBe(0);
    const status = sqlite.prepare("SELECT comments_status FROM platform_accounts WHERE id = ?").get(accountId) as {
      comments_status: string;
    };
    expect(status.comments_status).toBe("needs_reconnect");
  });

  it("shows the TikTok unsupported note and does not call an API", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "tiktok");
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId, externalId: "tt-1" });
    let called = 0;
    const inbox = service("tiktok", async () => {
      called += 1;
      return jsonResponse({});
    });
    await inbox.tick(AbortSignal.timeout(3000));
    expect(called).toBe(0);
    const view = inbox.list({});
    expect(view.tiktok[0]?.note).toBe("TikTok chưa hỗ trợ đọc bình luận qua API");
    expect(view.tiktok[0]?.videos[0]?.url).toContain("tt-1");
    const status = sqlite.prepare("SELECT comments_status FROM platform_accounts WHERE id = ?").get(accountId) as {
      comments_status: string;
    };
    expect(status.comments_status).toBe("unsupported");
  });

  it("notifies high-priority comments in an hourly batch", async () => {
    const profileId = seedProfile();
    const accountId = seedAccount(profileId, "instagram_reels", true);
    storeTokens(accountId, ["instagram_manage_comments"]);
    const { projectId, renderId } = seedProject(profileId);
    seedPublication({ projectId, renderId, accountId, externalId: "ig-media" });
    const events: Array<{ kind: string; count: number }> = [];
    const inbox = service("instagram_reels", async () => jsonResponse({
      data: [
        { id: "c1", text: "Video tệ", username: "lan", timestamp: "2026-11-05T11:00:00.000Z", like_count: 0 },
        { id: "c2", text: "Khẩn: sao vậy?", username: "minh", timestamp: "2026-11-05T11:01:00.000Z", like_count: 0 },
      ],
    }), {
      notify: async (event) => {
        const parsed = event as { kind: string; count: number };
        events.push(parsed);
      },
    });
    await inbox.tick(AbortSignal.timeout(5000));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("comment_attention");
    expect(events[0]?.count).toBe(2);
    events.length = 0;
    nowMs += 10 * 60 * 1000;
    await inbox.tick(AbortSignal.timeout(5000));
    expect(events).toHaveLength(0);
  });
});
