import { normalizeOpenverseLicense } from "@vg/shared";
import type { MusicSearchProvider, MusicSearchResult } from "./types.js";

type OpenverseAudio = {
  id: string;
  title?: string;
  url?: string;
  filetype?: string | null;
  duration?: number | null;
  genres?: string[] | null;
  tags?: { name?: string }[] | null;
  license?: string;
  license_version?: string;
  license_url?: string;
  creator?: string;
  creator_url?: string;
  attribution?: string;
  foreign_landing_url?: string;
  mature?: boolean;
};

const PLAYABLE = new Set(["mp3", "mp32", "ogg", "wav", "flac", "m4a"]);

/**
 * Openverse matches every word, so a long mood + topic query often finds nothing.
 * Fall back to the first and last word, then the first word alone.
 */
export function openverseQueryFallbacks(query: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const queries = [words.join(" ")];
  if (words.length > 2) queries.push(`${words[0]} ${words[words.length - 1]}`);
  if (words.length > 1) queries.push(words[0]);
  return [...new Set(queries)].filter(Boolean);
}

export class OpenverseMusicProvider implements MusicSearchProvider {
  readonly id = "openverse" as const;

  constructor(
    private readonly options: { userAgent: string; timeoutMs: number; fetchImpl?: typeof fetch },
  ) {}

  async search(input: { query: string; limit: number; signal?: AbortSignal }): Promise<MusicSearchResult[]> {
    for (const query of openverseQueryFallbacks(input.query)) {
      const results = await this.searchOnce({ ...input, query });
      if (results.length) return results;
    }
    return [];
  }

  private async searchOnce(input: { query: string; limit: number; signal?: AbortSignal }): Promise<MusicSearchResult[]> {
    const url = new URL("https://api.openverse.org/v1/audio/");
    url.search = new URLSearchParams({
      q: input.query,
      page_size: String(Math.min(Math.max(input.limit, 1), 20)),
      category: "music",
      mature: "false",
    }).toString();
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      headers: { "User-Agent": this.options.userAgent, Accept: "application/json" },
      signal: AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs), ...(input.signal ? [input.signal] : [])]),
    });
    if (!response.ok) throw new Error(`Openverse audio returned HTTP ${response.status}`);
    const data = await response.json() as { results?: OpenverseAudio[] };
    return (data.results ?? []).flatMap((item) => {
      if (item.mature || !item.url) return [];
      const fileType = (item.filetype ?? "").toLowerCase();
      if (fileType && !PLAYABLE.has(fileType)) return [];
      const license = normalizeOpenverseLicense(item);
      return [{
        provider: this.id,
        providerItemId: item.id,
        title: item.title?.trim() || "Untitled",
        artist: item.creator?.trim() || null,
        sourceUrl: item.foreign_landing_url ?? null,
        audioUrl: item.url,
        // Openverse reports duration in milliseconds.
        durationSec: typeof item.duration === "number" && item.duration > 0 ? Math.round(item.duration / 100) / 10 : null,
        genres: (item.genres ?? []).filter(Boolean),
        tags: (item.tags ?? []).map((tag) => tag.name ?? "").filter(Boolean),
        licenseKind: license.kind,
        license,
      }];
    });
  }
}
