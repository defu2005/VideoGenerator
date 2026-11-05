import { statSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import {
  TIKTOK_AUDIT_PRIVATE_WARNING_VI,
  TIKTOK_CAPTION_MAX_UTF16,
  TIKTOK_INBOX_SENT_WARNING_VI,
  TIKTOK_MAX_CHUNK_BYTES,
  TIKTOK_MAX_FINAL_CHUNK_BYTES,
  TIKTOK_MIN_CHUNK_BYTES,
  TIKTOK_PREFERRED_CHUNK_BYTES,
  TIKTOK_SCOPES,
  type PublishInput,
  type PublishResult,
  type PublishVisibility,
  type TikTokUploadModeValue,
  type TokenSet,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import type { TokenVault } from "./tokenVault.js";
import type { Publisher, PublisherIdentity } from "./types.js";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const API_BASE = "https://open.tiktokapis.com";
const CREATOR_INFO_URL = `${API_BASE}/v2/post/publish/creator_info/query/`;
const DIRECT_INIT_URL = `${API_BASE}/v2/post/publish/video/init/`;
const INBOX_INIT_URL = `${API_BASE}/v2/post/publish/inbox/video/init/`;
const STATUS_URL = `${API_BASE}/v2/post/publish/status/fetch/`;
const USER_INFO_URL = `${API_BASE}/v2/user/info/`;

export type TikTokFetch = typeof fetch;

export type TikTokPrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type TikTokPublisherOptions = {
  config: AppConfig;
  vault: TokenVault;
  sqlite: Database.Database;
  fetchImpl?: TikTokFetch;
  /** Injected sleep for status polling / 429 backoff (tests use a no-op or short delay). */
  sleep?: (ms: number) => Promise<void>;
  /** Max wall time for status polling (default ~10 minutes). */
  statusPollMaxMs?: number;
  now?: () => Date;
};

type AccountCredRow = { id: string; profile_id: string; publish_settings: string };

type CreatorInfo = {
  privacyLevelOptions: TikTokPrivacyLevel[];
  maxVideoPostDurationSec: number;
  creatorUsername?: string;
};

type InitUploadResult = {
  publishId: string;
  uploadUrl: string;
};

/**
 * Plan FILE_UPLOAD chunks per TikTok media transfer rules:
 * - &lt; 5 MB or ≤ 64 MB → single chunk (chunk_size = file size)
 * - &gt; 64 MB → multiple chunks; chunk_size in 5–64 MB; last chunk may exceed chunk_size up to 128 MB
 * - total_chunk_count = floor(video_size / chunk_size)
 */
export function planTikTokChunks(videoSize: number): { chunkSize: number; totalChunkCount: number } {
  if (!Number.isFinite(videoSize) || videoSize <= 0) {
    throw Object.assign(new Error("Kích thước video TikTok không hợp lệ"), {
      status: 400,
      retryable: false,
    });
  }
  if (videoSize <= TIKTOK_MAX_CHUNK_BYTES) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }

  let chunkSize = TIKTOK_PREFERRED_CHUNK_BYTES;
  let totalChunkCount = Math.floor(videoSize / chunkSize);
  let lastSize = videoSize - (totalChunkCount - 1) * chunkSize;

  while (
    (totalChunkCount < 2 || lastSize > TIKTOK_MAX_FINAL_CHUNK_BYTES)
    && chunkSize > TIKTOK_MIN_CHUNK_BYTES
  ) {
    chunkSize = Math.max(TIKTOK_MIN_CHUNK_BYTES, Math.floor(chunkSize / 2));
    totalChunkCount = Math.floor(videoSize / chunkSize);
    lastSize = videoSize - (totalChunkCount - 1) * chunkSize;
  }

  if (totalChunkCount < 2) {
    chunkSize = Math.min(
      TIKTOK_MAX_CHUNK_BYTES,
      Math.max(TIKTOK_MIN_CHUNK_BYTES, Math.ceil(videoSize / 2)),
    );
    totalChunkCount = Math.max(2, Math.floor(videoSize / chunkSize));
  }

  return { chunkSize, totalChunkCount };
}

export function buildTikTokCaption(title: string, tags: string[]): string {
  const hashtags = tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  const base = title.trim();
  const caption = hashtags.length
    ? (base ? `${base}\n\n${hashtags.join(" ")}` : hashtags.join(" "))
    : base;
  return trimUtf16(caption, TIKTOK_CAPTION_MAX_UTF16);
}

export function resolveTikTokPrivacy(
  visibility: PublishVisibility,
  options: TikTokPrivacyLevel[],
): { privacyLevel: TikTokPrivacyLevel; warning?: string; visibilityUsed?: PublishVisibility } {
  const available = new Set(options);
  const preferred = preferredPrivacyForVisibility(visibility);

  if (available.has(preferred)) {
    return { privacyLevel: preferred };
  }

  // Public requested but not allowed (unaudited app) → SELF_ONLY + audit warning.
  if (visibility === "public" && available.has("SELF_ONLY")) {
    return {
      privacyLevel: "SELF_ONLY",
      warning: TIKTOK_AUDIT_PRIVATE_WARNING_VI,
      visibilityUsed: "private",
    };
  }

  // Fallbacks in preference order
  const fallbacks: TikTokPrivacyLevel[] = [
    "SELF_ONLY",
    "MUTUAL_FOLLOW_FRIENDS",
    "FOLLOWER_OF_CREATOR",
    "PUBLIC_TO_EVERYONE",
  ];
  for (const level of fallbacks) {
    if (available.has(level)) {
      const used = privacyToVisibility(level);
      return {
        privacyLevel: level,
        ...(used !== visibility
          ? {
            warning: visibility === "public"
              ? TIKTOK_AUDIT_PRIVATE_WARNING_VI
              : `TikTok chỉ cho phép mức riêng tư "${level}"; đã dùng mức này.`,
            visibilityUsed: used,
          }
          : {}),
      };
    }
  }

  throw Object.assign(
    new Error("TikTok không trả về privacy_level_options hợp lệ"),
    { status: 502, retryable: true },
  );
}

function preferredPrivacyForVisibility(visibility: PublishVisibility): TikTokPrivacyLevel {
  if (visibility === "public") return "PUBLIC_TO_EVERYONE";
  if (visibility === "unlisted") return "MUTUAL_FOLLOW_FRIENDS";
  return "SELF_ONLY";
}

function privacyToVisibility(level: TikTokPrivacyLevel): PublishVisibility {
  if (level === "PUBLIC_TO_EVERYONE") return "public";
  if (level === "SELF_ONLY") return "private";
  return "unlisted";
}

export class TikTokPublisher implements Publisher {
  readonly platform = "tiktok" as const;
  readonly limits = {
    maxDurationSec: 10 * 60,
    maxTitleChars: TIKTOK_CAPTION_MAX_UTF16,
    maxDescriptionChars: TIKTOK_CAPTION_MAX_UTF16,
    maxTags: 30,
    supportsScheduledPublishAt: false,
  };

  private readonly fetchImpl: TikTokFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly statusPollMaxMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: TikTokPublisherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.statusPollMaxMs = options.statusPollMaxMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  /** Resolve vault-first (clientId = Client Key), then .env fallback. */
  resolveCredentials(accountId: string): { clientKey: string; clientSecret: string } {
    const account = this.requireAccount(accountId);
    const vaultCreds = this.options.vault.loadAppCredentials(
      accountId,
      account.profile_id,
      "tiktok",
    );
    if (vaultCreds?.clientId && vaultCreds.clientSecret) {
      return { clientKey: vaultCreds.clientId, clientSecret: vaultCreds.clientSecret };
    }
    const clientKey = this.options.config.TIKTOK_CLIENT_KEY?.trim();
    const clientSecret = this.options.config.TIKTOK_CLIENT_SECRET?.trim();
    if (clientKey && clientSecret) {
      return { clientKey, clientSecret };
    }
    throw Object.assign(new Error("Chưa cấu hình Client Key/Secret cho TikTok"), {
      status: 400,
      retryable: false,
      code: "TIKTOK_CREDENTIALS_MISSING",
    });
  }

  readonly oauth = {
    buildAuthUrl: (input: {
      accountId: string;
      redirectUri: string;
      state: string;
      codeChallenge: string;
    }): string => {
      const { clientKey } = this.resolveCredentials(input.accountId);
      const url = new URL(AUTH_URL);
      url.searchParams.set("client_key", clientKey);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    exchangeCode: async (
      input: { code: string; redirectUri: string; codeVerifier: string; accountId: string },
      signal: AbortSignal,
    ): Promise<TokenSet> => {
      const { clientKey, clientSecret } = this.resolveCredentials(input.accountId);
      const body = new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      });
      const response = await this.fetchWithRetry(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!response.ok) {
        throw mapTikTokAuthError(await safeJson(response), response.status);
      }
      return parseTokenResponse(await response.json(), [...TIKTOK_SCOPES]);
    },

    refresh: async (tokens: TokenSet, signal: AbortSignal, accountId?: string): Promise<TokenSet> => {
      if (!tokens.refreshToken) {
        throw Object.assign(new Error("Cần kết nối lại tài khoản"), {
          status: 401,
          retryable: false,
          code: "invalidCredentials",
        });
      }
      if (!accountId) {
        throw Object.assign(new Error("Thiếu accountId khi làm mới token TikTok"), {
          status: 400,
          retryable: false,
        });
      }
      const { clientKey, clientSecret } = this.resolveCredentials(accountId);
      const body = new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });
      const response = await this.fetchWithRetry(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!response.ok) {
        throw mapTikTokAuthError(await safeJson(response), response.status);
      }
      const parsed = parseTokenResponse(await response.json(), tokens.scopes);
      return {
        ...parsed,
        // TikTok rotates refresh tokens — prefer the new one when present.
        refreshToken: parsed.refreshToken ?? tokens.refreshToken,
      };
    },

    revoke: async (tokens: TokenSet, signal: AbortSignal, accountId?: string): Promise<void> => {
      if (!accountId) return;
      let clientKey: string;
      let clientSecret: string;
      try {
        ({ clientKey, clientSecret } = this.resolveCredentials(accountId));
      } catch {
        return;
      }
      const body = new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        token: tokens.accessToken,
      });
      const response = await this.fetchImpl(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!response.ok && response.status !== 400) {
        throw Object.assign(new Error("Thu hồi token TikTok thất bại"), {
          status: response.status,
          retryable: false,
        });
      }
    },

    fetchIdentity: async (tokens: TokenSet, signal: AbortSignal): Promise<PublisherIdentity> => {
      const url = new URL(USER_INFO_URL);
      url.searchParams.set("fields", "open_id,display_name,username");
      const response = await this.fetchWithRetry(url.toString(), {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        signal,
      });
      if (!response.ok) {
        throw mapTikTokApiError(await safeJson(response), response.status);
      }
      const data = await response.json() as {
        data?: { user?: { open_id?: string; display_name?: string; username?: string } };
        error?: { code?: string };
      };
      assertTikTokOk(data);
      const user = data.data?.user;
      if (!user?.open_id) {
        throw Object.assign(new Error("Không tìm thấy hồ sơ TikTok của tài khoản"), {
          status: 404,
          retryable: false,
        });
      }
      const username = user.username?.trim();
      return {
        displayName: user.display_name?.trim() || "TikTok",
        ...(username ? { handle: username.startsWith("@") ? username : `@${username}` } : {}),
        externalId: user.open_id,
      };
    },
  };

  async upload(
    input: PublishInput,
    tokens: TokenSet,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ): Promise<PublishResult> {
    if (signal.aborted) throw Object.assign(new Error("aborted"), { status: 499, retryable: false });

    if (input.format !== "vertical") {
      throw Object.assign(
        new Error("TikTok chỉ nhận video dọc (9:16). Hãy render biến thể vertical trước."),
        { status: 400, retryable: false, code: "TIKTOK_FORMAT" },
      );
    }

    const warnings: string[] = [];
    const mode = resolveUploadMode(input);
    onProgress(2);

    const creator = await this.queryCreatorInfo(tokens.accessToken, signal);
    const duration = input.durationSec ?? 0;
    if (duration > 0 && duration > creator.maxVideoPostDurationSec) {
      throw Object.assign(
        new Error(
          `Video dài ${Math.round(duration)}s, vượt giới hạn ${creator.maxVideoPostDurationSec}s của tài khoản TikTok.`,
        ),
        { status: 400, retryable: false, code: "TIKTOK_DURATION" },
      );
    }

    const fileStat = statSync(input.videoPath);
    const fileSize = fileStat.size;
    const plan = planTikTokChunks(fileSize);
    const caption = buildTikTokCaption(input.title, input.tags);

    let privacyLevel: TikTokPrivacyLevel | undefined;
    let visibilityUsed: PublishVisibility | undefined;

    let init: InitUploadResult;
    if (mode === "inbox") {
      init = await this.initInboxUpload(tokens.accessToken, plan, fileSize, signal);
    } else {
      const resolved = resolveTikTokPrivacy(input.visibility, creator.privacyLevelOptions);
      privacyLevel = resolved.privacyLevel;
      if (resolved.warning) warnings.push(resolved.warning);
      if (resolved.visibilityUsed) visibilityUsed = resolved.visibilityUsed;

      init = await this.initDirectPost({
        accessToken: tokens.accessToken,
        caption,
        privacyLevel,
        plan,
        fileSize,
        signal,
        ...(input.coverTimestampMs !== undefined ? { coverTimestampMs: input.coverTimestampMs } : {}),
      });
    }

    onProgress(8);
    await this.uploadChunks({
      uploadUrl: init.uploadUrl,
      videoPath: input.videoPath,
      fileSize,
      chunkSize: plan.chunkSize,
      totalChunkCount: plan.totalChunkCount,
      signal,
      onProgress,
    });

    onProgress(92);
    const status = await this.pollStatus({
      accessToken: tokens.accessToken,
      publishId: init.publishId,
      mode,
      signal,
    });

    if (status.status === "FAILED") {
      throw Object.assign(
        new Error(mapFailReason(status.failReason) ?? "Đăng TikTok thất bại"),
        { status: 502, retryable: false, code: status.failReason ?? "TIKTOK_FAILED" },
      );
    }

    if (mode === "inbox" && status.status === "SEND_TO_USER_INBOX") {
      warnings.push(TIKTOK_INBOX_SENT_WARNING_VI);
    }

    const username = creator.creatorUsername
      ?? this.readHandleFromAccount()
      ?? undefined;
    const postId = status.publicPostIds?.[0];
    const externalUrl = postId
      ? (username
        ? `https://www.tiktok.com/@${username.replace(/^@/, "")}/video/${postId}`
        : `https://www.tiktok.com/video/${postId}`)
      : (username
        ? `https://www.tiktok.com/@${username.replace(/^@/, "")}`
        : "https://www.tiktok.com/");

    onProgress(100);
    return {
      externalId: postId ?? init.publishId,
      externalUrl,
      warnings,
      ...(visibilityUsed ? { visibilityUsed } : {}),
    };
  }

  private async queryCreatorInfo(accessToken: string, signal: AbortSignal): Promise<CreatorInfo> {
    const response = await this.fetchWithRetry(CREATOR_INFO_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: "{}",
      signal,
    });
    if (!response.ok) {
      throw mapTikTokApiError(await safeJson(response), response.status);
    }
    const data = await response.json() as {
      data?: {
        privacy_level_options?: string[];
        max_video_post_duration_sec?: number;
        creator_username?: string;
      };
      error?: { code?: string; message?: string };
    };
    assertTikTokOk(data);
    const options = (data.data?.privacy_level_options ?? []).filter(isPrivacyLevel);
    if (options.length === 0) {
      throw Object.assign(new Error("TikTok không trả privacy_level_options"), {
        status: 502,
        retryable: true,
      });
    }
    const maxSec = data.data?.max_video_post_duration_sec;
    return {
      privacyLevelOptions: options,
      maxVideoPostDurationSec: typeof maxSec === "number" && maxSec > 0 ? maxSec : this.limits.maxDurationSec,
      ...(data.data?.creator_username ? { creatorUsername: data.data.creator_username } : {}),
    };
  }

  private async initDirectPost(input: {
    accessToken: string;
    caption: string;
    privacyLevel: TikTokPrivacyLevel;
    plan: { chunkSize: number; totalChunkCount: number };
    fileSize: number;
    signal: AbortSignal;
    coverTimestampMs?: number;
  }): Promise<InitUploadResult> {
    const response = await this.fetchWithRetry(DIRECT_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title: input.caption,
          privacy_level: input.privacyLevel,
          disable_comment: false,
          brand_content_toggle: false,
          brand_organic_toggle: false,
          is_aigc: true,
          ...(input.coverTimestampMs !== undefined
            ? { video_cover_timestamp_ms: input.coverTimestampMs }
            : {}),
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: input.fileSize,
          chunk_size: input.plan.chunkSize,
          total_chunk_count: input.plan.totalChunkCount,
        },
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      throw mapTikTokApiError(await safeJson(response), response.status);
    }
    return parseInitResponse(await response.json());
  }

  private async initInboxUpload(
    accessToken: string,
    plan: { chunkSize: number; totalChunkCount: number },
    fileSize: number,
    signal: AbortSignal,
  ): Promise<InitUploadResult> {
    const response = await this.fetchWithRetry(INBOX_INIT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: fileSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      }),
      signal,
    });
    if (!response.ok) {
      throw mapTikTokApiError(await safeJson(response), response.status);
    }
    return parseInitResponse(await response.json());
  }

  private async uploadChunks(input: {
    uploadUrl: string;
    videoPath: string;
    fileSize: number;
    chunkSize: number;
    totalChunkCount: number;
    signal: AbortSignal;
    onProgress: (progress: number) => void;
  }): Promise<void> {
    let offset = 0;
    for (let index = 0; index < input.totalChunkCount; index += 1) {
      if (input.signal.aborted) {
        throw Object.assign(new Error("aborted"), { status: 499, retryable: false });
      }
      const isLast = index === input.totalChunkCount - 1;
      const end = isLast
        ? input.fileSize - 1
        : Math.min(offset + input.chunkSize, input.fileSize) - 1;
      const chunkLength = end - offset + 1;
      const chunk = await readFileRange(input.videoPath, offset, chunkLength);

      const response = await this.fetchWithRetry(input.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunkLength),
          "Content-Range": `bytes ${offset}-${end}/${input.fileSize}`,
        },
        body: toBody(chunk),
        signal: input.signal,
      }, { retryPut: true });

      if (response.status === 201) {
        input.onProgress(90);
        return;
      }
      if (response.status === 206) {
        offset = end + 1;
        const pct = 8 + Math.floor(((offset) / input.fileSize) * 82);
        input.onProgress(Math.min(90, pct));
        continue;
      }
      throw mapTikTokApiError(await safeJson(response), response.status);
    }
  }

  private async pollStatus(input: {
    accessToken: string;
    publishId: string;
    mode: TikTokUploadModeValue;
    signal: AbortSignal;
  }): Promise<{
    status: string;
    failReason?: string;
    publicPostIds?: string[];
  }> {
    const started = this.now().getTime();
    let delayMs = 1_000;
    while (true) {
      if (input.signal.aborted) {
        throw Object.assign(new Error("aborted"), { status: 499, retryable: false });
      }
      if (this.now().getTime() - started > this.statusPollMaxMs) {
        throw Object.assign(new Error("Hết thời gian chờ TikTok xử lý video (~10 phút)"), {
          status: 504,
          retryable: true,
        });
      }

      const response = await this.fetchWithRetry(STATUS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: input.publishId }),
        signal: input.signal,
      });
      if (!response.ok) {
        throw mapTikTokApiError(await safeJson(response), response.status);
      }
      const data = await response.json() as {
        data?: {
          status?: string;
          fail_reason?: string;
          publicaly_available_post_id?: Array<string | number>;
          publicly_available_post_id?: Array<string | number>;
        };
        error?: { code?: string };
      };
      assertTikTokOk(data);
      const status = data.data?.status ?? "";
      const rawIds = data.data?.publicaly_available_post_id
        ?? data.data?.publicly_available_post_id
        ?? [];
      const publicPostIds = rawIds.map(String).filter(Boolean);

      if (status === "FAILED") {
        return { status, failReason: data.data?.fail_reason, publicPostIds };
      }
      if (status === "PUBLISH_COMPLETE") {
        return { status, publicPostIds };
      }
      if (input.mode === "inbox" && status === "SEND_TO_USER_INBOX") {
        return { status, publicPostIds };
      }

      await this.sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 15_000);
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    options: { retryPut?: boolean } = {},
  ): Promise<Response> {
    let attempt = 0;
    const maxAttempts = 4;
    while (true) {
      attempt += 1;
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (error) {
        if (attempt >= maxAttempts || init.signal?.aborted) throw error;
        await this.sleep(250 * attempt);
        continue;
      }
      if (response.status === 429 && attempt < maxAttempts) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 500 * attempt;
        await this.sleep(waitMs);
        continue;
      }
      if (
        options.retryPut
        && (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504)
        && attempt < maxAttempts
      ) {
        await this.sleep(400 * attempt);
        continue;
      }
      return response;
    }
  }

  private requireAccount(accountId: string): AccountCredRow {
    const row = this.options.sqlite.prepare(
      "SELECT id, profile_id, publish_settings FROM platform_accounts WHERE id = ?",
    ).get(accountId) as AccountCredRow | undefined;
    if (!row) {
      throw Object.assign(new Error("Không tìm thấy tài khoản"), { status: 404, retryable: false });
    }
    return row;
  }

  private readHandleFromAccount(): string | null {
    // Best-effort: no accountId on upload path; handle comes from creator_info when present.
    return null;
  }
}

