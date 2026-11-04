import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { LICENSE_KINDS, musicWords } from "@vg/shared";
import { UNKNOWN_LICENSE, type MusicSearchProvider, type MusicSearchResult } from "./types.js";

const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a"]);

type LibraryEntry = {
  file: string;
  title?: string;
  artist?: string;
  tags?: string[];
  mood?: string;
  license?: string;
};

/** Resolve a library file name to an absolute path, refusing anything outside the library folder. */
export function resolveLibraryFile(libraryDir: string, fileName: string): string | undefined {
  const root = resolve(libraryDir);
  const target = resolve(root, fileName);
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return undefined;
  if (!AUDIO_EXTENSIONS.has(extname(target).toLowerCase()) || !existsSync(target)) return undefined;
  return target;
}

export class LocalMusicProvider implements MusicSearchProvider {
  readonly id = "local" as const;
  private readonly durations = new Map<string, number | null>();

  constructor(
    private readonly libraryDir: string,
    private readonly probe: (file: string, signal?: AbortSignal) => Promise<number>,
  ) {}

  async search(input: { query: string; limit: number; signal?: AbortSignal }): Promise<MusicSearchResult[]> {
    if (!existsSync(this.libraryDir)) return [];
    const metadata = this.readLibraryJson();
    const files = readdirSync(this.libraryDir)
      .filter((name) => AUDIO_EXTENSIONS.has(extname(name).toLowerCase()))
      .filter((name) => statSync(join(this.libraryDir, name)).isFile())
      .slice(0, 200);
    const queryWords = new Set(musicWords(input.query));
    const results: MusicSearchResult[] = [];
    for (const file of files) {
      const entry = metadata.get(file.toLowerCase());
      const nameWords = musicWords(basename(file, extname(file)).replace(/[_.]+/g, " "));
      const tags = [...new Set([...(entry?.tags ?? []), ...musicWords(entry?.mood ?? ""), ...nameWords])];
      const licenseKind = LICENSE_KINDS.find((kind) => kind === entry?.license?.toUpperCase()) ?? "UNKNOWN";
      results.push({
        provider: this.id,
        providerItemId: file,
        title: entry?.title?.trim() || basename(file, extname(file)),
        artist: entry?.artist?.trim() || null,
        sourceUrl: null,
        audioUrl: null,
        durationSec: await this.duration(join(this.libraryDir, file), input.signal),
        genres: [],
        tags,
        licenseKind,
        license: licenseKind === "UNKNOWN"
          ? { ...UNKNOWN_LICENSE, evidence: "user" }
          : { ...UNKNOWN_LICENSE, kind: licenseKind, name: entry?.license ?? licenseKind, evidence: "user" },
      });
    }
    // Library tracks the user chose to keep are always offered; ranking sorts them.
    return results
      .sort((a, b) => overlap(b.tags, queryWords) - overlap(a.tags, queryWords))
      .slice(0, Math.max(input.limit, 1));
  }

  private async duration(file: string, signal?: AbortSignal): Promise<number | null> {
    if (this.durations.has(file)) return this.durations.get(file) ?? null;
    let value: number | null = null;
    try {
      const probed = await this.probe(file, signal);
      value = probed > 0 ? Math.round(probed * 10) / 10 : null;
    } catch {
      value = null;
    }
    this.durations.set(file, value);
    return value;
  }

  private readLibraryJson(): Map<string, LibraryEntry> {
    const path = join(this.libraryDir, "library.json");
    if (!existsSync(path)) return new Map();
    try {
      const entries = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!Array.isArray(entries)) return new Map();
      return new Map(entries
        .filter((entry): entry is LibraryEntry => typeof entry === "object" && entry !== null && typeof (entry as LibraryEntry).file === "string")
        .map((entry) => [entry.file.toLowerCase(), entry]));
    } catch {
      return new Map();
    }
  }
}

function overlap(tags: string[], words: Set<string>): number {
  return tags.filter((tag) => words.has(tag.toLowerCase())).length;
}
