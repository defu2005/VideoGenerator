import { normalizeFlickrLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type FlickrPhoto = {
  id: string;
  owner?: string;
  title?: string;
  license?: string | number;
  ownername?: string;
  url_m?: string;
  url_l?: string;
  url_o?: string;
  width_l?: number | string;
  height_l?: number | string;
  width_o?: number | string;
  height_o?: number | string;
  width_m?: number | string;
  height_m?: number | string;
};

type FlickrResponse = {
  photos?: { photo?: FlickrPhoto[] };
  stat?: string;
};

function num(value: number | string | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class FlickrImageProvider implements ImageSearchProvider {
  readonly id = "flickr" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(config: AppConfig): boolean { return Boolean(config.FLICKR_API_KEY?.trim()); }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://api.flickr.com/services/rest/");
    url.search = new URLSearchParams({
      method: "flickr.photos.search",
      api_key: this.config.FLICKR_API_KEY ?? "",
      text: input.query,
      // CC / PD license ids only (exclude 0 = All Rights Reserved)
      license: "1,2,3,4,5,6,7,8,9,10",
      media: "photos",
      content_type: "1",
      extras: "license,owner_name,url_m,url_l,url_o,o_dims",
      per_page: String(Math.min(input.perPage, 50)),
      format: "json",
      nojsoncallback: "1",
      sort: "relevance",
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as FlickrResponse;
    return (data.photos?.photo ?? []).flatMap((photo, index) => {
      const licenseId = Number(photo.license);
      const sourceUrl = `https://www.flickr.com/photos/${photo.owner ?? "unknown"}/${photo.id}`;
      const license = normalizeFlickrLicense(licenseId, photo.ownername, sourceUrl);
      if (!license) return [];
      const imageUrl = photo.url_l ?? photo.url_o ?? photo.url_m;
      const previewUrl = photo.url_m ?? photo.url_l ?? photo.url_o;
      if (!imageUrl || !previewUrl) return [];
      const width = num(photo.width_l ?? photo.width_o ?? photo.width_m, 1024);
      const height = num(photo.height_l ?? photo.height_o ?? photo.height_m, 768);
      if (Math.min(width, height) < 320) return [];
      return [{
        provider: this.id,
        providerItemId: photo.id,
        title: photo.title ?? "",
        description: photo.title ?? "",
        tags: [],
        previewUrl,
        imageUrl,
        sourceUrl,
        sourceSite: "Flickr",
        width,
        height,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license,
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
