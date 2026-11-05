import { statSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import type Database from "better-sqlite3";
import {
  YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE,
  YOUTUBE_ANALYTICS_READONLY_SCOPE,
  YOUTUBE_DEFAULT_CATEGORY_ID,
  YOUTUBE_FULL_SCOPE,
  YOUTUBE_PLAYLIST_ITEM_QUOTA_COST,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_SHORTS_MAX_SEC,
  YOUTUBE_THUMBNAIL_QUOTA_COST,
  YOUTUBE_UPLOAD_QUOTA_COST,
  YOUTUBE_UPLOAD_SCOPE,
  type PublishInput,
  type PublishResult,
  type PublishVisibility,
  type TokenSet,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import type { TokenVault } from "./tokenVault.js";
import type { Publisher, PublisherIdentity } from "./types.js";
import { nextPacificMidnightIso, YoutubeQuotaTracker } from "./youtubeQuota.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";

/** 8 MiB — multiple of 256 KiB as required by the resumable protocol. */
export const YOUTUBE_CHUNK_SIZE = 8 * 1024 * 1024;

const TITLE_MAX = 100;
const DESCRIPTION_MAX_BYTES = 5000;
const TAGS_MAX_CHARS = 500;

export type YoutubeFetch = typeof fetch;

export class YoutubeQuotaExceededError extends Error {
  readonly code = "YOUTUBE_QUOTA_EXCEEDED";
  readonly retryable = false;
  readonly status = 403;
  readonly rescheduleAt: string;

  constructor(message: string, rescheduleAt: string) {
    super(message);
    this.name = "YoutubeQuotaExceededError";
    this.rescheduleAt = rescheduleAt;
  }
}

export type YoutubePublisherOptions = {
  config: AppConfig;
  vault: TokenVault;
  sqlite: Database.Database;
  quota?: YoutubeQuotaTracker;
  fetchImpl?: YoutubeFetch;
  chunkSize?: number;
  now?: () => Date;
};

type AccountCredRow = { id: string; profile_id: string; publish_settings: string };

export class YouTubePublisher implements Publisher {
  readonly platform = "youtube" as const;
  readonly limits = {
    maxDurationSec: 12 * 60 * 60,
    maxTitleChars: TITLE_MAX,
    maxDescriptionChars: DESCRIPTION_MAX_BYTES,
    maxTags: 30,
    supportsScheduledPublishAt: true,
  };

  readonly quota: YoutubeQuotaTracker;
  private readonly fetchImpl: YoutubeFetch;
  private readonly chunkSize: number;
  private readonly now: () => Date;

  constructor(private readonly options: YoutubePublisherOptions) {
    this.quota = options.quota
      ?? new YoutubeQuotaTracker(options.sqlite, options.config.YOUTUBE_DAILY_QUOTA, options.now);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.chunkSize = options.chunkSize ?? YOUTUBE_CHUNK_SIZE;
    this.now = options.now ?? (() => new Date());
  }

  /** Resolve vault-first, then .env fallback. */
  resolveCredentials(accountId: string): { clientId: string; clientSecret: string } {
    const account = this.requireAccount(accountId);
    const vaultCreds = this.options.vault.loadAppCredentials(
      accountId,
      account.profile_id,
      "youtube",
    );
    if (vaultCreds?.clientId && vaultCreds.clientSecret) {
      return vaultCreds;
    }
    const clientId = this.options.config.YOUTUBE_CLIENT_ID?.trim();
    const clientSecret = this.options.config.YOUTUBE_CLIENT_SECRET?.trim();
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
    throw Object.assign(new Error("Chưa cấu hình Client ID/Secret cho YouTube"), {
      status: 400,
      retryable: false,
      code: "YOUTUBE_CREDENTIALS_MISSING",
    });
  }

  scopesForAccount(accountId: string): string[] {
    const playlistId = this.readPublishSettings(accountId).playlistId;
    const scopes = [
      YOUTUBE_UPLOAD_SCOPE,
      playlistId ? YOUTUBE_FULL_SCOPE : YOUTUBE_READONLY_SCOPE,
      YOUTUBE_ANALYTICS_READONLY_SCOPE,
    ];
    if (this.isRevenueSyncEnabled(accountId)) {
      scopes.push(YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE);
    }
    return scopes;
  }

  private isRevenueSyncEnabled(accountId: string): boolean {
    const row = this.options.sqlite.prepare(
      "SELECT revenue_sync_enabled AS enabled FROM platform_accounts WHERE id = ?",
    ).get(accountId) as { enabled: number | boolean } | undefined;
    return Boolean(row?.enabled);
  }

  readonly oauth = {
    buildAuthUrl: (input: {
      accountId: string;
      redirectUri: string;
      state: string;
      codeChallenge: string;
    }): string => {
      const { clientId } = this.resolveCredentials(input.accountId);
      const url = new URL(AUTH_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", input.state);
      url.searchParams.set("scope", this.scopesForAccount(input.accountId).join(" "));
      return url.toString();
    },

    exchangeCode: async (
      input: { code: string; redirectUri: string; codeVerifier: string; accountId: string },
      signal: AbortSignal,
    ): Promise<TokenSet> => {
      const { clientId, clientSecret } = this.resolveCredentials(input.accountId);
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: input.codeVerifier,
      });
      const response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!response.ok) {
        throw mapGoogleAuthError(await safeJson(response), response.status);
      }
      return parseTokenResponse(await response.json(), this.scopesForAccount(input.accountId));
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
        throw Object.assign(new Error("Thiếu accountId khi làm mới token YouTube"), {
          status: 400,
          retryable: false,
        });
      }
      const { clientId, clientSecret } = this.resolveCredentials(accountId);
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      });
      if (!response.ok) {
        throw mapGoogleAuthError(await safeJson(response), response.status);
      }
      const parsed = parseTokenResponse(await response.json(), tokens.scopes);
      return {
        ...parsed,
        refreshToken: parsed.refreshToken ?? tokens.refreshToken,
      };
    },

    revoke: async (tokens: TokenSet, signal: AbortSignal, _accountId?: string): Promise<void> => {
      void _accountId;
      const token = tokens.refreshToken ?? tokens.accessToken;
      const response = await this.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal,
      });
      if (!response.ok && response.status !== 400) {
        throw Object.assign(new Error("Thu hồi token YouTube thất bại"), {
          status: response.status,
          retryable: false,
        });
      }
    },

    fetchIdentity: async (tokens: TokenSet, signal: AbortSignal): Promise<PublisherIdentity> => {
      const response = await this.fetchImpl(
        `${API_BASE}/channels?part=snippet&mine=true`,
        {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
          signal,
        },
      );
      if (!response.ok) {
        throw mapYoutubeApiError(await safeJson(response), response.status);
      }
      const data = await response.json() as {
        items?: Array<{
          id?: string;
          snippet?: { title?: string; customUrl?: string };
        }>;
      };
      const channel = data.items?.[0];
      if (!channel?.id) {
        throw Object.assign(new Error("Không tìm thấy kênh YouTube của tài khoản"), {
          status: 404,
          retryable: false,
        });
      }
      const handle = channel.snippet?.customUrl
        ? (channel.snippet.customUrl.startsWith("@")
          ? channel.snippet.customUrl
          : `@${channel.snippet.customUrl}`)
        : undefined;
      return {
        displayName: channel.snippet?.title?.trim() || "YouTube Channel",
        ...(handle ? { handle } : {}),
        externalId: channel.id,
      };
    },
  };

  /** videos.update — needs the full youtube scope, not upload-only. */
  async updateVideoTitle(input: {
    videoId: string;
    title: string;
    tokens: TokenSet;
    signal: AbortSignal;
  }): Promise<void> {
    const updateCost = 50;
    if (this.quota.wouldExceed(updateCost)) {
      throw new YoutubeQuotaExceededError(
        "Hết hạn mức YouTube trong ngày, chưa đổi được tiêu đề.",
        nextPacificMidnightIso(this.now()),
      );
    }
    const current = await this.fetchImpl(
      `${API_BASE}/videos?part=snippet&id=${encodeURIComponent(input.videoId)}`,
      { headers: { Authorization: `Bearer ${input.tokens.accessToken}` }, signal: input.signal },
    );
    if (!current.ok) throw mapYoutubeApiError(await safeJson(current), current.status);
    const data = await current.json() as {
      items?: Array<{ snippet?: { title?: string; description?: string; categoryId?: string; tags?: string[]; defaultLanguage?: string } }>;
    };
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) {
      throw Object.assign(new Error("Không tìm thấy video YouTube để đổi tiêu đề"), { status: 404, retryable: false });
    }
    const updated = await this.fetchImpl(`${API_BASE}/videos?part=snippet`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.tokens.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        id: input.videoId,
        snippet: {
          title: input.title.slice(0, TITLE_MAX),
          description: snippet.description ?? "",
          categoryId: snippet.categoryId ?? YOUTUBE_DEFAULT_CATEGORY_ID,
          ...(snippet.tags ? { tags: snippet.tags } : {}),
          ...(snippet.defaultLanguage ? { defaultLanguage: snippet.defaultLanguage } : {}),
        },
      }),
      signal: input.signal,
    });
    if (!updated.ok) throw mapYoutubeApiError(await safeJson(updated), updated.status);
    this.quota.record(updateCost);
  }

  async updateTitle(accountId: string, videoId: string, title: string, signal: AbortSignal): Promise<void> {
    let tokens = this.options.vault.loadTokens(accountId);
    if (!tokens) {
      throw Object.assign(new Error("Chưa có token YouTube để đổi tiêu đề"), { status: 401, retryable: false });
    }
    const expires = tokens.expiresAt ? Date.parse(tokens.expiresAt) : Number.POSITIVE_INFINITY;
    if (expires < this.now().getTime() + 60_000) {
      tokens = await this.oauth.refresh(tokens, signal, accountId);
      this.options.vault.storeTokens(accountId, tokens);
    }
    await this.updateVideoTitle({ videoId, title, tokens, signal });
  }

  async upload(
    input: PublishInput,
    tokens: TokenSet,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ): Promise<PublishResult> {
    if (signal.aborted) throw Object.assign(new Error("aborted"), { status: 499, retryable: false });

    const warnings: string[] = [];
    const uploadCost = YOUTUBE_UPLOAD_QUOTA_COST;
    if (this.quota.wouldExceed(uploadCost)) {
      throw new YoutubeQuotaExceededError(
        `Hết hạn mức YouTube trong ngày (đã dùng ${this.quota.getState().used}/${this.quota.getLimit()} đơn vị). Sẽ thử lại sau khi quota reset (nửa đêm giờ Thái Bình Dương).`,
        nextPacificMidnightIso(this.now()),
      );
    }

    const { description, isShort, shortWarning } = buildDescription(input);
    if (shortWarning) warnings.push(shortWarning);

    const title = input.title.slice(0, TITLE_MAX);
    const tags = trimTagsByChars(input.tags, TAGS_MAX_CHARS);
    const categoryId = input.categoryId?.trim() || YOUTUBE_DEFAULT_CATEGORY_ID;
    const language = normalizeLanguage(input.language);

    const status: Record<string, unknown> = {
      privacyStatus: input.visibility,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: input.aiDisclosure,
    };
    if (input.publishAt) {
      status.privacyStatus = "private";
      status.publishAt = input.publishAt;
    }

    const metadata = {
      snippet: {
        title,
        description: trimUtf8Bytes(description, DESCRIPTION_MAX_BYTES),
        tags,
        categoryId,
        defaultLanguage: language,
        defaultAudioLanguage: language,
      },
      status,
    };

    const fileStat = statSync(input.videoPath);
    const fileSize = fileStat.size;
    onProgress(2);

    const initResponse = await this.fetchImpl(
      `${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(fileSize),
          "X-Upload-Content-Type": "video/*",
        },
        body: JSON.stringify(metadata),
        signal,
      },
    );
    if (!initResponse.ok) {
      throw mapYoutubeApiError(await safeJson(initResponse), initResponse.status);
    }
    const sessionUri = initResponse.headers.get("location") ?? initResponse.headers.get("Location");
    if (!sessionUri) {
      throw Object.assign(new Error("YouTube không trả session URI cho tải lên"), {
        status: 502,
        retryable: true,
      });
    }

    onProgress(5);
    const uploaded = await this.uploadChunks({
      sessionUri,
      videoPath: input.videoPath,
      fileSize,
      accessToken: tokens.accessToken,
      signal,
      onProgress,
    });

    this.quota.record(uploadCost);

    const videoId = uploaded.id;
    if (!videoId) {
      throw Object.assign(new Error("YouTube không trả video id"), { status: 502, retryable: true });
    }

    const returnedPrivacy = uploaded.status?.privacyStatus as PublishVisibility | undefined;
    const requestedPrivacy = (input.publishAt ? "private" : input.visibility) as PublishVisibility;
    let visibilityUsed: PublishVisibility | undefined;
    if (returnedPrivacy && returnedPrivacy !== requestedPrivacy) {
      warnings.push(
        `YouTube đã đặt video thành "${privacyLabelVi(returnedPrivacy)}" thay vì "${privacyLabelVi(requestedPrivacy)}" `
        + "(thường gặp khi project API chưa được xác minh). Video đã đăng nhưng có thể bị khóa riêng tư cho đến khi Google duyệt project.",
      );
      visibilityUsed = returnedPrivacy;
    }

    // Shorts (vertical) cannot take a custom thumbnail through the API. Skip with no warning.
    if (input.format === "landscape" && !isShort && input.thumbnailPath) {
      const thumbWarning = await this.setThumbnail(videoId, input.thumbnailPath, tokens.accessToken, signal);
      if (thumbWarning) warnings.push(thumbWarning);
      else this.quota.record(YOUTUBE_THUMBNAIL_QUOTA_COST);
    }

    if (input.playlistId?.trim()) {
      const playlistWarning = await this.addToPlaylist(
        videoId,
        input.playlistId.trim(),
        tokens.accessToken,
        signal,
      );
      if (playlistWarning) warnings.push(playlistWarning);
      else this.quota.record(YOUTUBE_PLAYLIST_ITEM_QUOTA_COST);
    }

    void isShort;
    onProgress(100);
    return {
      externalId: videoId,
      externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      warnings,
      ...(visibilityUsed ? { visibilityUsed } : {}),
    };
  }

  private async uploadChunks(input: {
    sessionUri: string;
    videoPath: string;
    fileSize: number;
    accessToken: string;
    signal: AbortSignal;
    onProgress: (progress: number) => void;
  }): Promise<{
    id?: string;
    status?: { privacyStatus?: string };
  }> {
    let offset = 0;
    let retries = 0;
    const maxRetries = 3;

    while (offset < input.fileSize) {
      if (input.signal.aborted) {
        throw Object.assign(new Error("aborted"), { status: 499, retryable: false });
      }
      const end = Math.min(offset + this.chunkSize, input.fileSize) - 1;
      const chunkLength = end - offset + 1;
      const chunk = await readFileRange(input.videoPath, offset, chunkLength);

      let response: Response;
      try {
        response = await this.fetchImpl(input.sessionUri, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            "Content-Length": String(chunkLength),
            "Content-Type": "video/*",
            "Content-Range": `bytes ${offset}-${end}/${input.fileSize}`,
          },
          body: toBody(chunk),
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal.aborted) throw error;
        offset = await this.queryUploadOffset(input.sessionUri, input.fileSize, input.accessToken, input.signal);
        retries += 1;
        if (retries > maxRetries) {
          throw Object.assign(new Error("Mất kết nối khi tải lên YouTube"), {
            status: 503,
            retryable: true,
            cause: error,
          });
        }
        continue;
      }

      if (response.status === 308) {
        const range = response.headers.get("range") ?? response.headers.get("Range");
        offset = parseRangeEnd(range) + 1;
        retries = 0;
        const pct = 5 + Math.floor((offset / input.fileSize) * 90);
        input.onProgress(Math.min(95, pct));
        continue;
      }

      if (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
        offset = await this.queryUploadOffset(input.sessionUri, input.fileSize, input.accessToken, input.signal);
        retries += 1;
        if (retries > maxRetries) {
          throw mapYoutubeApiError(await safeJson(response), response.status);
        }
        continue;
      }

      if (response.status === 200 || response.status === 201) {
        return await response.json() as { id?: string; status?: { privacyStatus?: string } };
      }

      throw mapYoutubeApiError(await safeJson(response), response.status);
    }

    // Final status query if loop exhausted without 201 (shouldn't happen)
    const finalOffset = await this.queryUploadOffset(
      input.sessionUri,
      input.fileSize,
      input.accessToken,
      input.signal,
    );
    if (finalOffset < input.fileSize) {
      throw Object.assign(new Error("Tải lên YouTube chưa hoàn tất"), { status: 503, retryable: true });
    }
    return {};
  }

  private async queryUploadOffset(
    sessionUri: string,
    fileSize: number,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<number> {
    const response = await this.fetchImpl(sessionUri, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": "0",
        "Content-Range": `bytes */${fileSize}`,
      },
      signal,
    });
    if (response.status === 200 || response.status === 201) {
      return fileSize;
    }
    if (response.status === 308) {
      const range = response.headers.get("range") ?? response.headers.get("Range");
      return parseRangeEnd(range) + 1;
    }
    throw mapYoutubeApiError(await safeJson(response), response.status);
  }

  private async setThumbnail(
    videoId: string,
    thumbnailPath: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const body = await readFileRange(thumbnailPath, 0, statSync(thumbnailPath).size);
    const response = await this.fetchImpl(
      `${UPLOAD_BASE}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "image/jpeg",
        },
        body: toBody(body),
        signal,
      },
    );
    if (response.ok) return null;
    if (response.status === 403) {
      return "Không đặt được thumbnail tùy chỉnh (kênh/API chưa đủ điều kiện). Video vẫn đã đăng.";
    }
    // Soft warning for other thumbnail failures — upload already succeeded
    return `Đặt thumbnail thất bại (HTTP ${response.status}). Video vẫn đã đăng.`;
  }

  private async addToPlaylist(
    videoId: string,
    playlistId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const response = await this.fetchImpl(
      `${API_BASE}/playlistItems?part=snippet`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        }),
        signal,
      },
    );
    if (response.ok) return null;
    return `Không thêm được video vào playlist (HTTP ${response.status}). Video vẫn đã đăng.`;
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

  private readPublishSettings(accountId: string): { playlistId?: string; categoryId?: string } {
    try {
      const row = this.requireAccount(accountId);
      const parsed = JSON.parse(row.publish_settings) as { playlistId?: string; categoryId?: string };
      return {
        ...(parsed.playlistId ? { playlistId: parsed.playlistId } : {}),
        ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
      };
    } catch {
      return {};
    }
  }
}

