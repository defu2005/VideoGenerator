import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { basename, join } from "node:path";
import type Database from "better-sqlite3";
import {
  COMPOSE_RENDER_VERSION,
  concatListText,
  escapeDrawtextPath,
  resolveBudget,
  isGraphicKind,
  PROTECTED_PROJECT_ID,
  type AspectRatio,
  type Project,
  type RenderTarget,
  type Shot,
  type Timeline,
} from "@vg/shared";
import { renderSingleShot } from "../compose/sceneClip.js";
import { runHyperframes } from "../compose/hyperframes.js";
import { shotFrameCount, type ComposeRenderContext, type ShotRenderResult } from "../compose/render/context.js";
import { prepareGraphicStyle, type VideoGraphicStyle } from "../compose/render/graphicStyle.js";
import { AppError } from "../lib/errors.js";
import { runFfmpeg } from "../media/ffmpeg.js";
import { StyleService } from "../style/service.js";
import { projectDir } from "../storage/paths.js";
import { baseShotFacts, factWarnings, lumaFlag, markNearDuplicates, type SafeAreaResult, type ShotFacts } from "./facts.js";
import { lumaAndHash, type PreviewFfmpeg } from "./media.js";
import { loadPreviewPlan, type PreviewBasis, type PreviewPlan, type PreviewScene } from "./planSource.js";
import { tileArgs, tileGrid, tileSizeFor, writeTileFilter } from "./tiling.js";
import { PreviewShotRenderer, PreviewAdapterUnavailable, previewBrowserPath, previewGraphicAsset, previewStage } from "./shotRenderer.js";

export const PREVIEW_VERSION = 3;
/** Output fps of a preview clip. */
export const PREVIEW_FPS = 15;
/** Shots render at 30 fps: the graphic renderer only accepts 24, 25, 30 and 60. */
export const PREVIEW_RENDER_FPS = 30;
export const PREVIEW_DEFAULT_LONG_SIDE = 480;
export const PREVIEW_MAX_LONG_SIDE = 1280;
export const PREVIEW_MAX_CLIP_SEC = 3;

export type PreviewFile = { id: string; name: string; mime: "image/jpeg" | "video/mp4"; bytes: number; url: string };

export type PreviewResult = {
  kind: "frame" | "contact_sheet" | "clip";
  basis: PreviewBasis;
  notes: string[];
  file: PreviewFile;
  /** True when every file came from the cache (nothing was rendered). */
  cached: boolean;
  width: number;
  height: number;
  /** One entry per shot shown. */
  facts: ShotFacts[];
  warnings: string[];
  elapsedMs: number;
  /** Extra fields per kind. */
  atSec?: number;
  sceneId?: string;
  durationSec?: number;
  tiles?: { index: number; sceneIndex: number; shotId: string; kind: string; videoSec: number }[];
};

export type PreviewGovernor = { tryAcquirePreview(id: string): boolean; releasePreview(id: string): void };

export type PreviewServiceDeps = {
  sqlite: Database.Database;
  dataDir: string;
  getProject: (id: string) => Promise<Project | undefined>;
  timeline: (projectId: string) => Timeline | null;
  governor?: PreviewGovernor;
  ffmpeg?: PreviewFfmpeg;
  /** Test hook: replaces the shot renderer. */
  renderShot?: (shot: Shot, target: RenderTarget, ctx: ComposeRenderContext) => Promise<ShotRenderResult>;
  fontFile?: () => string | null;
  /** Test hook: replaces the plan source. */
  planLoader?: (project: Project) => Promise<PreviewPlan>;
  now?: () => number;
};

const SHOT_CONCURRENCY = 3;
const SHEET_GAP = 2;
const FALLBACK_NOTE = "Đã dùng adapter dựng dự phòng (full-shot fallback).";

export function previewTarget(aspect: AspectRatio, longSide = PREVIEW_DEFAULT_LONG_SIDE): RenderTarget {
  const side = Math.max(160, Math.min(PREVIEW_MAX_LONG_SIDE, Math.round(longSide)));
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  if (aspect === "9:16") return { width: even(side * 9 / 16), height: even(side), fps: PREVIEW_RENDER_FPS };
  if (aspect === "1:1") return { width: even(side), height: even(side), fps: PREVIEW_RENDER_FPS };
  return { width: even(side), height: even(side * 9 / 16), fps: PREVIEW_RENDER_FPS };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index]!, index);
    }
  }
  const settled = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}

