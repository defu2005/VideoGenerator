import type { LicenseMetadata } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import { unknownWebLicense } from "./webCrawl.js";
import type { FetchJson, ImageSearchInput, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type BraveImageResult = {
  type?: string;
  title?: string;
  url?: string;
  source?: string;
  thumbnail?: { src?: string; width?: number; height?: number };
  properties?: {
    url?: string;
    placeholder?: string;
    width?: number;
    height?: number;
  };
  meta_url?: { hostname?: string; netloc?: string };
};

type BraveImageSearchResponse = {
  type?: string;
  results?: BraveImageResult[];
};

const MIN_SIDE = 320;

export function mapBraveImageResults(
  data: BraveImageSearchResponse,
  input: { query: string; perPage: number },
): NormalizedImageResult[] {
  const results = data.results ?? [];
  return results.flatMap((item, index) => {
    const imageUrl = item.properties?.url;
    if (!imageUrl) return [];
    const width = item.properties?.width ?? item.thumbnail?.width ?? 0;
    const height = item.properties?.height ?? item.thumbnail?.height ?? 0;
    if (width > 0 && height > 0 && Math.min(width, height) < MIN_SIDE) return [];
    const pageUrl = item.url?.trim() || imageUrl;
    const previewUrl = item.thumbnail?.src || item.properties?.placeholder || imageUrl;
    const sourceSite = item.source
      || item.meta_url?.hostname
      || item.meta_url?.netloc
      || safeHostname(pageUrl)
      || "web";
    const title = item.title?.trim() || "";
    const license: LicenseMetadata = unknownWebLicense();
    const why = `Brave image result for '${input.query}' from ${sourceSite}`;
    return [{
      provider: "brave" as const,
      providerItemId: `brave:${hashId(imageUrl)}`,
      title,
      description: title,
      tags: [],
      previewUrl,
      imageUrl,
      sourceUrl: pageUrl,
      sourcePageUrl: pageUrl,
      sourceSite,
      width: width || 1280,
      height: height || 720,
      fileType: guessFileType(imageUrl),
      watermark: "UNKNOWN" as const,
      license,
      licenseVerified: false,
      why,
      providerPosition: Math.max(0, 1 - index / Math.max(input.perPage, 1)),
      searchQuery: input.query,
    }];
  });
}

export class BraveImageProvider implements ImageSearchProvider {
  readonly id = "brave" as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl?: FetchJson,
  ) {}

  enabled(config: AppConfig = this.config): boolean {
    return Boolean(config.BRAVE_SEARCH_API_KEY?.trim());
  }

  async search(input: ImageSearchInput): Promise<NormalizedImageResult[]> {
    if (!this.enabled()) return [];
    const url = new URL("https://api.search.brave.com/res/v1/images/search");
    url.search = new URLSearchParams({
      q: input.query,
      count: String(Math.min(Math.max(input.perPage, 1), 20)),
      safesearch: "strict",
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: {
        headers: {
          ...imageSearchHeaders(this.config),
          "X-Subscription-Token": this.config.BRAVE_SEARCH_API_KEY ?? "",
          Accept: "application/json",
        },
      },
    }) as BraveImageSearchResponse;
    return mapBraveImageResults(data, { query: input.query, perPage: input.perPage });
  }
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function guessFileType(url: string): string {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "png";
  if (path.endsWith(".webp")) return "webp";
  if (path.endsWith(".gif")) return "gif";
  if (path.endsWith(".svg")) return "svg";
  return "jpeg";
}

function hashId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