function resolveUploadMode(input: PublishInput): TikTokUploadModeValue {
  return input.tiktokUploadMode === "inbox" ? "inbox" : "direct_post";
}

function isPrivacyLevel(value: string): value is TikTokPrivacyLevel {
  return value === "PUBLIC_TO_EVERYONE"
    || value === "MUTUAL_FOLLOW_FRIENDS"
    || value === "FOLLOWER_OF_CREATOR"
    || value === "SELF_ONLY";
}

function parseInitResponse(raw: unknown): InitUploadResult {
  const data = raw as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };
  assertTikTokOk(data);
  const publishId = data.data?.publish_id;
  const uploadUrl = data.data?.upload_url;
  if (!publishId || !uploadUrl) {
    throw Object.assign(new Error("TikTok không trả publish_id/upload_url"), {
      status: 502,
      retryable: true,
    });
  }
  return { publishId, uploadUrl };
}

function assertTikTokOk(body: { error?: { code?: string; message?: string } } | null | undefined): void {
  const code = body?.error?.code;
  if (code && code !== "ok") {
    throw mapTikTokApiError(body, 400);
  }
}

function parseTokenResponse(raw: unknown, fallbackScopes: string[]): TokenSet {
  const data = raw as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    scope?: string;
    token_type?: string;
    open_id?: string;
  };
  if (!data.access_token) {
    throw Object.assign(new Error("Phản hồi token TikTok không hợp lệ"), {
      status: 502,
      retryable: true,
    });
  }
  const scopes = data.scope
    ? data.scope.split(/[,\s]+/).filter(Boolean)
    : fallbackScopes;
  return {
    accessToken: data.access_token,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    ...(typeof data.expires_in === "number"
      ? { expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() }
      : {}),
    scopes,
    ...(data.token_type ? { tokenType: data.token_type } : {}),
  };
}