function buildDescription(input: PublishInput): {
  description: string;
  isShort: boolean;
  shortWarning?: string;
} {
  let description = input.description ?? "";
  if (input.format !== "vertical") {
    return { description, isShort: false };
  }
  const duration = input.durationSec ?? 0;
  if (duration > YOUTUBE_SHORTS_MAX_SEC) {
    return {
      description,
      isShort: false,
      shortWarning:
        `Video dọc dài ${Math.round(duration)}s (trên ${YOUTUBE_SHORTS_MAX_SEC}s) nên không gắn #Shorts; YouTube sẽ coi đây là video thường.`,
    };
  }
  if (!/(^|\s)#Shorts\b/i.test(description)) {
    description = description.trimEnd() ? `${description.trimEnd()}\n\n#Shorts` : "#Shorts";
  }
  return { description, isShort: true };
}

function trimTagsByChars(tags: string[], maxChars: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const next = used === 0 ? trimmed.length : used + 1 + trimmed.length;
    if (next > maxChars) break;
    out.push(trimmed);
    used = next;
  }
  return out;
}

function trimUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = text.length;
  while (end > 0 && Buffer.from(text.slice(0, end), "utf8").length > maxBytes) {
    end -= 1;
  }
  return text.slice(0, end);
}

function normalizeLanguage(language: string): string {
  const base = language.trim().toLowerCase().split(/[_-]/)[0] || "en";
  return base.slice(0, 8);
}

