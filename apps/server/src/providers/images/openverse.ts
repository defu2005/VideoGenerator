import { normalizeOpenverseLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type OpenverseResponse = { results?: {
  id: string;
  title?: string;
  url: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  filetype?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  creator?: string;
  creator_url?: string;
  foreign_landing_url?: string;
  attribution?: string;
  source?: string;
  provider?: string;
  tags?: { name?: string }[];
  mature?: boolean;
}[] };

type OpenverseTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

export class OpenverseImageProvider implements ImageSearchProvider {
  readonly id = "openverse" as const;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;
  private tokenRequest: Promise<string> | undefined;

  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(): boolean { return true; }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://api.openverse.org/v1/images/");
    url.search = new URLSearchParams({ q: input.query, page_size: String(Math.min(input.perPage, 20)) }).toString();
    const token = await this.getAccessToken(input.signal);
    const headers = { ...imageSearchHeaders(this.config), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers },
    }) as OpenverseResponse;
    return (data.results ?? []).flatMap((item, index) => {
      if (item.mature || !item.url || !item.thumbnail || !item.width || !item.height
        || Math.min(item.width, item.height) < 320) return [];
      const fileType = (item.filetype ?? new URL(item.url).pathname.split(".").pop() ?? "unknown").toLowerCase();
      if (!["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(fileType)) return [];
      return [{
        provider: this.id,
        providerItemId: item.id,
        title: item.title ?? "",
        description: item.attribution ?? "",
        tags: (item.tags ?? []).map((tag) => tag.name ?? "").filter(Boolean),
        previewUrl: item.thumbnail,
        imageUrl: item.url,
        sourceUrl: item.foreign_landing_url ?? item.url,
        sourceSite: item.provider ?? item.source ?? "Openverse",
        width: item.width,
        height: item.height,
        fileType,
        watermark: "UNKNOWN" as const,
        license: normalizeOpenverseLicense(item),
        sourceProvider: item.source,
        providerPosition: Math.max(0, 1 - index / input.perPage),
      } as NormalizedImageResult];
    });
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string | undefined> {
    const clientId = this.config.OPENVERSE_CLIENT_ID;
    const clientSecret = this.config.OPENVERSE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return undefined;
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    if (!this.tokenRequest) {
      this.tokenRequest = this.requestAccessToken(clientId, clientSecret, signal);
    }
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = undefined;
    }
  }

  private async requestAccessToken(clientId: string, clientSecret: string, signal?: AbortSignal): Promise<string> {
    const response = await fetchJsonWithRetry({
      url: new URL("https://api.openverse.org/v1/auth_tokens/token/"),
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal,
      init: {
        method: "POST",
        headers: { ...imageSearchHeaders(this.config), "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
      },
    }) as OpenverseTokenResponse;
    if (typeof response.access_token !== "string" || !response.access_token
      || typeof response.expires_in !== "number" || response.expires_in <= 0) {
      throw new Error("Openverse returned an invalid client-credentials token response");
    }
    this.accessToken = response.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(0, response.expires_in - 60) * 1_000;
    return response.access_token;
  }
}
