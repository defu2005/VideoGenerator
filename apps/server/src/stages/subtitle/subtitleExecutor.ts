import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { cuesWithoutTimings, defaultMaxCharsPerLine, splitCue, toAss, toSrt, wrapLines, type SubtitleCue } from "@vg/shared";
import type { AppConfig } from "../../lib/config.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { projectDir } from "../../storage/paths.js";

// Bump when the written .srt/.ass format changes, so existing files are regenerated.
const SUBTITLE_FORMAT_VERSION = "v3";

type VoiceTrackRow = {
  id: string;
  project_id: string;
  scene_id: string;
  audio_path: string;
  duration_sec: number;
  cues: string | Array<{ startSec: number; endSec: number; text: string }>;
  input_hash: string;
  narration_hash: string;
};

function normalizeCues(cues: Array<{ startSec: number; endSec: number; text: string; edited?: boolean; sceneId?: string; index?: number }>): SubtitleCue[] {
  return cues
    .map((cue, index) => ({
      ...cue,
      startSec: Number(cue.startSec ?? 0),
      endSec: Number(cue.endSec ?? cue.startSec ?? 0),
      text: String(cue.text ?? "").trim(),
      edited: Boolean(cue.edited),
      index: cue.index ?? index,
    }))
    .filter((cue) => cue.text.length > 0)
    .sort((left, right) => left.startSec - right.startSec);
}

export function writeSubtitleFiles(
  projectDirPath: string,
  cues: SubtitleCue[],
  sceneOffsets: Map<string, number> | Record<string, number> | undefined,
  aspectRatio: string = "16:9",
  maxCharsPerLine: number = defaultMaxCharsPerLine(aspectRatio as "16:9" | "9:16" | "1:1"),
  sceneDurations?: Map<string, number>,
  style?: { fontSize?: number; highlightColor?: string },
): { srtPath: string; assPath: string } {
  const targetDir = join(projectDirPath, "subtitles");
  const srtPath = join(targetDir, "subtitles.srt");
  const assPath = join(targetDir, "subtitles.ass");
  mkdirSync(targetDir, { recursive: true });

  let previousEnd = 0;
  const absoluteCues = cues.map((cue) => {
    const offset = sceneOffsets instanceof Map
      ? sceneOffsets.get(cue.sceneId ?? "") ?? 0
      : sceneOffsets && typeof sceneOffsets === "object"
        ? Number((sceneOffsets as Record<string, number>)[cue.sceneId ?? ""] ?? 0)
        : 0;
    const sceneEnd = sceneDurations?.has(cue.sceneId ?? "")
      ? offset + Number(sceneDurations.get(cue.sceneId ?? ""))
      : Number.POSITIVE_INFINITY;
    const startSec = Math.min(Math.max(Number(cue.startSec ?? 0) + offset, previousEnd), sceneEnd);
    const endSec = Math.min(Math.max(Number(cue.endSec ?? cue.startSec ?? 0) + offset, startSec), sceneEnd);
    previousEnd = endSec;
    return {
      ...cue,
      startSec,
      endSec,
      text: wrapLines(cue.text, maxCharsPerLine, 2).join("\n"),
    };
  });

  writeFileSync(srtPath, toSrt(absoluteCues), "utf8");
  writeFileSync(assPath, toAss(absoluteCues, {
    aspectRatio,
    fontName: "Arial",
    ...(style?.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style?.highlightColor ? { highlightColor: style.highlightColor } : {}),
  }), "utf8");
  return { srtPath, assPath };
}