function parseRangeEnd(range: string | null): number {
  if (!range) return -1;
  const match = /bytes=(\d+)-(\d+)/i.exec(range) ?? /(\d+)-(\d+)/.exec(range);
  if (!match) return -1;
  return Number(match[2]);
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

function parseTokenResponse(raw: unknown, fallbackScopes: string[]): TokenSet {
  const data = raw as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
  if (!data.access_token) {
    throw Object.assign(new Error("Phản hồi token YouTube không hợp lệ"), {
      status: 502,
      retryable: true,
    });
  }
  const scopes = data.scope
    ? data.scope.split(/\s+/).filter(Boolean)
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

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapGoogleAuthError(body: unknown, status: number): Error {
  const error = (body as { error?: string; error_description?: string } | null)?.error;
  if (error === "invalid_grant" || error === "invalid_client" || status === 401) {
    return Object.assign(new Error("Thông tin đăng nhập YouTube không hợp lệ — cần Kết nối lại"), {
      status: 401,
      retryable: false,
      code: "invalidCredentials",
    });
  }
  return Object.assign(new Error("Xác thực Google thất bại"), {
    status,
    retryable: status >= 500,
    code: error ?? "oauth_error",
  });
}

export function mapYoutubeApiError(body: unknown, status: number): Error {
  const reason = extractReason(body);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return new YoutubeQuotaExceededError(
      "Đã hết hạn mức YouTube API trong ngày. Job sẽ được lên lịch lại sau nửa đêm giờ Thái Bình Dương.",
      nextPacificMidnightIso(),
    );
  }
  if (reason === "uploadLimitExceeded") {
    return Object.assign(
      new Error("Kênh đã đạt giới hạn tải video lên YouTube trong ngày. Thử lại vào ngày mai."),
      { status: 403, retryable: false, code: "uploadLimitExceeded" },
    );
  }
  if (reason === "forbidden" || status === 403) {
    return Object.assign(new Error("YouTube từ chối thao tác (không đủ quyền hoặc kênh bị hạn chế)."), {
      status: 403,
      retryable: false,
      code: "forbidden",
    });
  }
  if (reason === "authError" || reason === "invalidCredentials" || status === 401) {
    return Object.assign(new Error("Cần kết nối lại tài khoản YouTube"), {
      status: 401,
      retryable: false,
      code: "invalidCredentials",
    });
  }
  const message = extractMessage(body) ?? `Lỗi YouTube API (HTTP ${status})`;
  return Object.assign(new Error(message), {
    status,
    retryable: status === 429 || status >= 500,
    code: reason ?? "youtube_error",
  });
}

function extractReason(body: unknown): string | undefined {
  const errors = (body as { error?: { errors?: Array<{ reason?: string }> } } | null)?.error?.errors;
  return errors?.[0]?.reason;
}

function extractMessage(body: unknown): string | undefined {
  return (body as { error?: { message?: string } } | null)?.error?.message;
}

function privacyLabelVi(value: string): string {
  if (value === "public") return "công khai";
  if (value === "unlisted") return "không liệt kê";
  if (value === "private") return "riêng tư";
  return value;
}
