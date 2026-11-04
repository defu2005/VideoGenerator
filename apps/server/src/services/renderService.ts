import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import {
  RenderVisionBatchSchema,
  VideoMetadataDraftSchema,
  buildCreditsText,
  buildFinalPlan,
  buildMetadataText,
  buildSceneClipPlan,
  CLIP_OUTPUT_ARGS,
  concatListText,
  parseBlackdetect,
  parseProgressSeconds,
  RENDER_FORMAT_VERSION,
  RenderReportSchema,
  resolveBudget,
  type CreditsAsset,
  type Project,
  type ProjectRender,
  type Render,
  type RenderIssue,
  type RenderReport,
  type RenderVersion,
  type Timeline,
  type TimelineScene,
  type VideoMetadataDraft,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { probeMedia, runFfmpeg, type FfmpegRunOptions, type MediaProbe } from "../media/ffmpeg.js";
import { StageError } from "../pipeline/stageExecutor.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import { getRenderSettings } from "../settings/render.js";
import { projectDir } from "../storage/paths.js";
import type { TimelineService } from "./timelineService.js";

export type MediaTools = {
  ffmpeg: (args: string[], options: FfmpegRunOptions) => Promise<{ stdout: string; stderr: string }>;
  probe: (file: string, signal?: AbortSignal) => Promise<MediaProbe>;
};

export const defaultMediaTools: MediaTools = { ffmpeg: runFfmpeg, probe: probeMedia };

export type RenderProgress = (pct: number, message: string) => void;

const DURATION_TOLERANCE_SEC = 0.2;
const BASE_ARGS = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
const RECENT_READ_MS = 60_000;

type RenderRow = {
  id: string;
  project_id: string;
  input_hash: string;
  status: "DONE" | "FAILED";
  output_path: string;
  credits_path: string | null;
  srt_path: string | null;
  duration_sec: number;
  size_bytes: number;
  width: number;
  height: number;
  report: string;
  created_at: string;
  version: number;
  note: string | null;
  pinned: number | boolean;
  deleted_at: string | null;
  review_thread_id: string | null;
  metadata_snapshot: string | null;
};

type LicenseJson = {
  name?: string | null;
  url?: string | null;
  author?: string | null;
  attributionText?: string | null;
};

const sha = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function parseLicense(raw: string | null): LicenseJson {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as LicenseJson;
  } catch {
    return {};
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isBusyError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EBUSY" || code === "EPERM";
}

function isVersionPath(outputPath: string): boolean {
  return /[/\\]versions[/\\]/.test(outputPath);
}

/** Idempotent: assign version 1..n by created_at for rows still at 0. */
export function backfillRenderVersions(sqlite: Database.Database): void {
  const projects = sqlite.prepare(
    "SELECT DISTINCT project_id FROM renders WHERE version = 0",
  ).all() as Array<{ project_id: string }>;
  const update = sqlite.prepare("UPDATE renders SET version = ? WHERE id = ?");
  for (const { project_id } of projects) {
    const rows = sqlite.prepare(
      "SELECT id FROM renders WHERE project_id = ? ORDER BY created_at ASC, rowid ASC",
    ).all(project_id) as Array<{ id: string }>;
    let next = 1;
    for (const row of rows) {
      update.run(next, row.id);
      next += 1;
    }
  }
}

export class RenderService {
  private readonly recentReads = new Map<string, number>();
  private backfilled = false;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly timelines: Pick<TimelineService, "get">,
    private readonly tools: MediaTools = defaultMediaTools,
    private readonly now: () => Date = () => new Date(),
    private readonly llmProviders?: LlmProviderRegistry,
    private readonly autoReport?: import("./autoReportService.js").AutoReportService,
  ) {}

  private ensureBackfill(): void {
    if (this.backfilled) return;
    backfillRenderVersions(this.sqlite);
    this.backfilled = true;
  }

  private dir(projectId: string): string {
    return projectDir(this.config.DATA_DIR, projectId);
  }

  renderDir(projectId: string): string {
    return join(this.dir(projectId), "render");
  }

  versionDir(projectId: string, renderId: string): string {
    return join(this.renderDir(projectId), "versions", renderId);
  }

  private touchRead(renderId: string): void {
    this.recentReads.set(renderId, Date.now());
  }

  private wasRecentlyRead(renderId: string): boolean {
    const at = this.recentReads.get(renderId);
    return at !== undefined && Date.now() - at < RECENT_READ_MS;
  }

  private resolver(projectId: string) {
    const base = this.dir(projectId);
    return (path: string) => (isAbsolute(path) ? path : join(base, path));
  }

  /** Cache key of one scene clip: everything that changes its pixels. */
  clipHash(scene: TimelineScene, timeline: Timeline, resolvePath: (path: string) => string): string {
    return sha({
      v: RENDER_FORMAT_VERSION,
      target: timeline.target,
      frames: scene.durationFrames,
      fadeIn: scene.fadeInSec,
      fadeOut: scene.fadeOutSec,
      visuals: scene.visuals.map((visual) => {
        let file: { size: number; mtime: number } | null = null;
        if (visual.kind === "IMAGE" && visual.path) {
          const absolute = resolvePath(visual.path);
          if (!existsSync(absolute)) {
            throw new StageError(`Ảnh của cảnh ${scene.order + 1} không còn — chạy lại bước Hình ảnh/Timeline.`, "RENDER_VISUAL_MISSING", false);
          }
          const stat = statSync(absolute);
          file = { size: stat.size, mtime: Math.round(stat.mtimeMs) };
        }
        return { kind: visual.kind, path: visual.path, file, motion: visual.motion, start: visual.startSec, end: visual.endSec };
      }),
    }).slice(0, 32);
  }

  private latestRow(projectId: string): RenderRow | undefined {
    this.ensureBackfill();
    return this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).get(projectId) as RenderRow | undefined;
  }

  private rowById(projectId: string, renderId: string): RenderRow | undefined {
    this.ensureBackfill();
    return this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND id = ?",
    ).get(projectId, renderId) as RenderRow | undefined;
  }

  private toRender(row: RenderRow): Render | null {
    const report = RenderReportSchema.safeParse(JSON.parse(row.report));
    if (!report.success) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      inputHash: row.input_hash,
      durationSec: row.duration_sec,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      hasCredits: Boolean(row.credits_path && existsSync(row.credits_path)),
      hasSubtitles: Boolean(row.srt_path && existsSync(row.srt_path)),
      report: report.data,
      createdAt: row.created_at,
    };
  }

  private toVersion(row: RenderRow): RenderVersion | null {
    const render = this.toRender(row);
    if (!render) return null;
    return {
      ...render,
      version: row.version,
      note: row.note,
      pinned: Boolean(row.pinned),
      deleted: Boolean(row.deleted_at),
      reviewThreadId: row.review_thread_id,
      hasMetadata: Boolean(row.metadata_snapshot),
    };
  }

  get(projectId: string): ProjectRender {
    const row = this.latestRow(projectId);
    if (!row || !existsSync(row.output_path)) return { render: null };
    return { render: this.toRender(row) };
  }

  list(projectId: string): { renders: RenderVersion[] } {
    this.ensureBackfill();
    const rows = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC, rowid DESC",
    ).all(projectId) as RenderRow[];

    // Hide older legacy TASK-012 rows that share the same overwritten output_path.
    const hidden = new Set<string>();
    const byPath = new Map<string, RenderRow[]>();
    for (const row of rows) {
      if (isVersionPath(row.output_path)) continue;
      const group = byPath.get(row.output_path) ?? [];
      group.push(row);
      byPath.set(row.output_path, group);
    }
    for (const group of byPath.values()) {
      if (group.length < 2) continue;
      for (const row of group.slice(1)) hidden.add(row.id);
    }

    const renders: RenderVersion[] = [];
    for (const row of rows) {
      if (hidden.has(row.id)) continue;
      const version = this.toVersion(row);
      if (version) renders.push(version);
    }
    return { renders };
  }

  getVersion(projectId: string, renderId: string): RenderVersion {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    const version = this.toVersion(row);
    if (!version) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    return version;
  }

  /** Absolute path of a downloadable render file, or null when it does not exist. */
  file(
    projectId: string,
    kind: "video" | "credits" | "subtitles" | "thumb",
    sceneId?: string,
    renderId?: string,
  ): string | null {
    const row = renderId ? this.rowById(projectId, renderId) : this.latestRow(projectId);
    if (!row || row.deleted_at) return null;
    this.touchRead(row.id);
    let path: string | null = null;
    if (kind === "video") path = row.output_path;
    else if (kind === "credits") path = row.credits_path;
    else if (kind === "subtitles") path = row.srt_path;
    else {
      const report = this.toRender(row)?.report;
      if (!sceneId || !report?.thumbnails.includes(sceneId)) return null;
      const versionThumbs = join(this.versionDir(projectId, row.id), "thumbs", `${sceneId}.jpg`);
      const legacyThumbs = join(this.renderDir(projectId), "thumbs", `${sceneId}.jpg`);
      path = existsSync(versionThumbs) ? versionThumbs : legacyThumbs;
    }
    return path && existsSync(path) ? path : null;
  }

  patch(projectId: string, renderId: string, patch: { note?: string | null; pinned?: boolean }): RenderVersion {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    const note = patch.note === undefined ? row.note : patch.note;
    if (note !== null && note.length > 500) {
      throw new AppError(400, "VALIDATION_ERROR", "Ghi chú tối đa 500 ký tự.");
    }
    const pinned = patch.pinned === undefined ? Boolean(row.pinned) : patch.pinned;
    this.sqlite.prepare("UPDATE renders SET note = ?, pinned = ? WHERE id = ?").run(note, pinned ? 1 : 0, renderId);
    return this.getVersion(projectId, renderId);
  }

  deleteVersion(projectId: string, renderId: string): RenderVersion {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    if (row.deleted_at) return this.toVersion(row)!;
    try {
      this.removeVersionFiles(projectId, row);
    } catch (error) {
      if (isBusyError(error)) {
        throw new AppError(409, "RENDER_IN_USE", "Không xoá được vì tệp đang được mở hoặc phát.");
      }
      throw error;
    }
    const deletedAt = this.now().toISOString();
    this.sqlite.prepare("UPDATE renders SET deleted_at = ? WHERE id = ?").run(deletedAt, renderId);
    return this.getVersion(projectId, renderId);
  }

  private removeVersionFiles(projectId: string, row: RenderRow): void {
    const versionFolder = this.versionDir(projectId, row.id);
    if (existsSync(versionFolder)) {
      rmSync(versionFolder, { recursive: true, force: false });
      return;
    }
    // Legacy single-folder rows: only delete files if no other non-deleted row still points at them.
    const stillUsed = this.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM renders WHERE project_id = ? AND id != ? AND deleted_at IS NULL AND (output_path = ? OR credits_path = ? OR srt_path = ?)",
    ).get(projectId, row.id, row.output_path, row.credits_path, row.srt_path) as { n: number };
    if (stillUsed.n > 0) return;
    for (const path of [row.output_path, row.credits_path, row.srt_path]) {
      if (path && existsSync(path)) rmSync(path, { force: false });
    }
  }

  private nextVersionNumber(projectId: string): number {
    const row = this.sqlite.prepare(
      "SELECT COALESCE(MAX(version), 0) AS max_version FROM renders WHERE project_id = ?",
    ).get(projectId) as { max_version: number };
    return Number(row.max_version) + 1;
  }

  private currentReviewThreadId(projectId: string): string | null {
    const row = this.sqlite.prepare(
      "SELECT id FROM review_threads WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(projectId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private currentMetadataSnapshot(projectId: string): VideoMetadataDraft | null {
    const row = this.sqlite.prepare(
      "SELECT draft, edited FROM video_metadata WHERE project_id = ?",
    ).get(projectId) as { draft: string; edited: string | null } | undefined;
    if (!row) return null;
    try {
      const edited = row.edited ? VideoMetadataDraftSchema.safeParse(JSON.parse(row.edited)) : null;
      if (edited?.success) return edited.data;
      const draft = VideoMetadataDraftSchema.safeParse(JSON.parse(row.draft));
      return draft.success ? draft.data : null;
    } catch {
      return null;
    }
  }

  metadataTextForExport(projectId: string, renderId: string, projectTitle: string): string {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    let draft: VideoMetadataDraft | null = null;
    if (row.metadata_snapshot) {
      const parsed = VideoMetadataDraftSchema.safeParse(
        typeof row.metadata_snapshot === "string" ? JSON.parse(row.metadata_snapshot) : row.metadata_snapshot,
      );
      if (parsed.success) draft = parsed.data;
    }
    if (!draft) draft = this.currentMetadataSnapshot(projectId);
    if (!draft) {
      draft = {
        titles: [projectTitle],
        description: "",
        tags: [],
        hashtags: [],
        thumbnailText: [],
      };
    }
    const creditsText = row.credits_path && existsSync(row.credits_path)
      ? readFileSync(row.credits_path, "utf8")
      : "";
    return buildMetadataText({
      titles: draft.titles,
      description: draft.description,
      tags: draft.tags,
      hashtags: draft.hashtags,
      creditsText,
    });
  }

  exportPaths(projectId: string, renderId: string): {
    video: string;
    credits: string | null;
    subtitles: string | null;
    report: RenderReport;
    version: number;
  } {
    const row = this.rowById(projectId, renderId);
    if (!row || row.deleted_at) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    if (!existsSync(row.output_path)) throw new AppError(404, "RENDER_FILE_NOT_FOUND", "Tệp render không còn.");
    this.touchRead(row.id);
    const report = RenderReportSchema.parse(JSON.parse(row.report));
    return {
      video: row.output_path,
      credits: row.credits_path && existsSync(row.credits_path) ? row.credits_path : null,
      subtitles: row.srt_path && existsSync(row.srt_path) ? row.srt_path : null,
      report,
      version: row.version,
    };
  }

  private applyRetention(projectId: string): void {
    const keep = getRenderSettings(this.sqlite).keepVersions;
    const rows = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND deleted_at IS NULL AND status = 'DONE' ORDER BY created_at DESC, rowid DESC",
    ).all(projectId) as RenderRow[];
    if (rows.length <= keep) return;
    const newestId = rows[0]?.id;
    const removable = rows.slice(keep).filter((row) => !row.pinned && row.id !== newestId && !this.wasRecentlyRead(row.id));
    for (const row of removable) {
      try {
        this.removeVersionFiles(projectId, row);
        this.sqlite.prepare("UPDATE renders SET deleted_at = ? WHERE id = ?").run(this.now().toISOString(), row.id);
      } catch (error) {
        if (isBusyError(error)) continue;
        throw error;
      }
    }
  }

  async render(project: Project, signal: AbortSignal, onProgress: RenderProgress = () => {}): Promise<{ render: Render; reused: boolean }> {
    this.ensureBackfill();
    const { timeline, inputHash: timelineHash } = this.timelines.get(project.id);
    if (!timeline || !timelineHash) {
      throw new StageError("Chưa có timeline — chạy bước Timeline trước.", "RENDER_NO_TIMELINE", false);
    }
    const started = Date.now();
    const resolvePath = this.resolver(project.id);
    const renderDir = this.renderDir(project.id);
    const clipsDir = join(renderDir, "clips");
    mkdirSync(clipsDir, { recursive: true });

    for (const scene of timeline.scenes) {
      if (scene.voice && !existsSync(resolvePath(scene.voice.path))) {
        throw new StageError(`Tệp giọng đọc của cảnh ${scene.order + 1} không còn — chạy lại bước Giọng đọc.`, "RENDER_VOICE_MISSING", false);
      }
    }
    if (timeline.music && !existsSync(resolvePath(timeline.music.path))) {
      throw new StageError("Tệp nhạc nền không còn — chọn lại nhạc ở tab Nhạc.", "RENDER_MUSIC_MISSING", false);
    }
    let assText: string | null = null;
    if (timeline.subtitles) {
      if (!existsSync(timeline.subtitles.assPath)) {
        throw new StageError("Tệp phụ đề không còn — chạy lại bước Timeline.", "RENDER_SUBTITLE_MISSING", false);
      }
      assText = readFileSync(timeline.subtitles.assPath, "utf8");
    }

    const clipHashes = timeline.scenes.map((scene) => this.clipHash(scene, timeline, resolvePath));
    const inputHash = sha({ v: RENDER_FORMAT_VERSION, timelineHash, ass: assText ? sha(assText) : null, clipHashes });

    const reusable = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL AND input_hash = ? ORDER BY created_at DESC, rowid DESC",
    ).all(project.id, inputHash) as RenderRow[];
    for (const candidate of reusable) {
      if (!existsSync(candidate.output_path)) continue;
      const render = this.toRender(candidate);
      if (render) {
        onProgress(100, "Dùng lại bản render trước");
        return { render, reused: true };
      }
    }

    const renderId = randomUUID();
    const versionFolder = this.versionDir(project.id, renderId);
    const thumbsDir = join(versionFolder, "thumbs");
    mkdirSync(thumbsDir, { recursive: true });

    // 1. Scene clips (0–60 %), cached by content hash.
    const clipPaths: string[] = [];
    let clipsReused = 0;
    let clipsRendered = 0;
    for (const [index, scene] of timeline.scenes.entries()) {
      const clipPath = join(clipsDir, `${clipHashes[index]}.mp4`);
      clipPaths.push(clipPath);
      onProgress(Math.round((index / timeline.scenes.length) * 60), `Dựng cảnh ${index + 1}/${timeline.scenes.length}`);
      if (existsSync(clipPath)) {
        clipsReused += 1;
        continue;
      }
      const plan = buildSceneClipPlan(scene, timeline.target, resolvePath);
      const filterPath = join(clipsDir, `${clipHashes[index]}.filter.txt`);
      const partPath = join(clipsDir, `${clipHashes[index]}.part.mp4`);
      writeFileSync(filterPath, plan.filter);
      try {
        await this.tools.ffmpeg([
          ...BASE_ARGS,
          ...plan.inputArgs,
          "-filter_complex_script", filterPath,
          "-map", "[out]",
          "-frames:v", String(plan.frames),
          "-r", String(timeline.target.fps),
          ...CLIP_OUTPUT_ARGS,
          partPath,
        ], { cwd: clipsDir, signal });
        renameSync(partPath, clipPath);
        clipsRendered += 1;
      } catch (error) {
        rmSync(partPath, { force: true });
        if (isAbort(error) || signal.aborted) throw error;
        throw new StageError(`FFmpeg lỗi khi dựng cảnh ${scene.order + 1}: ${(error as Error).message}`, "RENDER_CLIP_FAILED", false);
      } finally {
        rmSync(filterPath, { force: true });
      }
    }

    // 2. Final pass (60–95 %): concat, subtitles, voice + music mix, loudnorm.
    const concatPath = join(renderDir, "clips.txt");
    writeFileSync(concatPath, concatListText(clipPaths));
    const assFileName = assText !== null ? "subtitles.ass" : null;
    if (assFileName) writeFileSync(join(renderDir, assFileName), assText!);
    const plan = buildFinalPlan({
      totalDurationSec: timeline.totalDurationSec,
      scenes: timeline.scenes,
      music: timeline.music,
      concatListPath: concatPath,
      resolvePath,
      assFileName,
    });
    const finalFilter = "final.filter.txt";
    writeFileSync(join(renderDir, finalFilter), plan.filter);
    const relativePart = join("versions", renderId, "output.part.mp4");
    const partPath = join(versionFolder, "output.part.mp4");
    const outputPath = join(versionFolder, "output.mp4");
    onProgress(60, "Ghép video, phụ đề và âm thanh");
    try {
      await this.tools.ffmpeg([
        ...BASE_ARGS,
        "-progress", "pipe:1",
        "-nostats",
        ...plan.inputArgs,
        "-filter_complex_script", finalFilter,
        "-map", plan.videoMap,
        "-map", "[aout]",
        ...(plan.reencodeVideo
          ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(timeline.target.fps)]
          : ["-c:v", "copy"]),
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-t", String(timeline.totalDurationSec),
        "-movflags", "+faststart",
        relativePart,
      ], {
        cwd: renderDir,
        signal,
        onStdout: (chunk) => {
          const seconds = parseProgressSeconds(chunk);
          if (seconds === null || timeline.totalDurationSec <= 0) return;
          const pct = 60 + Math.min(1, seconds / timeline.totalDurationSec) * 35;
          onProgress(Math.round(pct), "Ghép video, phụ đề và âm thanh");
        },
      });
      renameSync(partPath, outputPath);
    } catch (error) {
      rmSync(partPath, { force: true });
      if (isAbort(error) || signal.aborted) {
        rmSync(versionFolder, { recursive: true, force: true });
        throw error;
      }
      rmSync(versionFolder, { recursive: true, force: true });
      throw new StageError(`FFmpeg lỗi khi ghép video: ${(error as Error).message}`, "RENDER_FINAL_FAILED", false);
    } finally {
      rmSync(join(renderDir, finalFilter), { force: true });
    }

    // 3. Sidecars.
    const creditsPath = join(versionFolder, "credits.txt");
    writeFileSync(creditsPath, this.creditsText(project, timeline));
    let srtPath: string | null = null;
    if (timeline.subtitles && existsSync(timeline.subtitles.srtPath)) {
      srtPath = join(versionFolder, "subtitles.srt");
      copyFileSync(timeline.subtitles.srtPath, srtPath);
    }

    // 4. Checks (95–100 %). Issues are reported, never fatal.
    onProgress(95, "Kiểm tra video");
    const report = await this.check(timeline, outputPath, thumbsDir, signal, project);
    const elapsedSec = Math.round((Date.now() - started) / 100) / 10;
    const fullReport: RenderReport = { ...report, clipsReused, clipsRendered, elapsedSec };

    const metadataSnapshot = this.currentMetadataSnapshot(project.id);
    const version = this.nextVersionNumber(project.id);
    const row: RenderRow = {
      id: renderId,
      project_id: project.id,
      input_hash: inputHash,
      status: "DONE",
      output_path: outputPath,
      credits_path: creditsPath,
      srt_path: srtPath,
      duration_sec: fullReport.durationSec,
      size_bytes: statSync(outputPath).size,
      width: fullReport.width,
      height: fullReport.height,
      report: JSON.stringify(fullReport),
      created_at: this.now().toISOString(),
      version,
      note: null,
      pinned: 0,
      deleted_at: null,
      review_thread_id: this.currentReviewThreadId(project.id),
      metadata_snapshot: metadataSnapshot ? JSON.stringify(metadataSnapshot) : null,
    };
    this.sqlite.prepare(`
      INSERT INTO renders (id, project_id, input_hash, status, output_path, credits_path, srt_path,
        duration_sec, size_bytes, width, height, report, created_at,
        version, note, pinned, deleted_at, review_thread_id, metadata_snapshot)
      VALUES (@id, @project_id, @input_hash, @status, @output_path, @credits_path, @srt_path,
        @duration_sec, @size_bytes, @width, @height, @report, @created_at,
        @version, @note, @pinned, @deleted_at, @review_thread_id, @metadata_snapshot)
    `).run(row);

    try {
      this.applyRetention(project.id);
    } catch (error) {
      if (!isBusyError(error)) throw error;
    }

    onProgress(100, "Render xong");
    return { render: this.toRender(row)!, reused: false };
  }

  private async check(
    timeline: Timeline,
    outputPath: string,
    thumbsDir: string,
    signal: AbortSignal,
    project?: Project,
  ): Promise<Omit<RenderReport, "clipsReused" | "clipsRendered" | "elapsedSec">> {
    const issues: RenderIssue[] = [];
    const probe = await this.tools.probe(outputPath, signal);
    const expected = timeline.totalDurationSec;
    if (!probe.hasVideo) issues.push({ code: "NO_VIDEO", severity: "ERROR", sceneId: null, message: "Video không có luồng hình." });
    if (!probe.hasAudio) issues.push({ code: "NO_AUDIO", severity: "ERROR", sceneId: null, message: "Video không có luồng âm thanh." });
    if (Math.abs(probe.durationSec - expected) > DURATION_TOLERANCE_SEC) {
      issues.push({
        code: "DURATION_MISMATCH",
        severity: "ERROR",
        sceneId: null,
        message: `Thời lượng ${probe.durationSec.toFixed(2)}s, timeline ${expected.toFixed(2)}s.`,
      });
    }
    if (probe.hasVideo && (probe.width !== timeline.target.width || probe.height !== timeline.target.height)) {
      issues.push({
        code: "SIZE_MISMATCH",
        severity: "ERROR",
        sceneId: null,
        message: `Kích thước ${probe.width}×${probe.height}, cần ${timeline.target.width}×${timeline.target.height}.`,
      });
    }

    if (probe.hasVideo) {
      try {
        const { stderr } = await this.tools.ffmpeg([
          "-hide_banner", "-nostdin", "-loglevel", "info", "-i", outputPath,
          "-vf", "blackdetect=d=1:pix_th=0.10", "-an", "-f", "null", "-",
        ], { signal });
        for (const black of parseBlackdetect(stderr)) {
          const scene = timeline.scenes.find((item) => black.startSec < item.endSec && black.endSec > item.startSec) ?? null;
          issues.push({
            code: "BLACK_FRAMES",
            severity: "WARN",
            sceneId: scene?.sceneId ?? null,
            message: `Khung đen ${black.startSec.toFixed(1)}s–${black.endSec.toFixed(1)}s${scene ? ` (cảnh ${scene.order + 1})` : ""}.`,
          });
        }
      } catch (error) {
        if (isAbort(error) || signal.aborted) throw error;
      }
    }

    const thumbnails: string[] = [];
    if (probe.hasVideo) {
      for (const scene of timeline.scenes) {
        const at = Math.max(0, (scene.startSec + scene.endSec) / 2);
        const file = join(thumbsDir, `${scene.sceneId}.jpg`);
        try {
          await this.tools.ffmpeg([
            ...BASE_ARGS, "-ss", at.toFixed(3), "-i", outputPath, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", file,
          ], { signal });
          thumbnails.push(scene.sceneId);
        } catch (error) {
          if (isAbort(error) || signal.aborted) throw error;
          issues.push({ code: "THUMBNAIL_FAILED", severity: "WARN", sceneId: scene.sceneId, message: `Không lấy được ảnh xem trước cảnh ${scene.order + 1}.` });
        }
      }
    }

    if (project && resolveBudget(project).renderVerify && this.llmProviders && thumbnails.length) {
      await this.runRenderVision(project, timeline, thumbsDir, thumbnails, issues, signal);
    }

    if (project?.mode === "AUTO" && this.autoReport) {
      this.autoReport.clearStage(project.id, "RENDER");
      for (const issue of issues) {
        if (issue.code !== "FRAME_MISMATCH" && issue.code !== "SUBTITLE_ILLEGIBLE") continue;
        this.autoReport.add(project.id, {
          stage: "RENDER",
          sceneId: issue.sceneId,
          code: "RENDER_VISION_ISSUE",
          severity: "WARN",
          message: issue.message,
          data: { code: issue.code },
        });
      }
    }

    return {
      ok: !issues.some((issue) => issue.severity === "ERROR"),
      expectedDurationSec: expected,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      issues,
      thumbnails,
    };
  }

  private async runRenderVision(
    project: Project,
    timeline: Timeline,
    thumbsDir: string,
    thumbnails: string[],
    issues: RenderIssue[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.llmProviders) return;
    try {
      const route = this.llmProviders.resolveTask("renderVision", project, getAppLlmSettings(this.sqlite));
      const maxImages = route.provider.capabilities?.maxImagesPerCall ?? 5;
      const frames = thumbnails.map((sceneId) => {
        const scene = timeline.scenes.find((item) => item.sceneId === sceneId);
        return {
          sceneId,
          path: join(thumbsDir, `${sceneId}.jpg`),
          order: scene?.order ?? 0,
        };
      }).filter((frame) => existsSync(frame.path));
      for (let offset = 0; offset < frames.length; offset += maxImages) {
        const batch = frames.slice(offset, offset + maxImages);
        const generated = await generateRoutedStructured({
          registry: this.llmProviders,
          route,
          task: "renderVision",
          system: "Check each rendered mid-frame thumbnail. Return JSON frames[{sceneId, matchesSelection, subtitleLegible, subjectCropOk, notes?}].",
          prompt: JSON.stringify({
            frames: batch.map((frame) => ({ sceneId: frame.sceneId, order: frame.order })),
          }),
          schema: RenderVisionBatchSchema,
          schemaName: "RenderVision",
          schemaVersion: "1",
          maxOutputTokens: 1_500,
          repairAttempts: 0,
          signal,
          cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
          images: batch.map((frame) => ({ path: frame.path, label: frame.sceneId })),
          visionCacheDir: join(this.dir(project.id), "vision-cache"),
        });
        for (const frame of generated.value.frames) {
          if (!frame.matchesSelection || !frame.subjectCropOk) {
            issues.push({
              code: "FRAME_MISMATCH",
              severity: "ERROR",
              sceneId: frame.sceneId,
              message: frame.notes || "Frame giữa scene không khớp ảnh đã chọn hoặc bị cắt lệch.",
            });
          }
          if (!frame.subtitleLegible) {
            issues.push({
              code: "SUBTITLE_ILLEGIBLE",
              severity: "ERROR",
              sceneId: frame.sceneId,
              message: "Phụ đề khó đọc hoặc che chủ thể.",
            });
          }
        }
      }
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw error;
      const message = error instanceof LlmError ? error.message : error instanceof Error ? error.message : String(error);
      issues.push({
        code: "RENDER_VISION_FAILED",
        severity: "WARN",
        sceneId: null,
        message: `Kiểm tra vision sau render thất bại: ${message}`,
      });
    }
  }

  /** Credits from the DB metadata of every visual and the music used in the timeline. */
  creditsText(project: Project, timeline: Timeline): string {
    const visualQuery = this.sqlite.prepare("SELECT title, source_url, license FROM visual_candidates WHERE id = ?");
    const scenes = timeline.scenes.map((scene) => ({
      order: scene.order,
      label: scene.label,
      visuals: scene.visuals.filter((visual) => visual.kind === "IMAGE" && visual.candidateId).map((visual): CreditsAsset => {
        const row = visualQuery.get(visual.candidateId) as { title: string; source_url: string; license: string } | undefined;
        const license = parseLicense(row?.license ?? null);
        return {
          title: row?.title ?? visual.candidateId ?? "",
          author: license.author ?? null,
          licenseName: license.name ?? null,
          licenseUrl: license.url ?? null,
          sourceUrl: row?.source_url || null,
          attributionText: license.attributionText ?? null,
        };
      }),
    }));
    let music: (CreditsAsset & { artist?: string | null }) | null = null;
    if (timeline.music) {
      const row = this.sqlite.prepare("SELECT title, artist, source_url, license FROM music_candidates WHERE id = ?")
        .get(timeline.music.candidateId) as { title: string; artist: string | null; source_url: string | null; license: string } | undefined;
      const license = parseLicense(row?.license ?? null);
      music = {
        title: row?.title ?? timeline.music.title,
        artist: row?.artist ?? null,
        author: license.author ?? null,
        licenseName: license.name ?? null,
        licenseUrl: license.url ?? null,
        sourceUrl: row?.source_url ?? null,
        attributionText: license.attributionText ?? null,
      };
    }
    return buildCreditsText({ videoTitle: project.title, scenes, music, licenseSummary: timeline.licenseSummary });
  }
}
