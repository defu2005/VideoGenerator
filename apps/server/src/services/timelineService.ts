import { createHash } from "node:crypto";
import { recheckOriginalitySafely } from "../originality/recheckSafely.js";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import {
  buildTimeline,
  defaultMaxCharsPerLine,
  fallbackGraphics,
  resolveFormat,
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
import { rememberTimelineSnapshot, undoTimelineSnapshot, type SnapshotSource } from "../timeline/snapshots.js";

const READY_STATUSES = new Set(["APPROVED", "CUSTOM", "AI_GENERATED"]);

type SceneRow = {
  id: string;
  order: number;
  label: string;
  narration: string;
  no_visual: number;
  est_duration_sec: number;
  duration_override_sec: number | null;
  section_id: string | null;
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
  score_breakdown: string | null;
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

function commentaryStill(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) as { usage?: string } : raw;
    return parsed?.usage === "commentary";
  } catch {
    return false;
  }
}

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
      "SELECT id, \"order\", label, narration, no_visual, est_duration_sec, duration_override_sec, section_id FROM scenes WHERE project_id = ? ORDER BY \"order\" ASC",
    ).all(project.id) as SceneRow[];
    if (!scenes.length) throw new StageError("Chưa có cảnh nào — chạy bước Chia cảnh trước.", "TIMELINE_NO_SCENES", false);

    const voices = new Map((this.sqlite.prepare(
      "SELECT id, scene_id, audio_path, duration_sec, input_hash FROM voice_tracks WHERE project_id = ?",
    ).all(project.id) as VoiceRow[]).map((row) => [row.scene_id, row]));
    const visuals = this.sqlite.prepare(`
      SELECT s.scene_id, s.slot, s.status, s.motion, s.candidate_id,
        c.local_path, c.sha256, c.actual_width, c.actual_height, c.license, c.score_breakdown
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
          commentary: commentaryStill(row.score_breakdown),
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
    const editPreset = project.settings.format
      ? resolveFormat({
        topic: project.topic,
        aspectRatio,
        targetDurationSec: project.settings.targetDurationSec,
        format: project.settings.format,
      }).recipe.edit.preset
      : undefined;
    const inputHash = createHash("sha256").update(JSON.stringify({
      formatVersion: TIMELINE_FORMAT_VERSION,
      input,
      editPreset: editPreset ?? null,
      motionGraphics: project.settings.motionGraphics?.enabled === true,
      subtitleFont: project.settings.edit?.fontSize ?? null,
      subtitleHighlight: project.settings.edit?.highlightColor ?? null,
      cues: cues?.map((cue) => [cue.sceneId, cue.startSec, cue.endSec, cue.text]) ?? null,
      maxCharsPerLine,
    })).digest("hex");

    const existing = this.row(project.id);
    if (existing && existing.input_hash === inputHash) {
      const parsed = TimelineSchema.safeParse(JSON.parse(existing.data));
      const filesOk = parsed.success
        && (!parsed.data.subtitles || (existsSync(parsed.data.subtitles.srtPath) && existsSync(parsed.data.subtitles.assPath)));
      if (parsed.success && filesOk) {
        recheckOriginalitySafely(this.sqlite, project.id);
        return { timeline: parsed.data, inputHash, reused: true };
      }
    }

    const { voiceOffsets, ...built } = buildTimeline({ ...input, ...(editPreset ? { editPreset } : {}) });
    let subtitles: Timeline["subtitles"] = null;
    if (cues) {
      // Voice-relative cues → video clock, using real scene offsets (silent scenes included).
      const durations = new Map(built.scenes.filter((scene) => scene.voice)
        .map((scene) => [scene.sceneId, scene.voice!.durationSec + VOICE_TAIL_SEC]));
      const placed = cues.filter((cue) => cue.sceneId && voiceOffsets[cue.sceneId] !== undefined);
      const paths = writeSubtitleFiles(join(this.dir(project.id), "timeline"), placed, voiceOffsets, aspectRatio, maxCharsPerLine, durations, {
        ...(project.settings.edit?.fontSize ? { fontSize: project.settings.edit.fontSize } : {}),
        ...(project.settings.edit?.highlightColor ? { highlightColor: project.settings.edit.highlightColor } : {}),
      });
      subtitles = { ...paths, cueCount: placed.length };
    }
    const motionOn = project.settings.motionGraphics?.enabled === true;
    const recipe = resolveFormat({
      topic: project.topic,
      aspectRatio,
      targetDurationSec: project.settings.targetDurationSec,
      format: project.settings.format,
    }).recipe;
    const keys = this.sceneSectionKeys(project.id);
    const graphics = motionOn
      ? fallbackGraphics({
        title: project.title,
        aspect: aspectRatio,
        totalDurationSec: built.totalDurationSec,
        preset: editPreset ?? recipe.edit.preset,
        settings: project.settings.motionGraphics,
        recipe,
        scenes: built.scenes.map((scene, index) => ({
          sceneId: scene.sceneId,
          startSec: scene.startSec,
          durationSec: scene.durationSec,
          label: scene.label,
          narration: keys.narration.get(scene.sceneId),
          hook: index === 0,
          sectionKey: keys.sectionKey.get(scene.sceneId),
        })),
      })
      : undefined;
    const timeline = TimelineSchema.parse({ ...built, subtitles, ...(graphics ? { graphics } : {}) });

    const now = this.now().toISOString();
    this.sqlite.prepare(`
      INSERT INTO timelines (project_id, data, input_hash, total_duration_sec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET data = excluded.data, input_hash = excluded.input_hash,
        total_duration_sec = excluded.total_duration_sec, updated_at = excluded.updated_at
    `).run(project.id, JSON.stringify(timeline), inputHash, timeline.totalDurationSec, now, now);
    this.sqlite.prepare("UPDATE projects SET duration_sec = ? WHERE id = ?").run(Math.round(timeline.totalDurationSec), project.id);
    recheckOriginalitySafely(this.sqlite, project.id);
    return { timeline, inputHash, reused: false };
  }

  private sceneSectionKeys(projectId: string): { sectionKey: Map<string, string>; narration: Map<string, string> } {
    const script = this.sqlite.prepare("SELECT data FROM scripts WHERE project_id = ?").get(projectId) as { data: string } | undefined;
    const bySection = new Map<string, string>();
    if (script) {
      const parsed = JSON.parse(script.data) as { sections?: Array<{ id?: string; sectionKey?: string }> };
      for (const section of parsed.sections ?? []) {
        if (section.id && section.sectionKey) bySection.set(section.id, section.sectionKey);
      }
    }
    const rows = this.sqlite.prepare("SELECT id, section_id, narration FROM scenes WHERE project_id = ?").all(projectId) as Array<{ id: string; section_id: string | null; narration: string }>;
    const sectionKey = new Map<string, string>();
    const narration = new Map<string, string>();
    for (const row of rows) {
      narration.set(row.id, row.narration);
      const key = row.section_id ? bySection.get(row.section_id) : undefined;
      if (key) sectionKey.set(row.id, key);
    }
    return { sectionKey, narration };
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

  saveEditPlan(projectId: string, plan: import("@vg/shared").EditPlan): Timeline {
    const current = this.get(projectId).timeline;
    if (!current) throw new StageError("Chưa có timeline.", "TIMELINE_MISSING", false);
    const transitions = new Map(plan.transitions.map((item) => [item.afterSceneId, item]));
    const motions = new Map(plan.motions.map((item) => [item.sceneId, item.preset]));
    rememberTimelineSnapshot(this.sqlite, projectId, current, "manual", "Lưu kế hoạch dựng");
    const timeline = TimelineSchema.parse({
      ...current,
      revision: (current.revision ?? 0) + 1,
      editPlan: plan,
      scenes: current.scenes.map((scene) => {
        const transition = transitions.get(scene.sceneId);
        const preset = motions.get(scene.sceneId);
        return {
          ...scene,
          ...(transition ? { transitionOut: { type: transition.type, durationSec: transition.durationSec } } : {}),
          visuals: scene.visuals.map((visual, index) => (index === 0 && preset ? { ...visual, motionPreset: preset } : visual)),
        };
      }),
    });
    const now = this.now().toISOString();
    this.sqlite.prepare("UPDATE timelines SET data = ?, updated_at = ? WHERE project_id = ?")
      .run(JSON.stringify(timeline), now, projectId);
    recheckOriginalitySafely(this.sqlite, projectId);
    return timeline;
  }

  writeEdited(projectId: string, timeline: Timeline, source: SnapshotSource, summary: string): Timeline {
    const current = this.get(projectId).timeline;
    if (current) rememberTimelineSnapshot(this.sqlite, projectId, current, source, summary);
    const next = TimelineSchema.parse(timeline);
    const now = this.now().toISOString();
    const existing = this.row(projectId);
    if (!existing) {
      this.sqlite.prepare(
        `INSERT INTO timelines (project_id, data, input_hash, total_duration_sec, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(projectId, JSON.stringify(next), "edit", next.totalDurationSec, now, now);
    } else {
      this.sqlite.prepare("UPDATE timelines SET data = ?, updated_at = ? WHERE project_id = ?")
        .run(JSON.stringify(next), now, projectId);
    }
    recheckOriginalitySafely(this.sqlite, projectId);
    return next;
  }

  undo(projectId: string): Timeline | null {
    const restored = undoTimelineSnapshot(
      this.sqlite,
      projectId,
      (path) => this.fileExists(projectId, path),
    );
    if (!restored) return null;
    const current = this.get(projectId).timeline;
    const next = TimelineSchema.parse({
      ...restored.timeline,
      revision: (current?.revision ?? restored.timeline.revision ?? 0) + 1,
    });
    if (current) rememberTimelineSnapshot(this.sqlite, projectId, current, "manual", `Hoàn tác: ${restored.summary}`);
    const now = this.now().toISOString();
    this.sqlite.prepare("UPDATE timelines SET data = ?, updated_at = ? WHERE project_id = ?")
      .run(JSON.stringify(next), now, projectId);
    recheckOriginalitySafely(this.sqlite, projectId);
    return next;
  }

  canApproveFinal(projectId: string): { allowed: true } | { allowed: false; message: string } {
    return this.get(projectId).timeline
      ? { allowed: true }
      : { allowed: false, message: "Chưa có timeline — chạy bước Timeline trước khi duyệt render." };
  }
}
