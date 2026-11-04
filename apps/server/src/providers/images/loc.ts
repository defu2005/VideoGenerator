import { normalizeLocLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type LocResult = {
  id?: string;
  title?: string;
  description?: string | string[];
  image_url?: string[];
  url?: string;
  rights?: string | string[];
  rights_information?: string | string[];
  rights_advisory?: string | string[];
  contributor?: string | string[];
  item?: {
    rights_information?: string | string[];
    rights_advisory?: string | string[];
  };
};

type LocResponse = {
  results?: LocResult[];
};

function asText(value: string | string[] | undefined): string {
  if (!value) return "";
  return Array.isArray(value) ? value.join(" ") : value;
}

export class LocImageProvider implements ImageSearchProvider {
  readonly id = "loc" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(): boolean { return true; }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const url = new URL("https://www.loc.gov/photos/");
    url.search = new URLSearchParams({
      q: input.query,
      fo: "json",
      c: String(Math.min(Math.max(input.perPage, 1), 40)),
      at: "results",
    }).toString();
    const data = await fetchJsonWithRetry({
      url,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as LocResponse;
    return (data.results ?? []).flatMap((item, index) => {
      const rights = [
        asText(item.rights_advisory),
        asText(item.rights_information),
        asText(item.rights),
        asText(item.item?.rights_advisory),
        asText(item.item?.rights_information),
      ].filter(Boolean).join(" ");
      const license = normalizeLocLicense(rights, asText(item.contributor) || null);
      if (!license) return [];
      const images = item.image_url ?? [];
      const previewUrl = images[0];
      const imageUrl = images[images.length - 1] ?? images[0];
      if (!previewUrl || !imageUrl) return [];
      const sourceUrl = item.url || item.id || "https://www.loc.gov/";
      return [{
        provider: this.id,
        providerItemId: String(item.id ?? sourceUrl),
        title: item.title ?? "Library of Congress photo",
        description: asText(item.description),
        tags: [],
        previewUrl,
        imageUrl,
        sourceUrl,
        sourceSite: "Library of Congress",
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
