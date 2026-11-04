import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import {
  DEFAULT_MUSIC_MIX,
  musicQueryFor,
  musicWords,
  rankMusicTracks,
  type LicenseMetadata,
  type MusicCandidate,
  type MusicSelection,
  type MusicSettingsPatch,
  type Project,
  type ProjectMusic,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { projectDir } from "../storage/paths.js";
import { resolveLibraryFile } from "../providers/music/local.js";
import { UNKNOWN_LICENSE, type MusicSearchProvider, type MusicSearchResult } from "../providers/music/types.js";
import { AudioDownloadError, MAX_AUDIO_BYTES, audioMimeType, type AudioStore } from "./audioStore.js";

const KEEP_CANDIDATES = 12;
const PER_PROVIDER = 20;

type CandidateRow = {
  id: string;
  project_id: string;
  provider: MusicCandidate["provider"];
  provider_item_id: string;
  title: string;
  artist: string | null;
  source_url: string | null;
  audio_url: string | null;
  duration_sec: number | null;
  genres: string;
  tags: string;
  license: string;
  relevance_score: number;
  score_breakdown: string;
  rank: number;
  local_path: string | null;
  input_hash: string;
  created_at: string;
};

type SelectionRow = {
  project_id: string;
  candidate_id: string | null;
  status: MusicSelection["status"];
  selected_by: MusicSelection["selectedBy"];
  volume: number;
  fade_in_sec: number;
  fade_out_sec: number;
  ducking_db: number;
  start_offset_sec: number;
  query_override: string | null;
  search_hash: string;
  updated_at: string;
};

export type MusicInput = {
  enabled: boolean;
  mood: string;
  energy: string;
  keywords: string[];
  query: string;
  videoDurationSec: number;
};

export type MusicSearchOutcome = {
  candidates: MusicCandidate[];
  reused: boolean;
  failedProviders: string[];
  query: string;
};

function toCandidate(row: CandidateRow): MusicCandidate {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    providerItemId: row.provider_item_id,
    title: row.title,
    artist: row.artist,
    sourceUrl: row.source_url,
    audioUrl: row.audio_url,
    durationSec: row.duration_sec === null ? null : Number(row.duration_sec),
    genres: JSON.parse(row.genres) as string[],
    tags: JSON.parse(row.tags) as string[],
    license: JSON.parse(row.license) as LicenseMetadata,
    relevanceScore: Number(row.relevance_score),
    scoreBreakdown: JSON.parse(row.score_breakdown) as Record<string, number>,
    rank: Number(row.rank),
    localPath: row.local_path,
    createdAt: row.created_at,
  };
}

function toSelection(row: SelectionRow): MusicSelection {
  return {
    projectId: row.project_id,
    candidateId: row.candidate_id,
    status: row.status,
    selectedBy: row.selected_by,
    volume: Number(row.volume),
    fadeInSec: Number(row.fade_in_sec),
    fadeOutSec: Number(row.fade_out_sec),
    duckingDb: Number(row.ducking_db),
    startOffsetSec: Number(row.start_offset_sec),
    queryOverride: row.query_override,
    updatedAt: row.updated_at,
  };
}

