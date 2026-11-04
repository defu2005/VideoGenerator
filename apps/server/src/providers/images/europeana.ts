import { normalizeEuropeanaLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type EuropeanaItem = {
  id?: string;
  guid?: string;
  title?: string[];
  dcCreator?: string[];
  edmPreview?: string[];
  edmIsShownBy?: string[];
  rights?: string[];
  dataProvider?: string[];
};

type EuropeanaResponse = {
  items?: EuropeanaItem[];
};

export class EuropeanaImageProvider implements ImageSearchProvider {
  readonly id = "europeana" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(config: AppConfig): boolean { return Boolean(config.EUROPEANA_API_KEY?.trim()); }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://api.europeana.eu/record/v2/search.json");
    url.search = new URLSearchParams({
      wskey: this.config.EUROPEANA_API_KEY ?? "",
      query: input.query,
      reusability: "open",
      media: "true",
      qf: "TYPE:IMAGE",
      rows: String(Math.min(input.perPage, 24)),
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as EuropeanaResponse;
    return (data.items ?? []).flatMap((item, index) => {
      const imageUrl = item.edmIsShownBy?.[0] ?? item.edmPreview?.[0];
      const previewUrl = item.edmPreview?.[0] ?? imageUrl;
      if (!imageUrl || !previewUrl) return [];
      const title = item.title?.[0] ?? "Europeana image";
      const creator = item.dcCreator?.[0] ?? null;
      const rights = item.rights?.[0];
      const sourceUrl = item.guid || (item.id ? `https://www.europeana.eu/item${item.id}` : "https://www.europeana.eu/");
      return [{
        provider: this.id,
        providerItemId: String(item.id ?? sourceUrl),
        title,
        description: (item.dataProvider ?? []).join(", "),
        tags: [],
        previewUrl,
        imageUrl,
        sourceUrl,
        sourceSite: "Europeana",
        width: 1200,
        height: 900,
        fileType: "jpeg",
        watermark: "NONE" as const,
        license: normalizeEuropeanaLicense(rights, creator),
        providerPosition: Math.max(0, 1 - index / input.perPage),
      }];
    });
  }
}
