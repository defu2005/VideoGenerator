import { normalizePexelsLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { ImageSearchProvider, NormalizedImageResult } from "./types.js";

type PexelsResponse = { photos?: {
  id: number;
  url: string;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  width: number;
  height: number;
  src: { medium?: string; large?: string; large2x?: string };
}[] };

export class PexelsImageProvider implements ImageSearchProvider {
  readonly id = "pexels" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: typeof fetch) {}
  enabled(config: AppConfig): boolean { return Boolean(config.PEXELS_API_KEY); }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://api.pexels.com/v1/search");
    url.search = new URLSearchParams({
      query: input.query,
      per_page: String(Math.min(input.perPage, 80)),
      orientation: input.orientation,
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: {
        headers: { ...imageSearchHeaders(this.config), Authorization: this.config.PEXELS_API_KEY ?? "" },
      },
    }) as PexelsResponse;
    return (data.photos ?? []).flatMap((photo, index) => {
      if (!photo.src.medium || !photo.src.large || Math.min(photo.width, photo.height) < 320) return [];
      return [{
        provider: this.id,
        providerItemId: String(photo.id),
        title: photo.alt ?? "",
        description: photo.alt ?? "",
        tags: [],
        previewUrl: photo.src.medium,
        imageUrl: photo.src.large2x ?? photo.src.large,
        sourceUrl: photo.url,
        sourceSite: "Pexels",
        width: photo.width,
        height: photo.height,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license: normalizePexelsLicense(photo.photographer ?? "", photo.photographer_url),
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