export class MusicService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly providers: MusicSearchProvider[],
    private readonly audioStore: AudioStore,
    private readonly probe: (file: string, signal?: AbortSignal) => Promise<number>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** What the music search is based on: script mood, scene moods, voice length. */
  input(project: Project): MusicInput {
    const scriptRow = this.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(project.id) as { data: string } | undefined;
    let music = { mood: "", energy: "medium", keywords: [] as string[] };
    if (scriptRow) {
      try {
        const data = JSON.parse(scriptRow.data) as { music?: Partial<typeof music> };
        music = {
          mood: data.music?.mood ?? "",
          energy: data.music?.energy ?? "medium",
          keywords: Array.isArray(data.music?.keywords) ? data.music.keywords.filter((word) => typeof word === "string") : [],
        };
      } catch {
        // A broken script row only loses the mood hint.
      }
    }
    const scenes = this.sqlite.prepare("SELECT id, music_mood, est_duration_sec, duration_override_sec FROM scenes WHERE project_id = ? ORDER BY \"order\"")
      .all(project.id) as Array<{ id: string; music_mood: string; est_duration_sec: number; duration_override_sec: number | null }>;
    const voice = new Map((this.sqlite.prepare("SELECT scene_id, duration_sec FROM voice_tracks WHERE project_id = ?").all(project.id) as Array<{ scene_id: string; duration_sec: number }>)
      .map((row) => [row.scene_id, Number(row.duration_sec)]));
    const videoDurationSec = Math.round(scenes.reduce((sum, scene) => {
      const voiced = voice.get(scene.id);
      return sum + (voiced && voiced > 0 ? voiced : Number(scene.duration_override_sec ?? scene.est_duration_sec ?? 0));
    }, 0) * 10) / 10;
    const selection = this.selectionRow(project.id);
    const query = selection?.query_override?.trim() || musicQueryFor(music, scenes.map((scene) => scene.music_mood));
    const mood = music.mood || [...new Set(scenes.map((scene) => scene.music_mood).filter(Boolean))].slice(0, 3).join(", ");
    return { enabled: project.settings.music.enabled, mood, energy: music.energy, keywords: music.keywords, query, videoDurationSec };
  }

  getProjectMusic(project: Project): ProjectMusic {
    const input = this.input(project);
    const candidates = this.candidates(project.id);
    const selectionRow = this.selectionRow(project.id);
    const selection = selectionRow ? toSelection(selectionRow) : null;
    return {
      enabled: input.enabled,
      mood: input.mood,
      energy: input.energy,
      query: input.query,
      videoDurationSec: input.videoDurationSec,
      candidates,
      selection,
      selectedCandidate: selection?.candidateId ? candidates.find((candidate) => candidate.id === selection.candidateId) ?? null : null,
    };
  }

  searchHash(input: MusicInput): string {
    const durationBucket = Math.round(input.videoDurationSec / 15);
    return createHash("sha256")
      .update(`${input.query}\u0000${this.providers.map((provider) => provider.id).join(",")}\u0000${durationBucket}\u0000${input.energy}`)
      .digest("hex");
  }

  /** Search all providers, rank, and replace the stored (non-upload) candidates. */
  async search(project: Project, options: { signal?: AbortSignal; force?: boolean; warn?: (message: string) => void } = {}): Promise<MusicSearchOutcome> {
    const input = this.input(project);
    const hash = this.searchHash(input);
    const existing = this.candidates(project.id);
    const selection = this.ensureSelection(project);
    if (!options.force && selection.search_hash === hash && existing.some((candidate) => candidate.provider !== "upload")) {
      return { candidates: existing, reused: true, failedProviders: [], query: input.query };
    }

    const failedProviders: string[] = [];
    const found: MusicSearchResult[] = [];
    for (const provider of this.providers) {
      try {
        found.push(...await provider.search({ query: input.query, limit: PER_PROVIDER, signal: options.signal }));
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason ?? error;
        failedProviders.push(provider.id);
        options.warn?.(`Music provider ${provider.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failedProviders.length === this.providers.length && this.providers.length > 0) {
      throw new AudioDownloadError(`Không tìm được nhạc: ${failedProviders.join(", ")} đều lỗi.`, undefined, true);
    }

    const ranked = rankMusicTracks(found, {
      mood: input.mood,
      energy: input.energy,
      keywords: [...input.keywords, ...musicWords(input.query)],
      videoDurationSec: input.videoDurationSec,
    }, KEEP_CANDIDATES);

    const createdAt = this.now().toISOString();
    this.sqlite.transaction(() => {
      const keepIds = new Set<string>();
      if (selection.candidate_id) keepIds.add(selection.candidate_id);
      const old = this.sqlite.prepare("SELECT * FROM music_candidates WHERE project_id = ?").all(project.id) as CandidateRow[];
      const oldByKey = new Map(old.map((row) => [`${row.provider}\u0000${row.provider_item_id}`, row]));
      ranked.forEach((track, index) => {
        const previous = oldByKey.get(`${track.provider}\u0000${track.providerItemId}`);
        const id = previous?.id ?? randomUUID();
        keepIds.add(id);
        this.sqlite.prepare(`INSERT INTO music_candidates (id, project_id, provider, provider_item_id, title, artist, source_url, audio_url, duration_sec, genres, tags, license, relevance_score, score_breakdown, rank, local_path, input_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, artist = excluded.artist, source_url = excluded.source_url, audio_url = excluded.audio_url,
            duration_sec = COALESCE(music_candidates.duration_sec, excluded.duration_sec), genres = excluded.genres, tags = excluded.tags, license = excluded.license,
            relevance_score = excluded.relevance_score, score_breakdown = excluded.score_breakdown, rank = excluded.rank, input_hash = excluded.input_hash`).run(
          id, project.id, track.provider, track.providerItemId, track.title, track.artist, track.sourceUrl, track.audioUrl, track.durationSec,
          JSON.stringify(track.genres), JSON.stringify(track.tags), JSON.stringify(track.license), track.score, JSON.stringify(track.breakdown),
          index, previous?.local_path ?? null, hash, previous?.created_at ?? createdAt,
        );
      });
      for (const row of old) {
        if (row.provider !== "upload" && !keepIds.has(row.id)) this.sqlite.prepare("DELETE FROM music_candidates WHERE id = ?").run(row.id);
      }
      this.sqlite.prepare("UPDATE music_selections SET search_hash = ?, updated_at = ? WHERE project_id = ?").run(hash, createdAt, project.id);
    })();
    return { candidates: this.candidates(project.id), reused: false, failedProviders, query: input.query };
  }

  /** Preselect the best track for review unless the user already decided. */
  preselectTop(project: Project): MusicCandidate | undefined {
    const selection = this.ensureSelection(project);
    if (selection.selected_by === "USER") return undefined;
    const top = this.candidates(project.id).filter((candidate) => candidate.provider !== "upload")[0]
      ?? this.candidates(project.id)[0];
    this.sqlite.prepare("UPDATE music_selections SET candidate_id = ?, status = 'REVIEW_REQUIRED', selected_by = 'AGENT', updated_at = ? WHERE project_id = ?")
      .run(top?.id ?? null, this.now().toISOString(), project.id);
    return top;
  }

  /** Download (if needed), probe and approve a candidate. */
  async select(project: Project, candidateId: string, selectedBy: "AGENT" | "USER", signal?: AbortSignal): Promise<ProjectMusic> {
    const row = this.candidateRow(project.id, candidateId);
    if (!row) throw new AppError(404, "MUSIC_CANDIDATE_NOT_FOUND", "Music candidate not found.");
    this.ensureSelection(project);
    let localPath = row.local_path && existsSync(join(projectDir(this.config.DATA_DIR, project.id), row.local_path)) ? row.local_path : null;
    if (!localPath) {
      try {
        if (row.provider === "local") {
          const file = resolveLibraryFile(this.config.MUSIC_LIBRARY_DIR, row.provider_item_id);
          if (!file) throw new AudioDownloadError("Không còn tệp nhạc này trong thư viện.");
          if (statSync(file).size > MAX_AUDIO_BYTES) throw new AudioDownloadError("Tệp nhạc vượt quá 30 MB.");
          localPath = this.audioStore.storeBuffer(project.id, readFileSync(file)).localPath;
        } else if (row.audio_url) {
          localPath = (await this.audioStore.download(project.id, row.audio_url, signal)).localPath;
        } else {
          throw new AudioDownloadError("Bản nhạc này không có đường dẫn tải.");
        }
      } catch (error) {
        if (error instanceof AudioDownloadError) throw new AppError(error.retryable ? 502 : 422, "MUSIC_DOWNLOAD_FAILED", error.message);
        throw error;
      }
    }
    let durationSec = row.duration_sec === null ? null : Number(row.duration_sec);
    try {
      const probed = await this.probe(join(projectDir(this.config.DATA_DIR, project.id), localPath), signal);
      if (probed > 0) durationSec = Math.round(probed * 10) / 10;
    } catch {
      // Keep the provider's duration when ffprobe is unavailable.
    }
    const now = this.now().toISOString();
    this.sqlite.prepare("UPDATE music_candidates SET local_path = ?, duration_sec = ? WHERE id = ?").run(localPath, durationSec, row.id);
    this.sqlite.prepare("UPDATE music_selections SET candidate_id = ?, status = 'APPROVED', selected_by = ?, updated_at = ? WHERE project_id = ?")
      .run(row.id, selectedBy, now, project.id);
    return this.getProjectMusic(project);
  }

  selectNone(project: Project, selectedBy: "AGENT" | "USER"): ProjectMusic {
    this.ensureSelection(project);
    this.sqlite.prepare("UPDATE music_selections SET candidate_id = NULL, status = 'NONE', selected_by = ?, updated_at = ? WHERE project_id = ?")
      .run(selectedBy, this.now().toISOString(), project.id);
    return this.getProjectMusic(project);
  }

  updateSettings(project: Project, patch: MusicSettingsPatch): ProjectMusic {
    const current = toSelection(this.ensureSelection(project));
    const next = {
      volume: patch.volume ?? current.volume,
      fadeInSec: patch.fadeInSec ?? current.fadeInSec,
      fadeOutSec: patch.fadeOutSec ?? current.fadeOutSec,
      duckingDb: patch.duckingDb ?? current.duckingDb,
      startOffsetSec: patch.startOffsetSec ?? current.startOffsetSec,
      queryOverride: patch.query === undefined ? current.queryOverride : (patch.query?.trim() || null),
    };
    this.sqlite.prepare(`UPDATE music_selections SET volume = ?, fade_in_sec = ?, fade_out_sec = ?, ducking_db = ?, start_offset_sec = ?, query_override = ?, updated_at = ?
      WHERE project_id = ?`).run(next.volume, next.fadeInSec, next.fadeOutSec, next.duckingDb, next.startOffsetSec, next.queryOverride, this.now().toISOString(), project.id);
    return this.getProjectMusic(project);
  }

  async upload(project: Project, bytes: Buffer, fileName: string): Promise<ProjectMusic> {
    if (bytes.byteLength > MAX_AUDIO_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Tệp nhạc vượt quá 30 MB.");
    let stored;
    try {
      stored = this.audioStore.storeBuffer(project.id, bytes);
    } catch (error) {
      if (error instanceof AudioDownloadError) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", error.message);
      throw error;
    }
    let durationSec: number | null = null;
    try {
      const probed = await this.probe(join(projectDir(this.config.DATA_DIR, project.id), stored.localPath));
      durationSec = probed > 0 ? Math.round(probed * 10) / 10 : null;
    } catch {
      durationSec = null;
    }
    this.ensureSelection(project);
    const existing = this.sqlite.prepare("SELECT id FROM music_candidates WHERE project_id = ? AND provider = 'upload' AND provider_item_id = ?")
      .get(project.id, stored.sha256) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const title = fileName.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "Nhạc tải lên";
    const license: LicenseMetadata = { ...UNKNOWN_LICENSE, kind: "USER_PROVIDED", name: "Nhạc do bạn cung cấp", evidence: "user" };
    const now = this.now().toISOString();
    this.sqlite.prepare(`INSERT INTO music_candidates (id, project_id, provider, provider_item_id, title, artist, source_url, audio_url, duration_sec, genres, tags, license, relevance_score, score_breakdown, rank, local_path, input_hash, created_at)
      VALUES (?, ?, 'upload', ?, ?, NULL, NULL, NULL, ?, '[]', '[]', ?, 1, '{}', 0, ?, '', ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, duration_sec = excluded.duration_sec, local_path = excluded.local_path`)
      .run(id, project.id, stored.sha256, title, durationSec, JSON.stringify(license), stored.localPath, now);
    this.sqlite.prepare("UPDATE music_selections SET candidate_id = ?, status = 'APPROVED', selected_by = 'USER', updated_at = ? WHERE project_id = ?")
      .run(id, now, project.id);
    return this.getProjectMusic(project);
  }

  /** Local audio for a candidate: the downloaded copy, or the library file itself. */
  audioFile(projectId: string, candidateId: string): { path: string; mimeType: string } {
    const row = this.candidateRow(projectId, candidateId);
    if (!row) throw new AppError(404, "MUSIC_CANDIDATE_NOT_FOUND", "Music candidate not found.");
    if (row.local_path) {
      const path = join(projectDir(this.config.DATA_DIR, projectId), row.local_path);
      if (existsSync(path)) return { path, mimeType: audioMimeType(path) };
    }
    if (row.provider === "local") {
      const path = resolveLibraryFile(this.config.MUSIC_LIBRARY_DIR, row.provider_item_id);
      if (path) return { path, mimeType: audioMimeType(path) };
    }
    throw new AppError(404, "MUSIC_FILE_NOT_FOUND", "Bản nhạc này chưa được tải về.");
  }

  canApproveMusicReview(project: Project): { allowed: true } | { allowed: false; message: string } {
    if (!project.settings.music.enabled) return { allowed: true };
    const selection = this.selectionRow(project.id);
    if (selection?.status === "NONE") return { allowed: true };
    if (selection?.status === "APPROVED" && selection.candidate_id) {
      const row = this.candidateRow(project.id, selection.candidate_id);
      if (row?.local_path && existsSync(join(projectDir(this.config.DATA_DIR, project.id), row.local_path))) return { allowed: true };
    }
    return { allowed: false, message: "Hãy chọn một bản nhạc (Dùng bản này) hoặc chọn \"Không dùng nhạc\" trước khi duyệt." };
  }

  ensureSelection(project: Project): SelectionRow {
    const existing = this.selectionRow(project.id);
    if (existing) return existing;
    this.sqlite.prepare(`INSERT INTO music_selections (project_id, candidate_id, status, selected_by, volume, fade_in_sec, fade_out_sec, ducking_db, start_offset_sec, query_override, search_hash, updated_at)
      VALUES (?, NULL, 'REVIEW_REQUIRED', 'AGENT', ?, ?, ?, ?, ?, NULL, '', ?)`).run(
      project.id, project.settings.music.volume, DEFAULT_MUSIC_MIX.fadeInSec, DEFAULT_MUSIC_MIX.fadeOutSec, DEFAULT_MUSIC_MIX.duckingDb,
      DEFAULT_MUSIC_MIX.startOffsetSec, this.now().toISOString(),
    );
    return this.selectionRow(project.id)!;
  }

  selectionRow(projectId: string): SelectionRow | undefined {
    return this.sqlite.prepare("SELECT * FROM music_selections WHERE project_id = ?").get(projectId) as SelectionRow | undefined;
  }

  private candidates(projectId: string): MusicCandidate[] {
    return (this.sqlite.prepare("SELECT * FROM music_candidates WHERE project_id = ? ORDER BY CASE provider WHEN 'upload' THEN 0 ELSE 1 END, rank, created_at")
      .all(projectId) as CandidateRow[]).map(toCandidate);
  }

  private candidateRow(projectId: string, candidateId: string): CandidateRow | undefined {
    return this.sqlite.prepare("SELECT * FROM music_candidates WHERE id = ? AND project_id = ?").get(candidateId, projectId) as CandidateRow | undefined;
  }
}
