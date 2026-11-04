import type { AppConfig } from "../../lib/config.js";
import { probeDurationSec } from "../../media/ffmpeg.js";
import { LocalMusicProvider } from "./local.js";
import { OpenverseMusicProvider } from "./openverse.js";
import { UNKNOWN_LICENSE, type MusicSearchProvider, type MusicSearchResult } from "./types.js";

export class MockMusicProvider implements MusicSearchProvider {
  readonly id = "mock" as const;
  async search(input: { query: string }): Promise<MusicSearchResult[]> {
    return [
      { title: "Calm piano", tags: ["calm", "piano", "instrumental"], durationSec: 180 },
      { title: "Epic drums", tags: ["epic", "drums", "energetic"], durationSec: 150 },
      { title: "Pop vocals", tags: ["pop", "vocals"], durationSec: 200 },
    ].map((track, index) => ({
      provider: this.id,
      providerItemId: `mock-${index}`,
      artist: "Mock artist",
      sourceUrl: null,
      audioUrl: `https://music.example.test/${index}.mp3?q=${encodeURIComponent(input.query)}`,
      genres: [],
      licenseKind: "CC0" as const,
      license: { ...UNKNOWN_LICENSE, kind: "CC0" as const, name: "CC0", evidence: "api" as const },
      ...track,
    }));
  }
}

export function createMusicProviders(config: AppConfig, overrides: Partial<Record<string, MusicSearchProvider>> = {}): MusicSearchProvider[] {
  return config.MUSIC_PROVIDERS.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean).flatMap((id) => {
    if (overrides[id]) return [overrides[id]!];
    if (id === "openverse") return [new OpenverseMusicProvider({ userAgent: config.IMAGE_SEARCH_USER_AGENT, timeoutMs: config.MUSIC_SEARCH_TIMEOUT_MS })];
    if (id === "local") return [new LocalMusicProvider(config.MUSIC_LIBRARY_DIR, probeDurationSec)];
    if (id === "mock") return [new MockMusicProvider()];
    return [];
  });
}
