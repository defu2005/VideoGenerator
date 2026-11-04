import { normalizeSmithsonianLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type SiMedia = {
  thumbnail?: string;
  content?: string;
  type?: string;
  usage?: { access?: string };
};

type SiRow = {
  id?: string;
  title?: string;
  url?: string;
  content?: {
    descriptiveNonRepeating?: {
      title_sort?: string;
      record_link?: string;
      online_media?: { media?: SiMedia[] };
    };
    freetext?: {
      creditLine?: { content?: string }[];
      name?: { content?: string }[];
    };
  };
};

type SiResponse = {
  response?: { rows?: SiRow[] };
};

export class SmithsonianImageProvider implements ImageSearchProvider {
  readonly id = "smithsonian" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(config: AppConfig): boolean { return Boolean(config.SMITHSONIAN_API_KEY?.trim()); }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://api.si.edu/openaccess/api/v1.0/search");
    url.search = new URLSearchParams({
      api_key: this.config.SMITHSONIAN_API_KEY ?? "",
      q: input.query,
      rows: String(Math.min(input.perPage, 25)),
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as SiResponse;
    return (data.response?.rows ?? []).flatMap((row, index) => {
      const media = row.content?.descriptiveNonRepeating?.online_media?.media ?? [];
      const image = media.find((item) => (item.type ?? "").toLowerCase().includes("image") || item.content)
        ?? media[0];
      if (!image?.content) return [];
      const access = image.usage?.access ?? "";
      const credit = row.content?.freetext?.creditLine?.[0]?.content
        ?? row.content?.freetext?.name?.[0]?.content
        ?? null;
      const license = normalizeSmithsonianLicense(access, credit);
      if (!license) return [];
      const previewUrl = image.thumbnail || image.content;
      const sourceUrl = row.content?.descriptiveNonRepeating?.record_link
        || row.url
        || `https://www.si.edu/object/${row.id ?? ""}`;
      return [{
        provider: this.id,
        providerItemId: String(row.id ?? sourceUrl),
        title: row.title ?? row.content?.descriptiveNonRepeating?.title_sort ?? "Smithsonian object",
        description: credit ?? "",
        tags: [],
        previewUrl,
        imageUrl: image.content,
        sourceUrl,
        sourceSite: "Smithsonian Open Access",
        width: 1200,
        height: 900,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license,
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
