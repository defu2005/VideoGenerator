import type { AppConfig } from "../../lib/config.js";
import { normalizeWikimediaLicense } from "@vg/shared";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { ImageSearchProvider, NormalizedImageResult } from "./types.js";

type WikimediaResponse = {
  query?: { pages?: Record<string, {
    pageid: number;
    title: string;
    index?: number;
    imageinfo?: {
      url?: string;
      thumburl?: string;
      width?: number;
      height?: number;
      mime?: string;
      descriptionurl?: string;
      extmetadata?: Record<string, { value?: string }>;
    }[];
  }> };
};

export class WikimediaImageProvider implements ImageSearchProvider {
  readonly id = "wikimedia" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: typeof fetch) {}
  enabled(): boolean { return true; }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: input.query,
      gsrlimit: String(Math.min(input.perPage, 50)),
      prop: "imageinfo",
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1920",
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as WikimediaResponse;
    const pages = Object.values(data.query?.pages ?? {})
      .map((page, insertionIndex) => ({ page, insertionIndex }))
      .sort((left, right) => (left.page.index ?? left.insertionIndex) - (right.page.index ?? right.insertionIndex));
    return pages.flatMap(({ page }, index) => {
      const image = page.imageinfo?.[0];
      if (!image?.url || !image.thumburl || !image.width || !image.height || !image.descriptionurl) return [];
      if (!image.mime?.startsWith("image/") || Math.min(image.width, image.height) < 320) return [];
      const metadata = image.extmetadata ?? {};
      return [{
        provider: this.id,
        providerItemId: String(page.pageid),
        title: page.title.replace(/^File:/, ""),
        description: metadata.ImageDescription?.value ?? "",
        tags: [metadata.ObjectName?.value ?? ""].filter(Boolean),
        previewUrl: image.thumburl,
        imageUrl: image.url,
        sourceUrl: image.descriptionurl,
        sourceSite: "Wikimedia Commons",
        width: image.width,
        height: image.height,
        fileType: image.mime === "image/svg+xml" ? "svg" : image.mime.split("/")[1]?.toLowerCase() ?? "unknown",
        watermark: "UNKNOWN" as const,
        license: normalizeWikimediaLicense(metadata),
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
