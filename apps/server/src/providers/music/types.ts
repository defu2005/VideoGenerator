import type { LicenseMetadata, MusicProvider, RawMusicTrack } from "@vg/shared";

export interface MusicSearchResult extends RawMusicTrack {
  provider: MusicProvider;
  providerItemId: string;
  artist: string | null;
  sourceUrl: string | null;
  /** Remote URL to stream and download. Null for local library tracks. */
  audioUrl: string | null;
  license: LicenseMetadata;
}

export interface MusicSearchProvider {
  readonly id: MusicProvider;
  search(input: { query: string; limit: number; signal?: AbortSignal }): Promise<MusicSearchResult[]>;
}

export const UNKNOWN_LICENSE: LicenseMetadata = {
  kind: "UNKNOWN",
  name: "Unknown license",
  url: null,
  author: null,
  authorUrl: null,
  attributionRequired: false,
  attributionText: "",
  evidence: "none",
};