async function readFileRange(path: string, start: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await openFile(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function toBody(buffer: Buffer): BodyInit {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as BodyInit;
}

function trimUtf16(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  return text.slice(0, maxUnits);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapTikTokAuthError(body: unknown, status: number): Error {
  const error = (body as { error?: string; error_description?: string } | null)?.error;
  if (error === "invalid_grant" || error === "invalid_client" || status === 401) {
    return Object.assign(new Error("Thông tin đăng nhập TikTok không hợp lệ — cần Kết nối lại"), {
      status: 401,
      retryable: false,
      code: "invalidCredentials",
    });
  }
  return Object.assign(new Error("Xác thực TikTok thất bại"), {
    status,
    retryable: status >= 500 || status === 429,
    code: error ?? "oauth_error",
  });
}

export function mapTikTokApiError(body: unknown, status: number): Error {
  const code = extractErrorCode(body);
  if (code === "access_token_invalid" || status === 401) {
    return Object.assign(new Error("Cần kết nối lại tài khoản TikTok"), {
      status: 401,
      retryable: false,
      code: "invalidCredentials",
    });
  }
  if (code === "scope_not_authorized" || code === "spam_risk_user_banned_from_posting") {
    return Object.assign(new Error(mapFailReason(code) ?? "TikTok từ chối thao tác"), {
      status: 403,
      retryable: false,
      code,
    });
  }
  if (code === "rate_limit_exceeded" || status === 429) {
    return Object.assign(new Error("TikTok giới hạn tốc độ (HTTP 429). Thử lại sau."), {
      status: 429,
      retryable: true,
      code: "rate_limit_exceeded",
    });
  }
  if (code === "spam_risk_too_many_pending_share") {
    return Object.assign(
      new Error("Đã đạt giới hạn video chờ xử lý trên TikTok trong 24 giờ. Thử lại sau."),
      { status: 403, retryable: false, code },
    );
  }
  const message = extractErrorMessage(body) ?? `Lỗi TikTok API (HTTP ${status})`;
  return Object.assign(new Error(message), {
    status,
    retryable: status === 429 || status >= 500,
    code: code ?? "tiktok_error",
  });
}

function extractErrorCode(body: unknown): string | undefined {
  const err = body as { error?: { code?: string } | string } | null;
  if (typeof err?.error === "string") return err.error;
  return err?.error?.code;
}

function extractErrorMessage(body: unknown): string | undefined {
  const err = body as { error?: { message?: string } | string; error_description?: string } | null;
  if (typeof err?.error === "object" && err.error?.message) return err.error.message;
  if (typeof err?.error_description === "string") return err.error_description;
  return undefined;
}

function mapFailReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const map: Record<string, string> = {
    picture_size_check_failed: "Ảnh/video không đạt yêu cầu kích thước của TikTok.",
    spam_risk_too_many_pending_share: "Quá nhiều video đang chờ trong inbox TikTok.",
    spam_risk_user_banned_from_posting: "Tài khoản TikTok bị cấm đăng bài.",
    scope_not_authorized: "Thiếu quyền TikTok (video.publish / video.upload). Kết nối lại tài khoản.",
    access_token_invalid: "Token TikTok hết hạn — cần Kết nối lại.",
  };
  return map[reason] ?? `TikTok báo lỗi: ${reason}`;
}