export class SubtitleExecutor implements StageExecutor {
  readonly stage = "SUBTITLE" as const;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
  ) {}

  async run(context: StageContext) {
    const project = context.project;
    const scenes = this.sqlite.prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY \"order\" ASC").all(project.id) as Array<{ id: string; narration: string; order: number; label: string }>;
    const voiceRows = this.sqlite.prepare("SELECT * FROM voice_tracks WHERE project_id = ?").all(project.id) as VoiceTrackRow[];
    const voiceByScene = new Map(voiceRows.map((row) => [row.scene_id, row]));
    const narratedScenes = scenes.filter((scene) => scene.narration.trim().length > 0);
    const missing = narratedScenes.filter((scene) => !voiceByScene.has(scene.id));
    if (missing.length > 0) {
      throw new StageError(`Thiếu giọng đọc cho ${missing.length} cảnh — chạy bước Giọng đọc trước`, "VOICE_TRACK_MISSING", false);
    }

    const aspectRatio = project.settings.aspectRatio ?? "16:9";
    const maxCharsPerLine = Number(project.settings.subtitles?.maxCharsPerLine) > 0
      ? Number(project.settings.subtitles?.maxCharsPerLine)
      : defaultMaxCharsPerLine(aspectRatio);
    const subtitleDir = join(projectDir(this.config.DATA_DIR, project.id), "subtitles");
    mkdirSync(subtitleDir, { recursive: true });

    const generated: SubtitleCue[] = [];
    const inputParts: string[] = [];
    const sceneOffsets = new Map<string, number>();
    const sceneDurations = new Map<string, number>();
    let offsetSec = 0;

    for (const scene of narratedScenes) {
      sceneOffsets.set(scene.id, offsetSec);
      const duration = Number(voiceByScene.get(scene.id)?.duration_sec ?? 0);
      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      sceneDurations.set(scene.id, safeDuration);
      offsetSec += safeDuration;
    }

    for (const scene of narratedScenes) {
      const track = voiceByScene.get(scene.id)!;
      let cues: SubtitleCue[] = [];
      const rawCues = typeof track.cues === "string" ? JSON.parse(track.cues) as Array<{ startSec: number; endSec: number; text: string }> : track.cues;
      if (rawCues.length > 0) {
        cues = normalizeCues(rawCues).flatMap((cue) => splitCue({
          ...cue,
          sceneId: scene.id,
          index: cue.index,
          text: cue.text,
        }, {
          aspectRatio,
          maxCharsPerLine,
          maxLines: 2,
        }));
      } else {
        cues = cuesWithoutTimings(scene.narration, Number(track.duration_sec ?? 0), {
          aspectRatio,
          maxCharsPerLine,
          maxLines: 2,
        }).map((cue) => ({ ...cue, sceneId: scene.id, edited: false }));
      }
      if (cues.length === 0) {
        cues = [{ startSec: 0, endSec: Number(track.duration_sec ?? 0), text: scene.narration.trim(), sceneId: scene.id, edited: false }];
      }
      const resolved = cues.map((cue, cueIndex) => ({
        ...cue,
        index: cueIndex,
        sceneId: scene.id,
        startSec: Number(cue.startSec ?? 0),
        endSec: Number(cue.endSec ?? Number(track.duration_sec ?? 0)),
        text: String(cue.text ?? "").trim(),
      })).filter((cue) => cue.text.length > 0);
      generated.push(...resolved);
      inputParts.push(`${scene.id}\u0000${track.input_hash}\u0000${scene.narration.trim()}\u0000${aspectRatio}\u0000${maxCharsPerLine}\u0000${project.settings.edit?.fontSize ?? ""}\u0000${project.settings.edit?.highlightColor ?? ""}\u0000${SUBTITLE_FORMAT_VERSION}`);
    }

    const inputHash = createHash("sha256").update(inputParts.join("\u0000")).digest("hex");
    const existing = this.sqlite.prepare("SELECT * FROM subtitle_tracks WHERE project_id = ?").get(project.id) as { input_hash: string; srt_path: string; ass_path: string } | undefined;
    const srtPath = join(subtitleDir, "subtitles.srt");
    const assPath = join(subtitleDir, "subtitles.ass");
    if (existing && existing.input_hash === inputHash && existsSync(existing.srt_path) && existsSync(existing.ass_path)) {
      return { message: `${generated.length} dòng phụ đề · ${narratedScenes.length} cảnh`, outputHash: inputHash };
    }

    const filePaths = writeSubtitleFiles(
      projectDir(this.config.DATA_DIR, project.id),
      generated,
      sceneOffsets,
      aspectRatio,
      maxCharsPerLine,
      sceneDurations,
      {
        ...(project.settings.edit?.fontSize ? { fontSize: project.settings.edit.fontSize } : {}),
        ...(project.settings.edit?.highlightColor ? { highlightColor: project.settings.edit.highlightColor } : {}),
      },
    );
    const finalSrtPath = filePaths.srtPath;
    const finalAssPath = filePaths.assPath;

    const now = new Date().toISOString();
    this.sqlite.prepare(
      `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET cues = excluded.cues, srt_path = excluded.srt_path, ass_path = excluded.ass_path, input_hash = excluded.input_hash, updated_at = excluded.updated_at`,
    ).run(
      randomUUID(),
      project.id,
      JSON.stringify(generated),
      finalSrtPath,
      finalAssPath,
      inputHash,
      now,
      now,
    );

    return { message: `${generated.length} dòng phụ đề · ${narratedScenes.length} cảnh`, outputHash: inputHash };
  }
}