const hashCache = new Map<string, string>();
function fileSha(path: string): string {
  if (!path || !existsSync(path)) return path;
  const stat = statSync(path);
  const memo = `${path}|${stat.size}|${stat.mtimeMs}`;
  const known = hashCache.get(memo);
  if (known) return known;
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  const digest = hash.digest("hex");
  hashCache.set(memo, digest);
  return digest;
}


const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);

type Prepared = {
  project: Project;
  plan: PreviewPlan;
  target: RenderTarget;
  ctx: ComposeRenderContext;
  videoStyle: VideoGraphicStyle | undefined;
  dir: string;
  renderer: PreviewShotRenderer;
};

export class PreviewService {
  private readonly ffmpeg: PreviewFfmpeg;
  private readonly now: () => number;

  constructor(private readonly deps: PreviewServiceDeps) {
    this.ffmpeg = deps.ffmpeg ?? ((args) => runFfmpeg(args));
    this.now = deps.now ?? Date.now;
  }

  previewDir(projectId: string): string {
    return join(projectDir(this.deps.dataDir, projectId), "preview");
  }

  /** Absolute path of a preview file, or null when the name is not a preview file. */
  filePath(projectId: string, name: string): string | null {
    if (!/^[a-f0-9]{24}(?:-[a-z0-9]+)?\.(?:jpg|mp4)$/.test(name)) return null;
    const path = join(this.previewDir(projectId), name);
    return existsSync(path) ? path : null;
  }

  openFile(projectId: string, name: string): { stream: ReturnType<typeof createReadStream>; mime: string; bytes: number } | null {
    const path = this.filePath(projectId, name);
    if (!path) return null;
    return { stream: createReadStream(path), mime: name.endsWith(".mp4") ? "video/mp4" : "image/jpeg", bytes: statSync(path).size };
  }

  // ---------------------------------------------------------------- frame

  async frame(projectId: string, input: { atSec?: number; sceneId?: string; offsetSec?: number; longSide?: number }): Promise<PreviewResult> {
    return this.guarded(projectId, async (prep) => {
      const started = this.now();
      const located = this.locate(prep.plan, input);
      const { scene, shot } = located;
      const index = Math.max(0, Math.min(Math.round(located.shotOffsetSec * prep.target.fps), shotFrameCount(shot, prep.target.fps) - 1));
      const rel = index / prep.target.fps;
      const key = sha({ shot: this.shotKey(prep, shot), index });
      const out = join(prep.dir, `${key}.jpg`);
      let cached = existsSync(out);
      if (!cached) await this.captureFrames(prep, scene, shot, [{ atSec: rel, path: out }]);
      const facts = this.factsFor(prep, scene, [shot]);
      await this.measure(facts[0]!, out);
      if (!(await this.comparePrevious(prep, scene, shot, facts))) cached = false;
      return this.result(prep, {
        kind: "frame", file: out, mime: "image/jpeg", cached, facts, started,
        width: prep.target.width, height: prep.target.height,
        extra: { atSec: Math.round((scene.startSec + shot.startSec + rel) * 1000) / 1000, sceneId: scene.sceneId },
      });
    }, input.longSide);
  }

  // ---------------------------------------------------------- contact sheet

