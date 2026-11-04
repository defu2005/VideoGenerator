import { normalizeNasaLicense } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { fetchJsonWithRetry, imageSearchHeaders } from "./http.js";
import type { FetchJson, ImageSearchProvider, NormalizedImageResult } from "./types.js";

type NasaLink = {
  href?: string;
  rel?: string;
  render?: string;
  width?: number;
  height?: number;
  size?: number;
};

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
  links?: NasaLink[];
};

type NasaResponse = {
  collection?: { items?: NasaItem[] };
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MIN_LONG_SIDE_PX = 640;
const PREFERRED_LONG_SIDE_PX = 1920;

/** Higher is better when width/height are missing. */
const SUFFIX_RANK: Record<string, number> = {
  large: 5,
  medium: 4,
  orig: 3,
  small: 2,
  thumb: 1,
};

function nasaSuffix(href: string): string | null {
  const match = href.match(/~([a-zA-Z0-9]+)\.[^./?#]+(?:\?|$)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function longerSide(link: NasaLink): number | null {
  if (typeof link.width !== "number" || typeof link.height !== "number") return null;
  return Math.max(link.width, link.height);
}

function pickBestImageLink(links: NasaLink[]): NasaLink | null {
  const candidates = links.filter((link) =>
    link.render === "image"
    && typeof link.href === "string"
    && link.href.length > 0
    && (link.size == null || link.size <= MAX_IMAGE_BYTES),
  );
  if (candidates.length === 0) return null;

  const withDims = candidates.filter((link) => longerSide(link) != null);
  if (withDims.length > 0) {
    const bigEnough = withDims
      .filter((link) => longerSide(link)! >= PREFERRED_LONG_SIDE_PX)
      .sort((a, b) => longerSide(a)! - longerSide(b)!);
    if (bigEnough.length > 0) return bigEnough[0]!;
    return [...withDims].sort((a, b) => longerSide(b)! - longerSide(a)!)[0]!;
  }

  return [...candidates].sort((a, b) => {
    const rankA = SUFFIX_RANK[nasaSuffix(a.href!) ?? ""] ?? 0;
    const rankB = SUFFIX_RANK[nasaSuffix(b.href!) ?? ""] ?? 0;
    return rankB - rankA;
  })[0]!;
}

function pickPreviewUrl(links: NasaLink[], fallbackHref: string): string {
  const preview = links.find((link) => link.rel === "preview" && link.href)?.href;
  if (preview) return preview;
  const images = links.filter((link) => link.render === "image" && link.href);
  if (images.length === 0) return fallbackHref;
  const withDims = images.filter((link) => longerSide(link) != null);
  if (withDims.length > 0) {
    return [...withDims].sort((a, b) => longerSide(a)! - longerSide(b)!)[0]!.href!;
  }
  return [...images].sort((a, b) => {
    const rankA = SUFFIX_RANK[nasaSuffix(a.href!) ?? ""] ?? 0;
    const rankB = SUFFIX_RANK[nasaSuffix(b.href!) ?? ""] ?? 0;
    return rankA - rankB;
  })[0]!.href!;
}

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
      const links = item.links ?? [];
      const best = pickBestImageLink(links);
      if (!best?.href) return [];
      const side = longerSide(best);
      if (side != null && side < MIN_LONG_SIDE_PX) return [];
      const previewUrl = pickPreviewUrl(links, best.href);
      const width = typeof best.width === "number" ? best.width : 1280;
      const height = typeof best.height === "number" ? best.height : 720;
      return [{
        provider: this.id,
        providerItemId: meta.nasa_id,
        title: meta.title ?? meta.nasa_id,
        description: meta.description ?? "",
        tags: meta.keywords ?? [],
        previewUrl,
        imageUrl: best.href,
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
