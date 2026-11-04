import { readFileSync, statSync } from "node:fs";
import {
  META_FB_MAX_BYTES,
  META_FB_MAX_DESCRIPTION_CHARS,
  META_FB_MAX_DURATION_SEC,
  META_FB_MIN_DURATION_SEC,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from "@vg/shared";
import {
  buildMetaAuthUrl,
  buildMetaCaption,
  discoverMetaTargets,
  exchangeMetaCode,
  fetchPageIdentity,
  mapMetaGraphError,
  META_GRAPH_BASE,
  META_RUPLOAD_VIDEO,
  metaFetchWithRetry,
  resolveMetaCredentials,
  safeJson,
  trimCaption,
  type MetaFetch,
  type MetaGraphDeps,
  type MetaTargetWithToken,
} from "./metaGraph.js";
import type { Publisher, PublisherIdentity } from "./types.js";

export type FacebookReelsPublisherOptions = MetaGraphDeps & {
  statusPollMaxMs?: number;
};

/**
 * Facebook Page Reels via Graph `video_reels` (start → rupload → finish → status).
 * After OAuth the user picks a Page; the vault then holds that Page access token.
 */
export class FacebookReelsPublisher implements Publisher {
  readonly platform = "facebook_reels" as const;
  readonly limits = {
    maxDurationSec: META_FB_MAX_DURATION_SEC,
    maxTitleChars: META_FB_MAX_DESCRIPTION_CHARS,
    maxDescriptionChars: META_FB_MAX_DESCRIPTION_CHARS,
    maxTags: 30,
    supportsScheduledPublishAt: true,
  };

  private readonly fetchImpl: MetaFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly statusPollMaxMs: number;
  private readonly now: () => Date;

  /** Bound by PublishService before upload / checkConnection (Page id). */
  private boundExternalId: string | null = null;

  constructor(private readonly options: FacebookReelsPublisherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.statusPollMaxMs = options.statusPollMaxMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  bindExternalId(externalId: string | null): void {
    this.boundExternalId = externalId;
  }

  resolveCredentials(accountId: string) {
    return resolveMetaCredentials(this.options, accountId);
  }

  async listTargets(userAccessToken: string, signal: AbortSignal): Promise<MetaTargetWithToken[]> {
    return discoverMetaTargets({
      userAccessToken,
      platform: "facebook_reels",
      fetchImpl: this.fetchImpl,
      signal,
    });
  }

  readonly oauth = {
    buildAuthUrl: (input: {
      accountId: string;
      redirectUri: string;
      state: string;
      codeChallenge: string;
    }): string => {
      void input.codeChallenge;
      const { appId } = this.resolveCredentials(input.accountId);
      return buildMetaAuthUrl({
        appId,
        redirectUri: input.redirectUri,
        state: input.state,
      });
    },

    exchangeCode: async (
      input: { code: string; redirectUri: string; codeVerifier: string; accountId: string },
      signal: AbortSignal,
    ): Promise<TokenSet> => {
      void input.codeVerifier;
      const { appId, appSecret } = this.resolveCredentials(input.accountId);
      return exchangeMetaCode({
        code: input.code,
        redirectUri: input.redirectUri,
        appId,
        appSecret,
        fetchImpl: this.fetchImpl,
        signal,
      });
    },

    refresh: async (tokens: TokenSet, _signal: AbortSignal, _accountId?: string): Promise<TokenSet> => {
      if (tokens.expiresAt) {
        const remaining = new Date(tokens.expiresAt).getTime() - this.now().getTime();
        if (remaining <= 0) {
          throw Object.assign(new Error("Cần kết nối lại tài khoản"), {
            status: 401,
            retryable: false,
            code: "invalidCredentials",
          });
        }
      }
      // Page tokens derived from long-lived user tokens cannot use fb_exchange_token.
      return tokens;
    },

    fetchIdentity: async (tokens: TokenSet, signal: AbortSignal): Promise<PublisherIdentity> => {
      const pageId = this.boundExternalId;
      if (pageId && !pageId.startsWith("pending:")) {
        return fetchPageIdentity(pageId, tokens.accessToken, this.fetchImpl, signal);
      }
      const url = new URL(`${META_GRAPH_BASE}/me`);
      url.searchParams.set("fields", "id,name");
      url.searchParams.set("access_token", tokens.accessToken);
      const response = await this.fetchImpl(url.toString(), { signal });
      if (!response.ok) {
        throw mapMetaGraphError(await safeJson(response), response.status);
      }
      const data = await response.json() as { id?: string; name?: string };
      if (!data.id) {
        throw Object.assign(new Error("Không tìm thấy hồ sơ Meta"), {
          status: 404,
          retryable: false,
        });
      }
      return {
        displayName: data.name?.trim() || "Facebook",
        externalId: `pending:${data.id}`,
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
        new Error("Facebook Reels chỉ nhận video dọc (9:16). Hãy render biến thể vertical trước."),
        { status: 400, retryable: false, code: "FB_REELS_FORMAT" },
      );
    }

    const pageId = this.boundExternalId;
    if (!pageId || pageId.startsWith("pending:")) {
      throw Object.assign(
        new Error("Chưa chọn Facebook Page. Mở tài khoản hồ sơ và chọn Trang sau khi Kết nối."),
        { status: 400, retryable: false, code: "FB_REELS_NO_PAGE" },
      );
    }

    const duration = input.durationSec ?? 0;
    if (duration > 0 && (duration < META_FB_MIN_DURATION_SEC || duration > META_FB_MAX_DURATION_SEC)) {
      throw Object.assign(
        new Error(
          `Facebook Reels yêu cầu độ dài ${META_FB_MIN_DURATION_SEC}–${META_FB_MAX_DURATION_SEC} giây (video hiện tại ~${Math.round(duration)}s).`,
        ),
        { status: 400, retryable: false, code: "FB_REELS_DURATION" },
      );
    }

    const fileStat = statSync(input.videoPath);
    if (fileStat.size > META_FB_MAX_BYTES) {
      throw Object.assign(
        new Error(`File vượt giới hạn ~1 GB của Facebook Reels (${fileStat.size} bytes).`),
        { status: 400, retryable: false, code: "FB_REELS_SIZE" },
      );
    }

    const description = trimCaption(
      buildMetaCaption(input.title, input.description, input.tags),
      META_FB_MAX_DESCRIPTION_CHARS,
    );

    onProgress(2);
    const start = await this.startUpload(pageId, tokens.accessToken, signal);
    onProgress(8);

    await this.uploadBinary({
      videoId: start.videoId,
      videoPath: input.videoPath,
      fileSize: fileStat.size,
      pageAccessToken: tokens.accessToken,
      signal,
      onProgress,
    });
    onProgress(75);

    const finish = await this.finishUpload({
      pageId,
      videoId: start.videoId,
      pageAccessToken: tokens.accessToken,
      description,
      publishAt: input.publishAt,
      aiDisclosure: input.aiDisclosure,
      signal,
    });
    onProgress(85);

    await this.pollStatus(start.videoId, tokens.accessToken, signal);
    onProgress(100);

    const externalId = finish.videoId ?? start.videoId;
    return {
      externalId,
      externalUrl: `https://www.facebook.com/reel/${externalId}`,
      warnings: [],
    };
  }

  private async startUpload(
    pageId: string,
    pageAccessToken: string,
    signal: AbortSignal,
  ): Promise<{ videoId: string }> {
    const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(pageId)}/video_reels`);
    const body = new URLSearchParams({
      upload_phase: "start",
      access_token: pageAccessToken,
    });
    const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!response.ok) {
      throw mapMetaGraphError(await safeJson(response), response.status);
    }
    const data = await response.json() as { video_id?: string };
    if (!data.video_id) {
      throw Object.assign(new Error("Facebook không trả video_id khi start upload"), {
        status: 502,
        retryable: true,
      });
    }
    return { videoId: data.video_id };
  }

  private async uploadBinary(input: {
    videoId: string;
    videoPath: string;
    fileSize: number;
    pageAccessToken: string;
    signal: AbortSignal;
    onProgress: (p: number) => void;
  }): Promise<void> {
    const bytes = readFileSync(input.videoPath);
    const url = `${META_RUPLOAD_VIDEO}/${encodeURIComponent(input.videoId)}`;
    const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${input.pageAccessToken}`,
        offset: "0",
        file_size: String(input.fileSize),
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      signal: input.signal,
    });
    if (!response.ok) {
      throw mapMetaGraphError(await safeJson(response), response.status);
    }
    input.onProgress(70);
  }

  private async finishUpload(input: {
    pageId: string;
    videoId: string;
    pageAccessToken: string;
    description: string;
    publishAt?: string;
    aiDisclosure: boolean;
    signal: AbortSignal;
  }): Promise<{ videoId?: string }> {
    const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(input.pageId)}/video_reels`);
    const params = new URLSearchParams({
      upload_phase: "finish",
      video_id: input.videoId,
      access_token: input.pageAccessToken,
      description: input.description,
    });

    if (input.publishAt) {
      const unix = Math.floor(new Date(input.publishAt).getTime() / 1000);
      params.set("video_state", "SCHEDULED");
      params.set("scheduled_publish_time", String(unix));
    } else {
      params.set("video_state", "PUBLISHED");
    }
    if (input.aiDisclosure) {
      params.set("is_ai_generated", "true");
    }

    const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: input.signal,
    });
    if (!response.ok) {
      throw mapMetaGraphError(await safeJson(response), response.status);
    }
    const data = await response.json() as { video_id?: string };
    return { videoId: data.video_id ?? input.videoId };
  }

  private async pollStatus(
    videoId: string,
    pageAccessToken: string,
    signal: AbortSignal,
  ): Promise<void> {
    const started = this.now().getTime();
    let delayMs = 1_000;
    while (true) {
      if (signal.aborted) {
        throw Object.assign(new Error("aborted"), { status: 499, retryable: false });
      }
      if (this.now().getTime() - started > this.statusPollMaxMs) {
        throw Object.assign(new Error("Hết thời gian chờ Facebook xử lý Reel (~10 phút)"), {
          status: 504,
          retryable: true,
        });
      }

      const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(videoId)}`);
      url.searchParams.set("fields", "status");
      url.searchParams.set("access_token", pageAccessToken);
      const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url.toString(), {
        method: "GET",
        signal,
      });
      if (!response.ok) {
        throw mapMetaGraphError(await safeJson(response), response.status);
      }
      const data = await response.json() as {
        status?: {
          video_status?: string;
          publishing_phase?: { status?: string; publish_status?: string };
          error?: { message?: string };
        };
      };
      const status = data.status;
      const videoStatus = status?.video_status?.toLowerCase() ?? "";
      const publishStatus = status?.publishing_phase?.publish_status?.toLowerCase()
        ?? status?.publishing_phase?.status?.toLowerCase()
        ?? "";

      if (status?.error?.message) {
        throw Object.assign(new Error(status.error.message), {
          status: 502,
          retryable: false,
        });
      }
      if (
        videoStatus === "ready"
        || videoStatus === "upload_complete"
        || publishStatus === "published"
        || publishStatus === "complete"
        || publishStatus === "success"
      ) {
        return;
      }
      if (videoStatus === "error" || publishStatus === "error" || publishStatus === "failed") {
        throw Object.assign(new Error("Facebook báo lỗi khi xử lý Reel"), {
          status: 502,
          retryable: false,
        });
      }

      await this.sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 15_000);
    }
  }
}
