import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { defaultMaxCharsPerLine, type SubtitleCue } from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { projectDir } from "../storage/paths.js";
import { writeSubtitleFiles } from "../stages/subtitle/subtitleExecutor.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const CueIndexParams = z.object({ id: z.string().uuid(), index: z.coerce.number().int().nonnegative() }).strict();
const DownloadParams = z.object({ id: z.string().uuid(), ext: z.enum(["srt", "ass"]) }).strict();
const EditCueBody = z.object({ text: z.string().max(5000).transform((value) => value.trim()) }).strict();

type SubtitleTrackRow = {
  id: string;
  project_id: string;
  cues: string | SubtitleCue[];
  srt_path: string;
  ass_path: string;
  input_hash: string;
  updated_at: string;
};

function parseCues(value: string | SubtitleCue[] | undefined): SubtitleCue[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as SubtitleCue[];
    } catch {
      return [];
    }
  }
  return value;
}

function getSubtitleSceneTiming(db: Database.Database, projectId: string): { offsets: Map<string, number>; durations: Map<string, number> } {
  const rows = db.prepare(`
    SELECT s.id, s."order", s.narration, v.duration_sec
    FROM scenes s
    LEFT JOIN voice_tracks v ON v.scene_id = s.id
    WHERE s.project_id = ?
    ORDER BY s."order" ASC
  `).all(projectId) as Array<{ id: string; narration: string; duration_sec?: number | null }>;

  const offsets = new Map<string, number>();
  const durations = new Map<string, number>();
  let cumulative = 0;
  for (const row of rows) {
    if (row.narration.trim().length > 0) {
      offsets.set(row.id, cumulative);
      const duration = Number(row.duration_sec ?? 0);
      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      durations.set(row.id, safeDuration);
      cumulative += safeDuration;
    }
  }
  return { offsets, durations };
}

function getProjectSubtitleDurationSec(db: Database.Database, projectId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(v.duration_sec), 0) AS total
    FROM voice_tracks v
    INNER JOIN scenes s ON s.id = v.scene_id AND s.project_id = v.project_id
    WHERE v.project_id = ? AND TRIM(s.narration) <> ''
  `).get(projectId) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

export function registerSubtitleRoutes(
  app: FastifyInstance,
  db: Database.Database,
  repository: JobRepository,
  config: AppConfig,
): void {
  app.get("/api/projects/:id/subtitles", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const row = db.prepare("SELECT * FROM subtitle_tracks WHERE project_id = ?").get(id) as SubtitleTrackRow | undefined;
    const cues = parseCues(row?.cues ?? []);
    return {
      cues,
      totalDurationSec: getProjectSubtitleDurationSec(db, id),
      updatedAt: row?.updated_at ?? new Date().toISOString(),
    };
  });

  app.patch("/api/projects/:id/subtitles/cues/:index", async (request) => {
    const { id, index } = CueIndexParams.parse(request.params);
    const body = EditCueBody.parse(request.body ?? {});
    const row = db.prepare("SELECT * FROM subtitle_tracks WHERE project_id = ?").get(id) as SubtitleTrackRow | undefined;
    if (!row) throw new AppError(404, "SUBTITLE_TRACK_NOT_FOUND", "Subtitle track not found");
    const cues = parseCues(row.cues);
    if (index < 0 || index >= cues.length) throw new AppError(404, "SUBTITLE_CUE_NOT_FOUND", "Subtitle cue not found");
    cues[index] = { ...cues[index], text: body.text, edited: true };
    const projectSettingsRow = db.prepare("SELECT settings FROM projects WHERE id = ?").get(id) as { settings: string } | undefined;
    const parsedSettings = projectSettingsRow ? JSON.parse(projectSettingsRow.settings) : {};
    const aspectRatio = parsedSettings.aspectRatio ?? "16:9";
    const configuredMaxChars = Number(parsedSettings.subtitles?.maxCharsPerLine);
    const maxCharsPerLine = Number.isFinite(configuredMaxChars) && configuredMaxChars > 0
      ? configuredMaxChars
      : defaultMaxCharsPerLine(aspectRatio);
    const { offsets, durations } = getSubtitleSceneTiming(db, id);
    const { srtPath, assPath } = writeSubtitleFiles(
      projectDir(config.DATA_DIR, id),
      cues,
      offsets,
      aspectRatio,
      maxCharsPerLine,
      durations,
    );
    const now = new Date().toISOString();
    db.prepare("UPDATE subtitle_tracks SET cues = ?, srt_path = ?, ass_path = ?, updated_at = ? WHERE project_id = ?").run(
      JSON.stringify(cues),
      srtPath,
      assPath,
      now,
      id,
    );
    markStaleFrom(repository, id, "MUSIC_REVIEW");
    return { cues, totalDurationSec: getProjectSubtitleDurationSec(db, id), updatedAt: now, maxCharsPerLine };
  });

  app.get("/api/projects/:id/subtitles/file.:ext", async (request, reply) => {
    const { id, ext } = DownloadParams.parse(request.params);
    const row = db.prepare("SELECT * FROM subtitle_tracks WHERE project_id = ?").get(id) as SubtitleTrackRow | undefined;
    if (!row) throw new AppError(404, "SUBTITLE_TRACK_NOT_FOUND", "Subtitle track not found");
    const filePath = ext === "srt" ? row.srt_path : row.ass_path;
    if (!existsSync(filePath)) throw new AppError(404, "SUBTITLE_FILE_NOT_FOUND", "Subtitle file not found");
    const file = readFileSync(filePath, "utf8");
    const mimeType = ext === "srt" ? "text/plain; charset=utf-8" : "text/plain; charset=utf-8";
    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", `attachment; filename="subtitles.${ext}"`);
    return reply.send(file);
  });
}
