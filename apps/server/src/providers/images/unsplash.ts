import { normalizeUnsplashLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type UnsplashResponse = {
  results?: {
    id: string;
    description?: string | null;
    alt_description?: string | null;
    width: number;
    height: number;
    urls?: { small?: string; regular?: string; full?: string };
    links?: { html?: string; download_location?: string };
    user?: {
      name?: string;
      links?: { html?: string };
    };
  }[];
};

export class UnsplashImageProvider implements ImageSearchProvider {
  readonly id = "unsplash" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(config: AppConfig): boolean { return Boolean(config.UNSPLASH_ACCESS_KEY?.trim()); }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const orientation = input.orientation === "square" ? "squarish" : input.orientation;
    const url = new URL("https://api.unsplash.com/search/photos");
    url.search = new URLSearchParams({
      query: input.query,
      per_page: String(Math.min(input.perPage, 30)),
      orientation,
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: {
        headers: {
          ...imageSearchHeaders(this.config),
          Authorization: `Client-ID ${this.config.UNSPLASH_ACCESS_KEY ?? ""}`,
        },
      },
    }) as UnsplashResponse;
    return (data.results ?? []).flatMap((photo, index) => {
      const previewUrl = photo.urls?.small ?? photo.urls?.regular;
      const imageUrl = photo.urls?.regular ?? photo.urls?.full ?? photo.urls?.small;
      if (!previewUrl || !imageUrl || Math.min(photo.width, photo.height) < 320) return [];
      const author = photo.user?.name ?? "";
      const authorUrl = photo.user?.links?.html;
      const sourceUrl = photo.links?.html ?? `https://unsplash.com/photos/${photo.id}`;
      return [{
        provider: this.id,
        providerItemId: photo.id,
        title: photo.alt_description ?? photo.description ?? "",
        description: photo.description ?? photo.alt_description ?? "",
        tags: [],
        previewUrl,
        imageUrl,
        sourceUrl,
        sourceSite: "Unsplash",
        width: photo.width,
        height: photo.height,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license: normalizeUnsplashLicense(author, authorUrl, sourceUrl),
        downloadLocation: photo.links?.download_location,
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }

  /** Ping Unsplash download_location once when a photo is selected. */
  async trackDownload(downloadLocation: string, signal?: AbortSignal): Promise<void> {
    const url = new URL(downloadLocation);
    await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal,
      init: {
        headers: {
          ...imageSearchHeaders(this.config),
          Authorization: `Client-ID ${this.config.UNSPLASH_ACCESS_KEY ?? ""}`,
        },
      },
    });
  }
}