  async contactSheet(projectId: string, input: { sceneId?: string | "all"; longSide?: number }): Promise<PreviewResult> {
    return this.guarded(projectId, async (prep) => {
      const started = this.now();
      const scenes = !input.sceneId || input.sceneId === "all"
        ? prep.plan.scenes
        : prep.plan.scenes.filter((scene) => scene.sceneId === input.sceneId);
      if (!scenes.length) throw new AppError(404, "PREVIEW_SCENE_NOT_FOUND", "Không thấy cảnh để xem trước.");
      const entries = scenes.flatMap((scene) => scene.plan.shots.map((shot) => ({ scene, shot })));
      let allCached = true;
      const sampled = await mapLimit(entries, SHOT_CONCURRENCY, async ({ scene, shot }) => {
        const key = this.shotKey(prep, shot);
        const last = shotFrameCount(shot, prep.target.fps) - 1;
        const frames = [0, 1, 2].map((slot) => join(prep.dir, `${key}-s${slot}.jpg`));
        const missing = [0, Math.floor(last / 2), last]
          .map((index, slot) => ({ atSec: index / prep.target.fps, path: frames[slot]! }))
          .filter((sample) => !existsSync(sample.path));
        if (missing.length) {
          allCached = false;
          await this.captureFrames(prep, scene, shot, missing);
        }
        const fact = this.factsFor(prep, scene, [shot])[0]!;
        await this.measure(fact, frames[1]!);
        return { key, frames, fact };
      });
      const facts = sampled.map((item) => item.fact);
      const first = entries[0];
      if (first && !(await this.comparePrevious(prep, first.scene, first.shot, facts))) allCached = false;

      const columns = prep.plan.aspect === "9:16" ? 9 : 6;
      const key = sha({ v: PREVIEW_VERSION, shots: sampled.map((item) => item.key), columns });
      const out = join(prep.dir, `${key}.jpg`);
      const tiles = entries.flatMap(({ scene, shot }, shotIndex) => [0, 1, 2].map((slot, position) => {
        const last = shotFrameCount(shot, prep.target.fps) - 1;
        const at = scene.startSec + shot.startSec + (slot === 0 ? 0 : slot === 1 ? Math.floor(last / 2) : last) / prep.target.fps;
        return { index: shotIndex * 3 + position, sceneIndex: scene.index, shotId: shot.id, kind: shot.kind, videoSec: Math.round(at * 100) / 100 };
      }));
      if (!existsSync(out)) {
        allCached = false;
        const work = join(prep.dir, `work-${randomUUID().slice(0, 8)}`);
        mkdirSync(work, { recursive: true });
        try {
          sampled.forEach((item, shotIndex) => item.frames.forEach((frame, slot) => copyFileSync(frame, join(work, `f${String(shotIndex * 3 + slot + 1).padStart(4, "0")}.jpg`))));
          const size = tileSizeFor(tiles.length, columns, prep.target);
          const font = this.deps.fontFile?.() ?? null;
          const labels = tiles.map((tile) => `C${tile.sceneIndex + 1} ${tile.kind} ${tile.videoSec}s`);
          const filter = writeTileFilter({ count: tiles.length, columns, ...size, labels, ...(font ? { fontFile: font } : {}), workDir: work });
          const part = join(work, "sheet.jpg");
          await this.ffmpeg(tileArgs(join(work, "f%04d.jpg"), filter.scriptPath, part));
          renameSync(part, out);
        } finally {
          rmSync(work, { recursive: true, force: true });
        }
      }
      const grid = tileGrid(tiles.length, columns);
      const size = tileSizeFor(tiles.length, columns, prep.target);
      return this.result(prep, {
        kind: "contact_sheet", file: out, mime: "image/jpeg", cached: allCached, facts, started,
        width: grid.columns * size.tileWidth + (grid.columns + 1) * SHEET_GAP, height: grid.rows * size.tileHeight + (grid.rows + 1) * SHEET_GAP,
        extra: { tiles, ...(input.sceneId && input.sceneId !== "all" ? { sceneId: input.sceneId } : {}) },
      });
    }, input.longSide);
  }

  // ------------------------------------------------------------------ clip

