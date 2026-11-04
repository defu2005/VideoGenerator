import { normalizePixabayLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type PixabayResponse = {
  hits?: {
    id: number;
    pageURL?: string;
    type?: string;
    tags?: string;
    previewURL?: string;
    webformatURL?: string;
    largeImageURL?: string;
    imageWidth?: number;
    imageHeight?: number;
    user?: string;
  }[];
};

export class PixabayImageProvider implements ImageSearchProvider {
  readonly id = "pixabay" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(config: AppConfig): boolean { return Boolean(config.PIXABAY_API_KEY?.trim()); }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const orientation = input.orientation === "portrait" ? "vertical"
      : input.orientation === "landscape" ? "horizontal"
        : "all";
    const url = new URL("https://pixabay.com/api/");
    url.search = new URLSearchParams({
      key: this.config.PIXABAY_API_KEY ?? "",
      q: input.query.slice(0, 100),
      image_type: "photo",
      orientation,
      safesearch: "true",
      per_page: String(Math.min(Math.max(input.perPage, 3), 200)),
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as PixabayResponse;
    return (data.hits ?? []).flatMap((hit, index) => {
      const imageUrl = hit.largeImageURL ?? hit.webformatURL;
      const previewUrl = hit.webformatURL ?? hit.previewURL;
      const width = hit.imageWidth ?? 0;
      const height = hit.imageHeight ?? 0;
      if (!imageUrl || !previewUrl || Math.min(width, height) < 320) return [];
      return [{
        provider: this.id,
        providerItemId: String(hit.id),
        title: hit.tags ?? "",
        description: hit.tags ?? "",
        tags: (hit.tags ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
        previewUrl,
        imageUrl,
        sourceUrl: hit.pageURL ?? `https://pixabay.com/photos/${hit.id}/`,
        sourceSite: "Pixabay",
        width,
        height,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license: normalizePixabayLicense(hit.user ?? "", hit.pageURL),
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
