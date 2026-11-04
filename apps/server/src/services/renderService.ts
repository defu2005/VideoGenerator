import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import {
  buildCreditsText,
  buildFinalPlan,
  buildSceneClipPlan,
  CLIP_OUTPUT_ARGS,
  concatListText,
  parseBlackdetect,
  parseProgressSeconds,
  RENDER_FORMAT_VERSION,
  RenderReportSchema,
  type CreditsAsset,
  type Project,
  type ProjectRender,
  type Render,
  type RenderIssue,
  type RenderReport,
  type Timeline,
  type TimelineScene,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { probeMedia, runFfmpeg, type FfmpegRunOptions, type MediaProbe } from "../media/ffmpeg.js";
import { StageError } from "../pipeline/stageExecutor.js";
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

export class RenderService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly timelines: Pick<TimelineService, "get">,
    private readonly tools: MediaTools = defaultMediaTools,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dir(projectId: string): string {
    return projectDir(this.config.DATA_DIR, projectId);
  }

  renderDir(projectId: string): string {
    return join(this.dir(projectId), "render");
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
    return this.sqlite.prepare("SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(projectId) as RenderRow | undefined;
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

  get(projectId: string): ProjectRender {
    const row = this.latestRow(projectId);
    if (!row || !existsSync(row.output_path)) return { render: null };
    return { render: this.toRender(row) };
  }

  /** Absolute path of a downloadable render file, or null when it does not exist. */
  file(projectId: string, kind: "video" | "credits" | "subtitles" | "thumb", sceneId?: string): string | null {
    const row = this.latestRow(projectId);
    if (!row) return null;
    let path: string | null = null;
    if (kind === "video") path = row.output_path;
    else if (kind === "credits") path = row.credits_path;
    else if (kind === "subtitles") path = row.srt_path;
    else {
      const report = this.toRender(row)?.report;
      // Only scene ids the report lists, so the id never builds an arbitrary path.
      if (!sceneId || !report?.thumbnails.includes(sceneId)) return null;
      path = join(this.renderDir(projectId), "thumbs", `${sceneId}.jpg`);
    }
    return path && existsSync(path) ? path : null;
  }

  async render(project: Project, signal: AbortSignal, onProgress: RenderProgress = () => {}): Promise<{ render: Render; reused: boolean }> {
    const { timeline, inputHash: timelineHash } = this.timelines.get(project.id);
    if (!timeline || !timelineHash) {
      throw new StageError("Chưa có timeline — chạy bước Timeline trước.", "RENDER_NO_TIMELINE", false);
    }
    const started = Date.now();
    const resolvePath = this.resolver(project.id);
    const renderDir = this.renderDir(project.id);
    const clipsDir = join(renderDir, "clips");
    const thumbsDir = join(renderDir, "thumbs");
    mkdirSync(clipsDir, { recursive: true });
    mkdirSync(thumbsDir, { recursive: true });

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

    const latest = this.latestRow(project.id);
    if (latest && latest.status === "DONE" && latest.input_hash === inputHash && existsSync(latest.output_path)) {
      const render = this.toRender(latest);
      if (render) {
        onProgress(100, "Dùng lại bản render trước");
        return { render, reused: true };
      }
    }

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
    const outputPath = join(renderDir, "output.mp4");
    const partPath = join(renderDir, "output.part.mp4");
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
        "output.part.mp4",
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
      rmSync(outputPath, { force: true });
      renameSync(partPath, outputPath);
    } catch (error) {
      rmSync(partPath, { force: true });
      if (isAbort(error) || signal.aborted) throw error;
      throw new StageError(`FFmpeg lỗi khi ghép video: ${(error as Error).message}`, "RENDER_FINAL_FAILED", false);
    } finally {
      rmSync(join(renderDir, finalFilter), { force: true });
    }

    // 3. Sidecars.
    const creditsPath = join(renderDir, "credits.txt");
    writeFileSync(creditsPath, this.creditsText(project, timeline));
    let srtPath: string | null = null;
    if (timeline.subtitles && existsSync(timeline.subtitles.srtPath)) {
      srtPath = join(renderDir, "subtitles.srt");
      copyFileSync(timeline.subtitles.srtPath, srtPath);
    }

    // 4. Checks (95–100 %). Issues are reported, never fatal.
    onProgress(95, "Kiểm tra video");
    const report = await this.check(timeline, outputPath, thumbsDir, signal);
    const elapsedSec = Math.round((Date.now() - started) / 100) / 10;
    const fullReport: RenderReport = { ...report, clipsReused, clipsRendered, elapsedSec };

    const row: RenderRow = {
      id: randomUUID(),
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
    };
    this.sqlite.prepare(`
      INSERT INTO renders (id, project_id, input_hash, status, output_path, credits_path, srt_path,
        duration_sec, size_bytes, width, height, report, created_at)
      VALUES (@id, @project_id, @input_hash, @status, @output_path, @credits_path, @srt_path,
        @duration_sec, @size_bytes, @width, @height, @report, @created_at)
    `).run(row);
    onProgress(100, "Render xong");
    return { render: this.toRender(row)!, reused: false };
  }

  private async check(
    timeline: Timeline,
    outputPath: string,
    thumbsDir: string,
    signal: AbortSignal,
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