  async clip(projectId: string, input: { sceneId: string; startSec?: number; durationSec?: number; longSide?: number }): Promise<PreviewResult> {
    return this.guarded(projectId, async (prep) => {
      const started = this.now();
      const scene = prep.plan.scenes.find((item) => item.sceneId === input.sceneId);
      if (!scene) throw new AppError(404, "PREVIEW_SCENE_NOT_FOUND", "Không thấy cảnh để xem trước.");
      const start = Math.max(0, Math.min(input.startSec ?? 0, Math.max(0, scene.durationSec - 0.2)));
      const duration = Math.max(0.2, Math.min(input.durationSec ?? PREVIEW_MAX_CLIP_SEC, PREVIEW_MAX_CLIP_SEC, scene.durationSec - start));
      const shots = scene.plan.shots.filter((shot) => shot.endSec > start && shot.startSec < start + duration);
      if (!shots.length) throw new AppError(409, "PREVIEW_NO_SHOTS", "Cảnh này chưa có cảnh quay nào.");
      const subtitles = prep.plan.subtitleAssPath;
      const voice = scene.voice && existsSync(this.resolveBase(prep, scene.voice.path)) ? scene.voice : null;
      const key = sha({
        v: PREVIEW_VERSION, shots: shots.map((shot) => this.shotKey(prep, shot)), start, duration,
        voice: voice ? { sha: fileSha(this.resolveBase(prep, voice.path)), offset: voice.offsetSec } : null,
        ass: subtitles ? fileSha(subtitles) : null, sceneStart: scene.startSec,
      });
      const out = join(prep.dir, `${key}.mp4`);
      let allCached = existsSync(out);
      if (!allCached) {
        const work = join(prep.dir, `work-${randomUUID().slice(0, 8)}`);
        mkdirSync(work, { recursive: true });
        try {
          const list = join(work, "concat.txt");
          const parts: string[] = [];
          for (const [index, shot] of shots.entries()) {
            const from = Math.max(0, Math.round((shot.startSec - start) * PREVIEW_FPS));
            const to = Math.min(Math.round(duration * PREVIEW_FPS), Math.round((shot.endSec - start) * PREVIEW_FPS));
            if (from >= to) continue;
            const offset = Math.max(0, start + from / PREVIEW_FPS - shot.startSec);
            const segmentDir = join(work, `segment-${index}`);
            mkdirSync(segmentDir);
            const partPath = join(segmentDir, "video.mp4");
            let fallback = Boolean(this.deps.renderShot);
            if (!fallback) {
              try { await prep.renderer.segment(shot, offset, (to - from) / PREVIEW_FPS, partPath, PREVIEW_FPS); }
              catch (error) { if (!(error instanceof PreviewAdapterUnavailable) || !isGraphicKind(shot.source.kind)) throw error; fallback = true; }
            }
            if (fallback) {
              if (!prep.plan.notes.includes(FALLBACK_NOTE)) prep.plan.notes.push(FALLBACK_NOTE);
              const rendered = await this.shotClip(prep, scene, shot);
              await this.ffmpeg(["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-ss", offset.toFixed(6), "-i", rendered.path,
                "-vf", `fps=${PREVIEW_FPS},tpad=stop_mode=clone:stop=${to - from}`, "-frames:v", String(to - from),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-an", partPath]);
            }
            parts.push(partPath);
          }
          if (!parts.length) throw new AppError(422, "PREVIEW_SHOT_FAILED", "Không có khung hình trong đoạn xem trước.");
          writeFileSync(list, concatListText(parts));
          const t0 = scene.startSec + start;
          const videoChain = [
            ...(subtitles ? [`setpts=PTS+${t0.toFixed(6)}/TB`, `ass='${escapeDrawtextPath(subtitles)}'`] : []),
            "setpts=PTS-STARTPTS",
            `fps=${PREVIEW_FPS}`,
          ].join(",");
          const inputs = ["-f", "concat", "-safe", "0", "-i", list];
          let audioChain: string;
          if (voice) {
            inputs.push("-i", this.resolveBase(prep, voice.path));
            const into = start - voice.offsetSec;
            audioChain = into >= 0
              ? `[1:a]atrim=start=${into.toFixed(3)}:duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=duration=${duration.toFixed(3)}[a]`
              : `[1:a]adelay=${Math.round(-into * 1000)}:all=1,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,apad,atrim=duration=${duration.toFixed(3)}[a]`;
          } else {
            inputs.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono");
            audioChain = `[1:a]atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[a]`;
          }
          const script = join(work, "clip.filter.txt");
          writeFileSync(script, `[0:v]${videoChain}[v];${audioChain}`);
          const part = join(work, "clip.mp4");
          await this.ffmpeg([
            "-y", "-hide_banner", "-nostdin", "-loglevel", "error", ...inputs,
            "-filter_complex_script", script, "-map", "[v]", "-map", "[a]",
            "-t", duration.toFixed(3), "-r", String(PREVIEW_FPS),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", part,
          ]);
          renameSync(part, out);
        } finally {
          rmSync(work, { recursive: true, force: true });
        }
      }
      const facts = this.factsFor(prep, scene, shots);
      for (const [index, shot] of shots.entries()) {
        const from = Math.max(start, shot.startSec);
        const to = Math.min(start + duration, shot.endSec);
        const middle = Math.min(Math.floor(((from + to) / 2 - shot.startSec) * prep.target.fps), shotFrameCount(shot, prep.target.fps) - 1);
        const image = join(prep.dir, `${sha({ shot: this.shotKey(prep, shot), index: middle })}.jpg`);
        if (!existsSync(image)) {
          allCached = false;
          await this.captureFrames(prep, scene, shot, [{ atSec: middle / prep.target.fps, path: image }]);
        }
        await this.measure(facts[index]!, image);
      }
      if (!(await this.comparePrevious(prep, scene, shots[0]!, facts))) allCached = false;
      return this.result(prep, {
        kind: "clip", file: out, mime: "video/mp4", cached: allCached, facts, started,
        width: prep.target.width, height: prep.target.height,
        extra: { sceneId: scene.sceneId, durationSec: Math.round(duration * 1000) / 1000, atSec: Math.round((scene.startSec + start) * 1000) / 1000 },
      });
    }, input.longSide);
  }

  // ------------------------------------------------------------- internals

  private async guarded(projectId: string, run: (prep: Prepared) => Promise<PreviewResult>, longSide?: number): Promise<PreviewResult> {
    if (projectId === PROTECTED_PROJECT_ID) {
      throw new AppError(403, "PROJECT_PROTECTED", "Dự án được bảo vệ: không dựng xem trước.");
    }
    const project = await this.deps.getProject(projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const slot = `preview-${randomUUID()}`;
    if (this.deps.governor && !this.deps.governor.tryAcquirePreview(slot)) {
      throw new AppError(429, "PREVIEW_BUSY", "Máy đang bận dựng. Thử lại xem trước sau vài giây.", { retryAfterSec: 5 });
    }
    try {
      const stopPrepare = previewStage("service-prepare");
      const prep = await this.prepare(project, longSide);
      stopPrepare();
      const stopOp = previewStage("operation-total");
      try { return await run(prep); } finally { await prep.renderer.close(); stopOp(); }
    } finally {
      this.deps.governor?.releasePreview(slot);
    }
  }

  private async prepare(project: Project, longSide?: number): Promise<Prepared> {
    const plan = this.deps.planLoader
      ? await this.deps.planLoader(project)
      : await loadPreviewPlan({ sqlite: this.deps.sqlite, dataDir: this.deps.dataDir, timeline: this.deps.timeline }, project);
    if (!plan.scenes.length) throw new AppError(409, "PREVIEW_NO_SCENES", "Dự án chưa có cảnh nào để xem trước.");
    const target = previewTarget(plan.aspect, longSide);
    const dir = this.previewDir(project.id);
    mkdirSync(dir, { recursive: true });
    const base = projectDir(this.deps.dataDir, project.id);
    const resolvePath = (path: string) => plan.cropByPath.get(path) ?? (path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path : join(base, path));
    const recipeId = project.settings.format || project.settings.treatment?.formatId || "explainer";
    const brandColor = project.settings.motionGraphics?.brandColor;
    const accentColor = project.settings.motionGraphics?.accentColor;
    const shots = plan.scenes.flatMap((scene) => scene.plan.shots);
    const videoStyle = prepareGraphicStyle({
      projectId: project.id, profileId: project.profileId, recipeId,
      ...(brandColor ? { brandColor } : {}), ...(accentColor ? { accentColor } : {}),
      width: target.width, height: target.height, shots,
      styles: new StyleService(this.deps.sqlite),
    });
    const features = resolveBudget(project.settings.budget ?? { mode: "BALANCED" });
    const ctx: ComposeRenderContext = {
      dataDir: this.deps.dataDir,
      outDir: dir,
      resolvePath,
      projectId: project.id,
      profileId: project.profileId,
      recipeId,
      ...(brandColor ? { brandColor } : {}),
      ...(accentColor ? { accentColor } : {}),
      ...(project.settings.language ? { language: project.settings.language } : {}),
      composeGraphics: features.composeGraphics,
      graphicGrain: features.graphicGrain,
      ffmpeg: this.ffmpeg,
      videoStyle,
    };
    return { project, plan, target, ctx, videoStyle, dir, renderer: new PreviewShotRenderer(target, ctx, this.ffmpeg) };
  }

  private resolveBase(prep: Prepared, path: string): string {
    return prep.ctx.resolvePath(path);
  }

  private locate(plan: PreviewPlan, input: { atSec?: number; sceneId?: string; offsetSec?: number }): { scene: PreviewScene; shot: Shot; shotOffsetSec: number } {
    let scene: PreviewScene | undefined;
    let within = 0;
    if (input.sceneId) {
      scene = plan.scenes.find((item) => item.sceneId === input.sceneId);
      within = Math.max(0, input.offsetSec ?? 0);
    } else if (typeof input.atSec === "number") {
      const at = Math.max(0, input.atSec);
      scene = plan.scenes.find((item) => at >= item.startSec && at < item.startSec + item.durationSec) ?? plan.scenes[plan.scenes.length - 1];
      within = scene ? Math.max(0, at - scene.startSec) : 0;
    } else {
      throw new AppError(400, "PREVIEW_BAD_INPUT", "Cần atSec, hoặc sceneId (kèm offsetSec).");
    }
    if (!scene) throw new AppError(404, "PREVIEW_SCENE_NOT_FOUND", "Không thấy cảnh để xem trước.");
    within = Math.min(within, scene.durationSec);
    const shot = scene.plan.shots.find((item) => within >= item.startSec && within < item.endSec) ?? scene.plan.shots[scene.plan.shots.length - 1];
    if (!shot) throw new AppError(409, "PREVIEW_NO_SHOTS", "Cảnh này chưa có cảnh quay nào.");
    return { scene, shot, shotOffsetSec: within - shot.startSec };
  }

  private shotKey(prep: Prepared, shot: Shot): string {
    const source = shot.source;
    const asset = source.kind === "footage" || source.kind === "still" ? (source.path ? prep.ctx.resolvePath(source.path) : "") : "";
    const timelineImages = source.kind === "timeline"
      ? source.events.map((event) => {
        try { return event.imagePath ? fileSha(previewGraphicAsset(prep.ctx, event.imagePath)) : null; } catch { return null; }
      })
      : null;
    return sha({
      v: PREVIEW_VERSION, render: COMPOSE_RENDER_VERSION, shot, asset: fileSha(asset), timelineImages,
      w: prep.target.width, h: prep.target.height, fps: prep.target.fps,
      style: prep.videoStyle?.fingerprint ?? null, axes: prep.videoStyle?.byShot[shot.id]?.axes ?? null,
      mode: prep.ctx.composeGraphics, grain: prep.ctx.graphicGrain,
      brand: prep.ctx.brandColor ?? null, accent: prep.ctx.accentColor ?? null, language: prep.ctx.language ?? null,
    });
  }

  private async captureFrames(prep: Prepared, scene: PreviewScene, shot: Shot, frames: { atSec: number; path: string }[]): Promise<void> {
    const work = join(prep.dir, `work-${randomUUID()}`);
    mkdirSync(work);
    try {
      const scratch = frames.map((frame, index) => ({ ...frame, path: join(work, `${index}.jpg`) }));
      let fallback = Boolean(this.deps.renderShot);
      let geometry: (SafeAreaResult | null)[] = [];
      if (!fallback) {
        const stopFrames = previewStage("renderer-frames");
        try { geometry = await prep.renderer.frames(shot, scratch); stopFrames(); }
        catch (error) { if (!(error instanceof PreviewAdapterUnavailable) || !isGraphicKind(shot.source.kind)) throw error; fallback = true; }
      }
      if (fallback) {
        if (!prep.plan.notes.includes(FALLBACK_NOTE)) prep.plan.notes.push(FALLBACK_NOTE);
        const rendered = await this.shotClip(prep, scene, shot);
        const extractions = scratch.map((frame) => this.ffmpeg(["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-ss", frame.atSec.toFixed(6), "-i", rendered.path, "-frames:v", "1", "-q:v", "3", frame.path]));
        const settled = await Promise.allSettled(extractions);
        const failed = settled.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }
      scratch.forEach((frame, index) => {
        const out = frames[index]!.path;
        if (geometry[index]) {
          const metadata = `${frame.path}.json`;
          writeFileSync(metadata, JSON.stringify(geometry[index]));
          renameSync(metadata, `${out}.json`);
        }
        renameSync(frame.path, out);
      });
    } finally { rmSync(work, { recursive: true, force: true }); }
  }

  private async measure(fact: ShotFacts, image: string): Promise<void> {
    const metadata = `${image}.json`;
    if (existsSync(metadata)) {
      try {
        const area = JSON.parse(readFileSync(metadata, "utf8")) as SafeAreaResult;
        if (area.method === "dom") fact.safeArea = area;
      } catch { /* A corrupt sidecar leaves the estimated geometry available. */ }
    }
    const stopMeasure = previewStage("measure-luma-hash");
    const measured = await lumaAndHash(image);
    stopMeasure();
    if (measured) Object.assign(fact, measured, { lumaFlag: lumaFlag(measured.luma) });
  }

  private async comparePrevious(prep: Prepared, scene: PreviewScene, shot: Shot, facts: ShotFacts[]): Promise<boolean> {
    const timeline = prep.plan.scenes.flatMap((item) => item.plan.shots.map((candidate) => ({ scene: item, shot: candidate })));
    const previous = timeline[timeline.findIndex((item) => item.scene === scene && item.shot === shot) - 1];
    if (!previous) { markNearDuplicates(facts); return true; }
    const key = this.shotKey(prep, previous.shot);
    const image = join(prep.dir, `${key}-s1.jpg`);
    const cached = existsSync(image);
    const prior = this.factsFor(prep, previous.scene, [previous.shot])[0]!;
    try {
      if (!cached) {
        const index = Math.floor((shotFrameCount(previous.shot, prep.target.fps) - 1) / 2);
        await this.captureFrames(prep, previous.scene, previous.shot, [{ atSec: index / prep.target.fps, path: image }]);
      }
      await this.measure(prior, image);
    } catch { /* A broken neighboring asset must not hide the requested preview. */ }
    markNearDuplicates([prior, ...facts]);
    return cached;
  }

  /** Renders (or reuses) the shot at preview size. The file is `preview/<key>.mp4`. */
  private async shotClip(prep: Prepared, scene: PreviewScene, shot: Shot): Promise<{ key: string; path: string; cached: boolean }> {
    const key = this.shotKey(prep, shot);
    const path = join(prep.dir, `${key}.mp4`);
    if (existsSync(path)) return { key, path, cached: true };
    const work = join(prep.dir, `work-${randomUUID().slice(0, 8)}`);
    mkdirSync(work, { recursive: true });
    try {
      const render = this.deps.renderShot ?? renderSingleShot;
      const graphic = isGraphicKind(shot.source.kind);
      const rendered = await render(shot, prep.target, {
        ...prep.ctx, outDir: work,
        ...(graphic ? {
          resolvePath: (input: string) => previewGraphicAsset(prep.ctx, input),
          runTemplate: async (command: string, args: string[], env: NodeJS.ProcessEnv, output: string) => {
            const html = join(args[2]!, "index.html");
            const content = readFileSync(html, "utf8").replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:">`);
            writeFileSync(html, content);
            const executable = previewBrowserPath();
            await runHyperframes(command, args, { ...env, HYPERFRAMES_BROWSER_PATH: executable, PRODUCER_HEADLESS_SHELL_PATH: executable }, output);
          },
        } : {}),
      });
      if (!rendered.path || !existsSync(rendered.path)) {
        throw new AppError(422, "PREVIEW_SHOT_FAILED", rendered.warning ?? `Không dựng được cảnh quay ${shot.id} của cảnh ${scene.index + 1}.`);
      }
      renameSync(rendered.path, path);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    return { key, path, cached: false };
  }

  private factsFor(prep: Prepared, scene: PreviewScene, shots: Shot[]): ShotFacts[] {
    return shots.map((shot) => baseShotFacts({
      shot, sceneId: scene.sceneId, sceneIndex: scene.index, videoStartSec: scene.startSec + shot.startSec,
      aspect: prep.plan.aspect, frame: { width: prep.plan.aspect === "9:16" ? 1080 : 1920, height: prep.plan.aspect === "9:16" ? 1920 : prep.plan.aspect === "1:1" ? 1080 : 1080 },
    }));
  }

  private result(prep: Prepared, input: {
    kind: PreviewResult["kind"]; file: string; mime: PreviewFile["mime"]; cached: boolean; facts: ShotFacts[];
    started: number; width: number; height: number; extra?: Partial<PreviewResult>;
  }): PreviewResult {
    const name = basename(input.file);
    return {
      kind: input.kind,
      basis: prep.plan.basis,
      notes: prep.plan.notes,
      file: {
        id: name.replace(/\.(jpg|mp4)$/, ""),
        name,
        mime: input.mime,
        bytes: statSync(input.file).size,
        url: `/api/projects/${prep.project.id}/preview/files/${name}`,
      },
      cached: input.cached,
      width: input.width,
      height: input.height,
      facts: input.facts,
      warnings: [...prep.plan.notes, ...factWarnings(input.facts)],
      elapsedMs: this.now() - input.started,
      ...input.extra,
    };
  }

}
