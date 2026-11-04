import { normalizeNasaLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type NasaItem = {
  href?: string;
  data?: {
    nasa_id?: string;
    title?: string;
    description?: string;
    keywords?: string[];
    center?: string;
    photographer?: string;
    media_type?: string;
  }[];
  links?: { href?: string; rel?: string; render?: string }[];
};

type NasaResponse = {
  collection?: { items?: NasaItem[] };
};

export class NasaImageProvider implements ImageSearchProvider {
  readonly id = "nasa" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(): boolean { return true; }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://images-api.nasa.gov/search");
    url.search = new URLSearchParams({
      q: input.query,
      media_type: "image",
      page_size: String(Math.min(input.perPage, 100)),
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as NasaResponse;
    return (data.collection?.items ?? []).flatMap((item, index) => {
      const meta = item.data?.[0];
      if (!meta?.nasa_id || meta.media_type !== "image") return [];
      const preview = item.links?.find((link) => link.rel === "preview")?.href
        ?? item.links?.find((link) => link.render === "image")?.href;
      if (!preview) return [];
      // Prefer medium/large CDN paths derived from the preview when possible.
      const imageUrl = preview.replace("~thumb", "~large").replace("~small", "~medium");
      const width = 1280;
      const height = 720;
      return [{
        provider: this.id,
        providerItemId: meta.nasa_id,
        title: meta.title ?? meta.nasa_id,
        description: meta.description ?? "",
        tags: meta.keywords ?? [],
        previewUrl: preview,
        imageUrl,
        sourceUrl: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`,
        sourceSite: "NASA Image and Video Library",
        width,
        height,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license: normalizeNasaLicense({
          photographer: meta.photographer,
          center: meta.center,
          title: meta.title,
          nasaId: meta.nasa_id,
        }),
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
