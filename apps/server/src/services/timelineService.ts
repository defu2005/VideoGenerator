import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import {
  buildTimeline,
  defaultMaxCharsPerLine,
  TimelineSchema,
  TIMELINE_FORMAT_VERSION,
  VOICE_TAIL_SEC,
  type LicenseKind,
  type Project,
  type ProjectTimeline,
  type SubtitleCue,
  type Timeline,
  type TimelineBuildInput,
  type TimelineSceneInput,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { StageError } from "../pipeline/stageExecutor.js";
import { writeSubtitleFiles } from "../stages/subtitle/subtitleExecutor.js";
import { projectDir } from "../storage/paths.js";

const READY_STATUSES = new Set(["APPROVED", "CUSTOM", "AI_GENERATED"]);

type SceneRow = {
  id: string;
  order: number;
  label: string;
  narration: string;
  no_visual: number;
  est_duration_sec: number;
  duration_override_sec: number | null;
};
type VoiceRow = { id: string; scene_id: string; audio_path: string; duration_sec: number; input_hash: string };
type VisualRow = {
  scene_id: string;
  slot: number;
  status: string;
  motion: string | null;
  candidate_id: string;
  local_path: string | null;
  sha256: string | null;
  actual_width: number | null;
  actual_height: number | null;
  license: string;
};
type MusicRow = {
  status: string;
  candidate_id: string | null;
  volume: number;
  fade_in_sec: number;
  fade_out_sec: number;
  ducking_db: number;
  start_offset_sec: number;
  title: string | null;
  duration_sec: number | null;
  local_path: string | null;
  license: string | null;
};
type TimelineRow = { project_id: string; data: string; input_hash: string; total_duration_sec: number; updated_at: string };

function licenseKindOf(raw: string | null): LicenseKind | null {
  if (!raw) return null;
  try {
    const kind = (JSON.parse(raw) as { kind?: unknown }).kind;
    return typeof kind === "string" ? kind as LicenseKind : null;
  } catch {
    return null;
  }
}

function parseMotion(raw: string | null): TimelineSceneInput["visuals"][number]["motion"] {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as TimelineSceneInput["visuals"][number]["motion"];
    return value && typeof value === "object" && "type" in value ? value : null;
  } catch {
    return null;
  }
}

