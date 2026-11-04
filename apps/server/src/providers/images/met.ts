import { normalizeMetLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type MetSearchResponse = { objectIDs?: number[] | null; total?: number };
type MetObject = {
  objectID?: number;
  isPublicDomain?: boolean;
  primaryImage?: string;
  primaryImageSmall?: string;
  title?: string;
  artistDisplayName?: string;
  objectURL?: string;
  medium?: string;
  department?: string;
};

const OBJECT_FETCH_CAP = 10;

export class MetImageProvider implements ImageSearchProvider {
  readonly id = "met" as const;
  constructor(private readonly config: AppConfig, private readonly fetchImpl?: FetchJson) {}
  enabled(): boolean { return true; }

  async search(input: Parameters<ImageSearchProvider["search"]>[0]): Promise<NormalizedImageResult[]> {
    const searchUrl = new URL("https://collectionapi.metmuseum.org/public/collection/v1/search");
    searchUrl.search = new URLSearchParams({
      q: input.query,
      hasImages: "true",
    }).toString();
    const search = await fetchJsonWithRetry({
      url: searchUrl,
      config: this.config,
      fetchImpl: this.fetchImpl,
      signal: input.signal,
      init: { headers: imageSearchHeaders(this.config) },
    }) as MetSearchResponse;
    const ids = (search.objectIDs ?? []).slice(0, Math.min(input.perPage, OBJECT_FETCH_CAP));
    const results: NormalizedImageResult[] = [];
    for (const [index, objectId] of ids.entries()) {
      if (input.signal?.aborted) throw input.signal.reason ?? new Error("Met search aborted");
      const objectUrl = new URL(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`);
      const object = await fetchJsonWithRetry({
        url: objectUrl,
        config: this.config,
        fetchImpl: this.fetchImpl,
        signal: input.signal,
        init: { headers: imageSearchHeaders(this.config) },
      }) as MetObject;
      if (!object.isPublicDomain) continue;
      const imageUrl = object.primaryImage;
      const previewUrl = object.primaryImageSmall || object.primaryImage;
      if (!imageUrl || !previewUrl) continue;
      results.push({
        provider: this.id,
        providerItemId: String(object.objectID ?? objectId),
        title: object.title ?? `Met object ${objectId}`,
        description: [object.artistDisplayName, object.medium, object.department].filter(Boolean).join(" · "),
        tags: [object.department ?? ""].filter(Boolean),
        previewUrl,
        imageUrl,
        sourceUrl: object.objectURL || `https://www.metmuseum.org/art/collection/search/${objectId}`,
        sourceSite: "The Metropolitan Museum of Art",
        width: 1200,
        height: 900,
        fileType: "jpeg",
        watermark: "NONE",
        license: normalizeMetLicense(object.artistDisplayName, object.objectURL),
        providerPosition: Math.max(0, 1 - index / input.perPage),
      });
    }
    return results;
  }
}
