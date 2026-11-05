import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import {
  LANDSCAPE_THUMB,
  ThumbnailMetaSchema,
  ThumbnailPickSchema,
  ThumbnailStateSchema,
  VERTICAL_COVER,
  VideoMetadataDraftSchema,
  YOUTUBE_THUMB_MAX_BYTES,
  buildThumbnailVideoFilter,
  candidateFrameTimes,
  clampThumbnailText,
  fallbackThumbnailChoice,
  nextJpegQscale,
  parseFrameProbe,
  rankByScore,
  resolveBudget,
  sniffImageType,
  THUMBNAIL_UPLOAD_MAX_BYTES,
  type FrameMetrics,
  type Project,
  type ThumbnailMeta,
  type ThumbnailPosition,
  type ThumbnailRecomposeBody,
  type ThumbnailState,
  type Timeline,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { FfmpegRunOptions } from "../media/ffmpeg.js";
import { runFfmpeg } from "../media/ffmpeg.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { assertVisionCapable, generateRoutedStructured } from "../providers/llm/structured.js";
import { projectDir } from "../storage/paths.js";

type TimelineLookup = { get(projectId: string): { timeline: Timeline | null } };

type Tools = {
  ffmpeg: (args: string[], options?: FfmpegRunOptions) => Promise<{ stdout: string; stderr: string }>;
};

type ScoredFrame = {
  id: string;
  sceneId: string;
  timeSec: number;
  file: string;
  metrics: FrameMetrics;
  score: number;
};

type Manifest = {
  videoPath?: string;
  candidates: Array<{ id: string; sceneId: string; timeSec: number; score: number; file: string }>;
};

const FONT_CANDIDATES = [
  process.env.VG_SUBTITLE_FONT,
  "C:\\Windows\\Fonts\\arialbd.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
];

/** Same family as the ASS subtitle style (Arial), as a file drawtext can load. */
export function resolveSubtitleFontFile(): string {
  for (const path of FONT_CANDIDATES) {
    if (path && existsSync(path)) return path;
  }
  throw new AppError(
    500,
    "THUMBNAIL_FONT",
    "Không tìm thấy font Arial cho thumbnail. Đặt VG_SUBTITLE_FONT tới file .ttf dùng cho phụ đề.",
  );
}

export class ThumbnailService {
  private filterCaps: { blur: boolean; signalstats: boolean; edgedetect: boolean } | null = null;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly timelines: TimelineLookup,
    private readonly tools: Tools = { ffmpeg: runFfmpeg },
    private readonly llm?: LlmProviderRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async state(projectId: string): Promise<ThumbnailState> {
    const row = this.paths(projectId);
    const stored = this.readMeta(projectId);
    const { videoPath: _videoPath, ...meta } = stored ?? { videoPath: undefined };
    const manifest = this.readManifest(projectId);
    return ThumbnailStateSchema.parse({
      hasLandscape: Boolean(row?.thumbnail_path && existsSync(row.thumbnail_path)),
      hasCover: Boolean(row?.cover_path && existsSync(row.cover_path)),
      meta: stored ? meta : null,
      candidates: (manifest?.candidates ?? []).map((item) => ({
        id: item.id,
        sceneId: item.sceneId,
        timeSec: item.timeSec,
        score: item.score,
      })),
    });
  }

  imagePath(projectId: string, kind: "landscape" | "cover" | string): string | null {
    if (kind === "landscape" || kind === "cover") {
      const row = this.paths(projectId);
      const path = kind === "landscape" ? row?.thumbnail_path : row?.cover_path;
      return path && existsSync(path) ? path : null;
    }
    if (!/^c\d+$/.test(kind)) return null;
    const manifest = this.readManifest(projectId);
    const candidate = manifest?.candidates.find((item) => item.id === kind);
    if (!candidate) return null;
    const path = join(this.dir(projectId), "candidates", candidate.file);
    return existsSync(path) ? path : null;
  }

  /** After a successful render. Manual picks stay until the user asks to regenerate. */
  async ensureAuto(
    project: Project,
    signal: AbortSignal,
    opts: { force?: boolean; variant?: boolean } = {},
  ): Promise<ThumbnailState> {
    const current = this.readMeta(project.id);
    const ready = this.outputsExist(project.id);
    if (!opts.force && current?.source === "manual" && ready) return this.state(project.id);
    if (opts.variant && !opts.force && ready) return this.state(project.id);
    const video = this.pickVideo(project);
    if (!video) {
      if (opts.force) throw new AppError(409, "THUMBNAIL_NO_VIDEO", "Chưa có video đã render.");
      return this.state(project.id);
    }
    if (!opts.force && ready && current?.videoPath === video.path) return this.state(project.id);
    return this.generateFromVideo(project, video, signal);
  }

  /** Automation: fill a missing thumbnail, never replace a manual one. */
  async ensureBeforePublish(project: Project, signal: AbortSignal): Promise<ThumbnailState> {
    if (this.outputsExist(project.id)) return this.state(project.id);
    return this.ensureAuto(project, signal);
  }

  async regenerate(project: Project, signal: AbortSignal): Promise<ThumbnailState> {
    return this.ensureAuto(project, signal, { force: true });
  }

  async recompose(project: Project, body: ThumbnailRecomposeBody, signal: AbortSignal): Promise<ThumbnailState> {
    const manifest = this.readManifest(project.id);
    const candidate = manifest?.candidates.find((item) => item.id === body.frameId);
    const src = candidate ? join(this.dir(project.id), "candidates", candidate.file) : "";
    if (!candidate || !existsSync(src)) {
      throw new AppError(404, "THUMBNAIL_FRAME", "Không tìm thấy khung hình này.");
    }
    const text = clampThumbnailText(body.text, this.fallbackText(project));
    await this.composite(project, src, {
      text,
      position: body.position,
      subjectX: 0.5,
      subjectY: 0.5,
    }, signal);
    const previous = this.readMeta(project.id);
    this.writeMeta(project.id, {
      frameTimeSec: candidate.timeSec,
      text,
      position: body.position,
      source: "manual",
      frameId: candidate.id,
      ...(previous?.videoPath ? { videoPath: previous.videoPath } : {}),
    });
    return this.state(project.id);
  }

  async upload(project: Project, bytes: Buffer, signal: AbortSignal): Promise<ThumbnailState> {
    if (bytes.length > THUMBNAIL_UPLOAD_MAX_BYTES) {
      throw new AppError(400, "THUMBNAIL_TOO_LARGE", "Ảnh tối đa 5 MB.");
    }
    if (!sniffImageType(bytes)) {
      throw new AppError(400, "THUMBNAIL_TYPE", "Chỉ nhận PNG hoặc JPG.");
    }
    const folder = this.dir(project.id);
    mkdirSync(folder, { recursive: true });
    const src = join(folder, "upload-source");
    writeFileSync(src, bytes);
    const previous = this.readMeta(project.id);
    await this.composite(project, src, { text: "", position: "bottom" }, signal);
    this.writeMeta(project.id, {
      frameTimeSec: previous?.frameTimeSec ?? 0,
      text: previous?.text ?? "",
      position: previous?.position ?? "bottom",
      source: "manual",
      ...(previous?.videoPath ? { videoPath: previous.videoPath } : {}),
    });
    return this.state(project.id);
  }

  private async generateFromVideo(
    project: Project,
    video: { path: string; width: number; height: number },
    signal: AbortSignal,
  ): Promise<ThumbnailState> {
    const folder = this.dir(project.id);
    const candidatesDir = join(folder, "candidates");
    mkdirSync(candidatesDir, { recursive: true });
    const timeline = this.timelines.get(project.id).timeline;
    const times = timeline
      ? candidateFrameTimes(timeline.scenes)
      : [{ sceneId: "video", timeSec: 1, kind: "hook" as const }];
    const probed: Array<ScoredFrame & { metrics: FrameMetrics }> = [];
    for (const [index, sample] of times.entries()) {
      if (signal.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
      const file = `c${index}.png`;
      const path = join(candidatesDir, file);
      try {
        await this.tools.ffmpeg([
          "-y", "-hide_banner", "-nostdin",
          "-ss", sample.timeSec.toFixed(3),
          "-i", video.path,
          "-frames:v", "1",
          path,
        ], { signal });
      } catch (error) {
        if (this.isAbort(error, signal)) throw error;
        continue;
      }
      if (!existsSync(path)) continue;
      const metrics = await this.measure(path, signal);
      if (!metrics) continue;
      probed.push({
        id: `c${index}`,
        sceneId: sample.sceneId,
        timeSec: sample.timeSec,
        file,
        metrics,
        score: 0,
      });
    }
    let ranked = rankByScore(probed);
    if (!ranked.length && probed.length) {
      const brightest = [...probed].sort((a, b) => b.metrics.meanLuma - a.metrics.meanLuma)[0]!;
      ranked = [{ ...brightest, score: 0 }];
    }
    if (!ranked.length) {
      throw new AppError(409, "THUMBNAIL_NO_FRAME", "Không lấy được khung hình từ video.");
    }
    const top = ranked.slice(0, 4);
    const choice = await this.choose(project, top, signal);
    const chosen = top[Math.min(choice.frameIndex, top.length - 1)] ?? top[0]!;
    const src = join(candidatesDir, chosen.file);
    await this.composite(project, src, choice, signal);
    this.writeManifest(project.id, {
      videoPath: video.path,
      candidates: ranked.map((frame) => ({
        id: frame.id,
        sceneId: frame.sceneId,
        timeSec: frame.timeSec,
        score: frame.score,
        file: frame.file,
      })),
    });
    this.writeMeta(project.id, {
      frameTimeSec: chosen.timeSec,
      text: choice.text,
      position: choice.position,
      source: choice.source,
      frameId: chosen.id,
      videoPath: video.path,
      ...(choice.subjectX !== undefined ? { subjectX: choice.subjectX } : {}),
      ...(choice.subjectY !== undefined ? { subjectY: choice.subjectY } : {}),
    });
    return this.state(project.id);
  }

  private async choose(
    project: Project,
    frames: ScoredFrame[],
    signal: AbortSignal,
  ): Promise<{
    frameIndex: number;
    text: string;
    position: ThumbnailPosition;
    source: "ai" | "auto";
    subjectX?: number;
    subjectY?: number;
  }> {
    const fallback = fallbackThumbnailChoice({
      thumbnailText: this.thumbnailTexts(project.id),
      title: project.title,
    });
    const budgetOn = resolveBudget(project).thumbnailPick;
    if (!budgetOn || !this.llm || frames.length === 0) {
      return { frameIndex: 0, ...fallback };
    }
    try {
      const route = this.llm.resolveTask("thumbnailPick", project, getAppLlmSettings(this.sqlite));
      const visionDir = join(this.dir(project.id), "vision");
      mkdirSync(visionDir, { recursive: true });
      const images = [];
      for (const frame of frames) {
        const src = join(this.dir(project.id), "candidates", frame.file);
        const scaled = join(visionDir, `${frame.id}.jpg`);
        await this.tools.ffmpeg([
          "-y", "-hide_banner", "-nostdin",
          "-i", src,
          "-vf", "scale='min(512,iw)':-2",
          "-q:v", "3",
          scaled,
        ], { signal });
        this.seedVisionCache(scaled, join(projectDir(this.config.DATA_DIR, project.id), "vision-cache"));
        images.push({ path: scaled, label: frame.id });
      }
      assertVisionCapable(route.provider, images);
      const generated = await generateRoutedStructured({
        registry: this.llm,
        route,
        task: "thumbnailPick",
        system: [
          "Choose the best thumbnail frame.",
          "Return JSON {frameIndex, text, position, subjectX, subjectY}.",
          "text is at most 32 characters and may rewrite the overlay ideas.",
          "position is top, bottom, or center, away from faces and the subject.",
          "subjectX and subjectY are 0–1 and mark the subject so the crop keeps it.",
        ].join(" "),
        prompt: JSON.stringify({
          title: project.title,
          thumbnailText: this.thumbnailTexts(project.id),
          frames: frames.map((frame, index) => ({ index, label: frame.id, timeSec: frame.timeSec })),
        }),
        schema: ThumbnailPickSchema,
        schemaName: "ThumbnailPick",
        schemaVersion: "1",
        maxOutputTokens: 400,
        repairAttempts: 0,
        signal,
        cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
        images,
        visionCacheDir: join(projectDir(this.config.DATA_DIR, project.id), "vision-cache"),
      });
      return {
        frameIndex: Math.min(generated.value.frameIndex, frames.length - 1),
        text: clampThumbnailText(generated.value.text, fallback.text),
        position: generated.value.position,
        source: "ai",
        ...(generated.value.subjectX !== undefined ? { subjectX: generated.value.subjectX } : {}),
        ...(generated.value.subjectY !== undefined ? { subjectY: generated.value.subjectY } : {}),
      };
    } catch (error) {
      if (this.isAbort(error, signal)) throw error;
      return { frameIndex: 0, ...fallback };
    }
  }

  private async composite(
    project: Project,
    src: string,
    choice: { text: string; position: ThumbnailPosition; subjectX?: number; subjectY?: number },
    signal: AbortSignal,
  ): Promise<void> {
    const fontFile = choice.text ? resolveSubtitleFontFile() : "";
    const brandColor = this.brandColor(project);
    const folder = this.dir(project.id);
    mkdirSync(folder, { recursive: true });
    const landscape = join(folder, "landscape.jpg");
    const cover = join(folder, "cover.jpg");
    const landscapePlan = buildThumbnailVideoFilter({
      text: choice.text,
      position: choice.position,
      fontFile,
      width: LANDSCAPE_THUMB.width,
      height: LANDSCAPE_THUMB.height,
      brandColor,
      subjectX: choice.subjectX,
      subjectY: choice.subjectY,
      textFilePath: (index) => join(folder, "text", "landscape", `${index}.txt`),
    });
    const coverPlan = buildThumbnailVideoFilter({
      text: choice.text,
      position: choice.position,
      fontFile,
      width: VERTICAL_COVER.width,
      height: VERTICAL_COVER.height,
      brandColor,
      subjectX: choice.subjectX,
      subjectY: choice.subjectY,
      textFilePath: (index) => join(folder, "text", "cover", `${index}.txt`),
    });
    this.writeTextFiles(landscapePlan.textFiles);
    this.writeTextFiles(coverPlan.textFiles);
    await this.encodeJpeg({ src, dest: landscape, filter: landscapePlan.filter, limitBytes: YOUTUBE_THUMB_MAX_BYTES, signal });
    await this.encodeJpeg({ src, dest: cover, filter: coverPlan.filter, limitBytes: null, signal });
    this.sqlite.prepare(
      "UPDATE projects SET thumbnail_path = ?, cover_path = ?, updated_at = ? WHERE id = ?",
    ).run(landscape, cover, this.now().toISOString(), project.id);
  }

  private writeTextFiles(files: ReadonlyArray<{ path: string; text: string }>): void {
    for (const file of files) {
      mkdirSync(dirname(file.path), { recursive: true });
      writeFileSync(file.path, file.text, "utf8");
    }
  }

  private async encodeJpeg(input: {
    src: string;
    dest: string;
    filter: string;
    limitBytes: number | null;
    signal: AbortSignal;
  }): Promise<void> {
    let qscale = 2;
    for (let step = 0; step < 12; step += 1) {
      await this.tools.ffmpeg([
        "-y", "-hide_banner", "-nostdin",
        "-i", input.src,
        "-vf", input.filter,
        "-frames:v", "1",
        "-q:v", String(qscale),
        input.dest,
      ], { signal: input.signal });
      if (input.limitBytes === null) return;
      const bytes = existsSync(input.dest) ? statSync(input.dest).size : 0;
      const next = nextJpegQscale(qscale, bytes, input.limitBytes);
      if (next === null) return;
      qscale = next;
    }
  }

  private async measure(file: string, signal: AbortSignal): Promise<FrameMetrics | null> {
    const caps = await this.probeFilters(signal);
    const vf = caps.blur
      ? "blurdetect,signalstats,metadata=mode=print"
      : "signalstats,metadata=mode=print";
    try {
      const first = await this.tools.ffmpeg([
        "-hide_banner", "-i", file, "-vf", vf, "-f", "null", "-",
      ], { signal });
      let log = `${first.stdout}\n${first.stderr}`;
      if (!caps.blur && caps.edgedetect) {
        try {
          const edge = await this.tools.ffmpeg([
            "-hide_banner", "-i", file,
            "-vf", "edgedetect,signalstats,metadata=mode=print",
            "-f", "null", "-",
          ], { signal });
          log = `${log}\n${edge.stdout}\n${edge.stderr}`;
        } catch (error) {
          if (this.isAbort(error, signal)) throw error;
        }
      }
      return parseFrameProbe(log);
    } catch (error) {
      if (this.isAbort(error, signal)) throw error;
      return null;
    }
  }

  private async probeFilters(signal: AbortSignal): Promise<{ blur: boolean; signalstats: boolean; edgedetect: boolean }> {
    if (this.filterCaps) return this.filterCaps;
    try {
      const { stdout, stderr } = await this.tools.ffmpeg(["-hide_banner", "-filters"], { signal });
      const text = `${stdout}\n${stderr}`;
      this.filterCaps = {
        blur: /\bblurdetect\b/.test(text),
        signalstats: /\bsignalstats\b/.test(text),
        edgedetect: /\bedgedetect\b/.test(text),
      };
    } catch (error) {
      if (this.isAbort(error, signal)) throw error;
      this.filterCaps = { blur: false, signalstats: true, edgedetect: false };
    }
    return this.filterCaps;
  }

  private seedVisionCache(srcPath: string, cacheDir: string): void {
    if (!existsSync(srcPath)) return;
    mkdirSync(cacheDir, { recursive: true });
    const hash = createHash("sha256").update(readFileSync(srcPath)).digest("hex").slice(0, 16);
    const dest = join(cacheDir, `${hash}.jpg`);
    if (!existsSync(dest)) writeFileSync(dest, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }

  private brandColor(project: Project): string {
    if (!project.profileId) return "#3B82F6";
    const row = this.sqlite.prepare("SELECT color FROM profiles WHERE id = ?").get(project.profileId) as { color?: string } | undefined;
    return row?.color && /^#[0-9A-Fa-f]{6}$/.test(row.color) ? row.color : "#3B82F6";
  }

  private thumbnailTexts(projectId: string): string[] {
    const row = this.sqlite.prepare(
      "SELECT draft, edited FROM video_metadata WHERE project_id = ?",
    ).get(projectId) as { draft: unknown; edited: unknown } | undefined;
    if (!row) return [];
    const raw = row.edited ?? row.draft;
    const value = typeof raw === "string" ? safeJson(raw) : raw;
    const parsed = VideoMetadataDraftSchema.safeParse(value);
    return parsed.success ? parsed.data.thumbnailText : [];
  }

  private fallbackText(project: Project): string {
    return fallbackThumbnailChoice({
      thumbnailText: this.thumbnailTexts(project.id),
      title: project.title,
    }).text;
  }

  private pickVideo(project: Project): { path: string; width: number; height: number } | null {
    const rows = this.sqlite.prepare(
      `SELECT output_path, width, height, aspect_ratio FROM renders
       WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    ).all(project.id) as Array<{ output_path: string; width: number; height: number; aspect_ratio: string | null }>;
    const aspect = project.settings.aspectRatio ?? "16:9";
    const match = rows.find((row) => existsSync(row.output_path) && (row.aspect_ratio ?? aspect) === aspect)
      ?? rows.find((row) => existsSync(row.output_path));
    if (!match) return null;
    return { path: match.output_path, width: match.width || 1280, height: match.height || 720 };
  }

  private paths(projectId: string): { thumbnail_path: string | null; cover_path: string | null } | undefined {
    return this.sqlite.prepare(
      "SELECT thumbnail_path, cover_path FROM projects WHERE id = ?",
    ).get(projectId) as { thumbnail_path: string | null; cover_path: string | null } | undefined;
  }

  private outputsExist(projectId: string): boolean {
    const row = this.paths(projectId);
    return Boolean(row?.thumbnail_path && existsSync(row.thumbnail_path) && row.cover_path && existsSync(row.cover_path));
  }

  private readMeta(projectId: string): ThumbnailMeta | null {
    const row = this.sqlite.prepare(
      "SELECT thumbnail_meta FROM projects WHERE id = ?",
    ).get(projectId) as { thumbnail_meta: unknown } | undefined;
    if (!row?.thumbnail_meta) return null;
    const value = typeof row.thumbnail_meta === "string" ? safeJson(row.thumbnail_meta) : row.thumbnail_meta;
    const parsed = ThumbnailMetaSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }

  private writeMeta(projectId: string, meta: ThumbnailMeta): void {
    const parsed = ThumbnailMetaSchema.parse(meta);
    this.sqlite.prepare(
      "UPDATE projects SET thumbnail_meta = ?, updated_at = ? WHERE id = ?",
    ).run(JSON.stringify(parsed), this.now().toISOString(), projectId);
  }

  private readManifest(projectId: string): Manifest | null {
    const path = join(this.dir(projectId), "manifest.json");
    if (!existsSync(path)) return null;
    const parsed = safeJson(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Manifest;
  }

  private writeManifest(projectId: string, manifest: Manifest): void {
    mkdirSync(this.dir(projectId), { recursive: true });
    writeFileSync(join(this.dir(projectId), "manifest.json"), JSON.stringify(manifest));
  }

  private dir(projectId: string): string {
    return join(projectDir(this.config.DATA_DIR, projectId), "render", "thumbnails");
  }

  private isAbort(error: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) return true;
    return error instanceof Error && error.name === "AbortError";
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
