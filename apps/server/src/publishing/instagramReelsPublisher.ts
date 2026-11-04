import { readFileSync, statSync } from "node:fs";
import {
  META_IG_MAX_BYTES,
  META_IG_MAX_CAPTION_CHARS,
  META_IG_MAX_DURATION_SEC,
  META_IG_MIN_DURATION_SEC,
  META_IG_PUBLISH_LIMIT_24H_FALLBACK,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from "@vg/shared";
import {
  buildMetaAuthUrl,
  buildMetaCaption,
  discoverMetaTargets,
  exchangeMetaCode,
  fetchIgIdentity,
  mapMetaGraphError,
  META_GRAPH_BASE,
  META_RUPLOAD_IG,
  metaFetchWithRetry,
  resolveMetaCredentials,
  safeJson,
  trimCaption,
  type MetaFetch,
  type MetaGraphDeps,
  type MetaTargetWithToken,
} from "./metaGraph.js";
import type { Publisher, PublisherIdentity } from "./types.js";

export type InstagramReelsPublisherOptions = MetaGraphDeps & {
  statusPollMaxMs?: number;
};

/**
 * Instagram professional Reels via resumable upload + media_publish.
 * After OAuth the user picks an IG account linked to a Page; vault holds the Page token.
 */
export class InstagramReelsPublisher implements Publisher {
  readonly platform = "instagram_reels" as const;
  readonly limits = {
    maxDurationSec: META_IG_MAX_DURATION_SEC,
    maxTitleChars: META_IG_MAX_CAPTION_CHARS,
    maxDescriptionChars: META_IG_MAX_CAPTION_CHARS,
    maxTags: 30,
    supportsScheduledPublishAt: false,
  };

  private readonly fetchImpl: MetaFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly statusPollMaxMs: number;
  private readonly now: () => Date;
  private boundExternalId: string | null = null;

  constructor(private readonly options: InstagramReelsPublisherOptions) {
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
      platform: "instagram_reels",
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
      return tokens;
    },

    fetchIdentity: async (tokens: TokenSet, signal: AbortSignal): Promise<PublisherIdentity> => {
      const igUserId = this.boundExternalId;
      if (igUserId && !igUserId.startsWith("pending:")) {
        return fetchIgIdentity(igUserId, tokens.accessToken, this.fetchImpl, signal);
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
        displayName: data.name?.trim() || "Instagram",
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
        new Error("Instagram Reels chỉ nhận video dọc (9:16). Hãy render biến thể vertical trước."),
        { status: 400, retryable: false, code: "IG_REELS_FORMAT" },
      );
    }

    const igUserId = this.boundExternalId;
    if (!igUserId || igUserId.startsWith("pending:")) {
      throw Object.assign(
        new Error("Chưa chọn tài khoản Instagram. Mở hồ sơ và chọn tài khoản sau khi Kết nối."),
        { status: 400, retryable: false, code: "IG_REELS_NO_ACCOUNT" },
      );
    }

    const duration = input.durationSec ?? 0;
    if (duration > 0 && (duration < META_IG_MIN_DURATION_SEC || duration > META_IG_MAX_DURATION_SEC)) {
      throw Object.assign(
        new Error(
          `Instagram Reels yêu cầu độ dài ${META_IG_MIN_DURATION_SEC} giây–${META_IG_MAX_DURATION_SEC / 60} phút (video hiện tại ~${Math.round(duration)}s).`,
        ),
        { status: 400, retryable: false, code: "IG_REELS_DURATION" },
      );
    }

    const fileStat = statSync(input.videoPath);
    if (fileStat.size > META_IG_MAX_BYTES) {
      throw Object.assign(
        new Error(`File vượt giới hạn 300 MB của Instagram Reels (${fileStat.size} bytes).`),
        { status: 400, retryable: false, code: "IG_REELS_SIZE" },
      );
    }

    await this.assertPublishingQuota(igUserId, tokens.accessToken, signal);

    const caption = trimCaption(
      buildMetaCaption(input.title, input.description, input.tags),
      META_IG_MAX_CAPTION_CHARS,
    );

    onProgress(2);
    const container = await this.createContainer({
      igUserId,
      accessToken: tokens.accessToken,
      caption,
      signal,
    });
    onProgress(8);

    await this.uploadBinary({
      uploadUri: container.uploadUri,
      containerId: container.containerId,
      videoPath: input.videoPath,
      fileSize: fileStat.size,
      accessToken: tokens.accessToken,
      signal,
      onProgress,
    });
    onProgress(70);

    await this.pollContainer(container.containerId, tokens.accessToken, signal);
    onProgress(90);

    const mediaId = await this.publishContainer(igUserId, container.containerId, tokens.accessToken, signal);
    onProgress(100);

    const handle = this.readHandleHint();
    const externalUrl = handle
      ? `https://www.instagram.com/reel/${mediaId}/`
      : `https://www.instagram.com/reel/${mediaId}/`;

    return {
      externalId: mediaId,
      externalUrl,
      warnings: [],
    };
  }

  private async assertPublishingQuota(
    igUserId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<void> {
    const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(igUserId)}/content_publishing_limit`);
    url.searchParams.set("fields", "config,quota_usage");
    url.searchParams.set("access_token", accessToken);
    const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url.toString(), {
      method: "GET",
      signal,
    });
    if (!response.ok) {
      // Soft-fail: do not block upload if the limit endpoint errors.
      return;
    }
    const data = await response.json() as {
      data?: Array<{
        quota_usage?: number;
        config?: { quota_total?: number };
      }>;
    };
    const row = data.data?.[0];
    const used = row?.quota_usage ?? 0;
    const total = row?.config?.quota_total ?? META_IG_PUBLISH_LIMIT_24H_FALLBACK;
    if (used >= total) {
      throw Object.assign(
        new Error(
          `Đã đạt giới hạn đăng Instagram (~${total} bài / 24 giờ). Thử lại sau.`,
        ),
        { status: 429, retryable: true, code: "IG_PUBLISH_LIMIT" },
      );
    }
  }

  private async createContainer(input: {
    igUserId: string;
    accessToken: string;
    caption: string;
    signal: AbortSignal;
  }): Promise<{ containerId: string; uploadUri: string }> {
    const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(input.igUserId)}/media`);
    const body = new URLSearchParams({
      media_type: "REELS",
      upload_type: "resumable",
      caption: input.caption,
      share_to_feed: "true",
      access_token: input.accessToken,
    });
    const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: input.signal,
    });
    if (!response.ok) {
      throw mapMetaGraphError(await safeJson(response), response.status);
    }
    const data = await response.json() as { id?: string; uri?: string };
    if (!data.id || !data.uri) {
      throw Object.assign(new Error("Instagram không trả container id/uri"), {
        status: 502,
        retryable: true,
      });
    }
    return { containerId: data.id, uploadUri: data.uri };
  }

  private async uploadBinary(input: {
    uploadUri: string;
    containerId: string;
    videoPath: string;
    fileSize: number;
    accessToken: string;
    signal: AbortSignal;
    onProgress: (p: number) => void;
  }): Promise<void> {
    const bytes = readFileSync(input.videoPath);
    // Prefer the URI from the create-container response; fall back to documented rupload path.
    const url = input.uploadUri.startsWith("http")
      ? input.uploadUri
      : `${META_RUPLOAD_IG}/${encodeURIComponent(input.containerId)}`;
    const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${input.accessToken}`,
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
    input.onProgress(65);
  }

  private async pollContainer(
    containerId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<void> {
    const started = this.now().getTime();
    let delayMs = 1_000;
    while (true) {
      if (signal.aborted) {
        throw Object.assign(new Error("aborted"), { status: 499, retryable: false });
      }
      if (this.now().getTime() - started > this.statusPollMaxMs) {
        throw Object.assign(new Error("Hết thời gian chờ Instagram xử lý Reel (~10 phút)"), {
          status: 504,
          retryable: true,
        });
      }

      const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(containerId)}`);
      url.searchParams.set("fields", "status_code,status");
      url.searchParams.set("access_token", accessToken);
      const response = await metaFetchWithRetry(this.fetchImpl, this.sleep, url.toString(), {
        method: "GET",
        signal,
      });
      if (!response.ok) {
        throw mapMetaGraphError(await safeJson(response), response.status);
      }
      const data = await response.json() as {
        status_code?: string;
        status?: string;
      };
      const code = (data.status_code ?? "").toUpperCase();
      if (code === "FINISHED") return;
      if (code === "ERROR" || code === "EXPIRED") {
        throw Object.assign(
          new Error(data.status ?? "Instagram báo lỗi khi xử lý Reel"),
          { status: 502, retryable: false },
        );
      }

      await this.sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 15_000);
    }
  }

  private async publishContainer(
    igUserId: string,
    containerId: string,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<string> {
    const url = new URL(`${META_GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish`);
    const body = new URLSearchParams({
      creation_id: containerId,
      access_token: accessToken,
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
    const data = await response.json() as { id?: string };
    if (!data.id) {
      throw Object.assign(new Error("Instagram không trả media id sau media_publish"), {
        status: 502,
        retryable: true,
      });
    }
    return data.id;
  }

  private readHandleHint(): string | null {
    return null;
  }
}