export class TimelineService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dir(projectId: string): string {
    return projectDir(this.config.DATA_DIR, projectId);
  }

  private fileExists(projectId: string, path: string | null): boolean {
    if (!path) return false;
    return existsSync(isAbsolute(path) ? path : join(this.dir(projectId), path));
  }

  /** Reads scenes, voice, visuals and music from the DB into the pure builder input. */
  collectInput(project: Project): { input: TimelineBuildInput; cues: SubtitleCue[] | null } {
    const scenes = this.sqlite.prepare(
      "SELECT id, \"order\", label, narration, no_visual, est_duration_sec, duration_override_sec FROM scenes WHERE project_id = ? ORDER BY \"order\" ASC",
    ).all(project.id) as SceneRow[];
    if (!scenes.length) throw new StageError("Chưa có cảnh nào — chạy bước Chia cảnh trước.", "TIMELINE_NO_SCENES", false);

    const voices = new Map((this.sqlite.prepare(
      "SELECT id, scene_id, audio_path, duration_sec, input_hash FROM voice_tracks WHERE project_id = ?",
    ).all(project.id) as VoiceRow[]).map((row) => [row.scene_id, row]));
    const visuals = this.sqlite.prepare(`
      SELECT s.scene_id, s.slot, s.status, s.motion, s.candidate_id,
        c.local_path, c.sha256, c.actual_width, c.actual_height, c.license
      FROM visual_selections s JOIN visual_candidates c ON c.id = s.candidate_id
      WHERE s.project_id = ? ORDER BY s.scene_id, s.slot ASC
    `).all(project.id) as VisualRow[];

    const missingVoice = scenes.filter((scene) => scene.narration.trim() && !voices.has(scene.id));
    if (missingVoice.length) {
      throw new StageError(`Thiếu giọng đọc cho ${missingVoice.length} cảnh — chạy bước Giọng đọc trước.`, "VOICE_TRACK_MISSING", false);
    }
    const lostFile = scenes.find((scene) => {
      const voice = voices.get(scene.id);
      return voice && scene.narration.trim() && !this.fileExists(project.id, voice.audio_path);
    });
    if (lostFile) {
      throw new StageError(`Tệp giọng đọc của cảnh ${lostFile.order + 1} không còn — chạy lại bước Giọng đọc.`, "VOICE_FILE_MISSING", false);
    }

    const sceneInputs: TimelineSceneInput[] = scenes.map((scene) => {
      const voice = scene.narration.trim() ? voices.get(scene.id) : undefined;
      return {
        id: scene.id,
        order: scene.order,
        label: scene.label,
        noVisual: Boolean(scene.no_visual),
        durationOverrideSec: scene.duration_override_sec,
        estDurationSec: scene.est_duration_sec,
        voice: voice ? { trackId: voice.id, path: voice.audio_path, durationSec: Number(voice.duration_sec) || 0 } : null,
        visuals: visuals.filter((row) => row.scene_id === scene.id).map((row) => ({
          candidateId: row.candidate_id,
          path: row.local_path,
          ready: READY_STATUSES.has(row.status) && Boolean(row.sha256 && row.actual_width && row.actual_height)
            && this.fileExists(project.id, row.local_path),
          licenseKind: licenseKindOf(row.license),
          motion: parseMotion(row.motion),
        })),
      };
    });

    const musicRow = this.sqlite.prepare(`
      SELECT s.status, s.candidate_id, s.volume, s.fade_in_sec, s.fade_out_sec, s.ducking_db, s.start_offset_sec,
        c.title, c.duration_sec, c.local_path, c.license
      FROM music_selections s LEFT JOIN music_candidates c ON c.id = s.candidate_id
      WHERE s.project_id = ?
    `).get(project.id) as MusicRow | undefined;
    const musicReady = musicRow?.status === "APPROVED" && musicRow.candidate_id && musicRow.local_path
      && this.fileExists(project.id, musicRow.local_path);
    // "No music" chosen by the user turns music off for this video, so no warning.
    const musicEnabled = (project.settings.music?.enabled ?? true) && musicRow?.status !== "NONE";

    let cues: SubtitleCue[] | null = null;
    if (project.settings.subtitles?.enabled ?? true) {
      const track = this.sqlite.prepare("SELECT cues FROM subtitle_tracks WHERE project_id = ?").get(project.id) as { cues: string } | undefined;
      const narrated = scenes.some((scene) => scene.narration.trim());
      if (!track && narrated) {
        throw new StageError("Chưa có phụ đề — chạy bước Phụ đề trước (hoặc tắt phụ đề).", "SUBTITLE_TRACK_MISSING", false);
      }
      cues = track ? JSON.parse(track.cues) as SubtitleCue[] : [];
    }

    return {
      input: {
        aspectRatio: project.settings.aspectRatio ?? "16:9",
        scenes: sceneInputs,
        musicEnabled,
        music: musicReady && musicRow ? {
          candidateId: musicRow.candidate_id!,
          title: musicRow.title ?? "Music",
          path: musicRow.local_path!,
          sourceDurationSec: musicRow.duration_sec,
          startOffsetSec: musicRow.start_offset_sec,
          volume: musicRow.volume,
          fadeInSec: musicRow.fade_in_sec,
          fadeOutSec: musicRow.fade_out_sec,
          duckingDb: musicRow.ducking_db,
          licenseKind: licenseKindOf(musicRow.license),
        } : null,
      },
      cues,
    };
  }

  /** Builds (or reuses) the timeline. Throws StageError when inputs are not ready. */
  build(project: Project): { timeline: Timeline; inputHash: string; reused: boolean } {
    const { input, cues } = this.collectInput(project);
    const aspectRatio = input.aspectRatio;
    const maxCharsPerLine = Number(project.settings.subtitles?.maxCharsPerLine) > 0
      ? Number(project.settings.subtitles?.maxCharsPerLine)
      : defaultMaxCharsPerLine(aspectRatio);
    const inputHash = createHash("sha256").update(JSON.stringify({
      formatVersion: TIMELINE_FORMAT_VERSION,
      input,
      cues: cues?.map((cue) => [cue.sceneId, cue.startSec, cue.endSec, cue.text]) ?? null,
      maxCharsPerLine,
    })).digest("hex");

    const existing = this.row(project.id);
    if (existing && existing.input_hash === inputHash) {
      const parsed = TimelineSchema.safeParse(JSON.parse(existing.data));
      const filesOk = parsed.success
        && (!parsed.data.subtitles || (existsSync(parsed.data.subtitles.srtPath) && existsSync(parsed.data.subtitles.assPath)));
      if (parsed.success && filesOk) return { timeline: parsed.data, inputHash, reused: true };
    }

    const { voiceOffsets, ...built } = buildTimeline(input);
    let subtitles: Timeline["subtitles"] = null;
    if (cues) {
      // Voice-relative cues → video clock, using real scene offsets (silent scenes included).
      const durations = new Map(built.scenes.filter((scene) => scene.voice)
        .map((scene) => [scene.sceneId, scene.voice!.durationSec + VOICE_TAIL_SEC]));
      const placed = cues.filter((cue) => cue.sceneId && voiceOffsets[cue.sceneId] !== undefined);
      const paths = writeSubtitleFiles(join(this.dir(project.id), "timeline"), placed, voiceOffsets, aspectRatio, maxCharsPerLine, durations);
      subtitles = { ...paths, cueCount: placed.length };
    }
    const timeline = TimelineSchema.parse({ ...built, subtitles });

    const now = this.now().toISOString();
    this.sqlite.prepare(`
      INSERT INTO timelines (project_id, data, input_hash, total_duration_sec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, input_hash = excluded.input_hash,
        total_duration_sec = excluded.total_duration_sec, updated_at = excluded.updated_at
    `).run(project.id, JSON.stringify(timeline), inputHash, timeline.totalDurationSec, now, now);
    this.sqlite.prepare("UPDATE projects SET duration_sec = ? WHERE id = ?").run(Math.round(timeline.totalDurationSec), project.id);
    return { timeline, inputHash, reused: false };
  }

  private row(projectId: string): TimelineRow | undefined {
    return this.sqlite.prepare("SELECT * FROM timelines WHERE project_id = ?").get(projectId) as TimelineRow | undefined;
  }

  get(projectId: string): ProjectTimeline {
    const row = this.row(projectId);
    if (!row) return { timeline: null, inputHash: null, updatedAt: null };
    const parsed = TimelineSchema.safeParse(JSON.parse(row.data));
    return parsed.success
      ? { timeline: parsed.data, inputHash: row.input_hash, updatedAt: row.updated_at }
      : { timeline: null, inputHash: null, updatedAt: null };
  }

  canApproveFinal(projectId: string): { allowed: true } | { allowed: false; message: string } {
    return this.get(projectId).timeline
      ? { allowed: true }
      : { allowed: false, message: "Chưa có timeline — chạy bước Timeline trước khi duyệt render." };
  }
}
