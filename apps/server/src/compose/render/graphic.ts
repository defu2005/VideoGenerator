import { copyFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { isGraphicKind, type RenderTarget, type Shot } from "@vg/shared";
import { resolveFfprobePath } from "../../media/ffmpeg.js";
import { renderComposeTemplate } from "../hyperframes.js";
import { END_HOLD_SEC, graphicVariables } from "./graphicVars.js";
import {
  encodeClip,
  shotFrameCount,
  shotOutputPath,
  type ComposeRenderContext,
  type GraphicProbe,
  type ShotRenderResult,
} from "./context.js";

const STATIC_FADE_SEC = 0.2;
/** HyperFrames 0.9.14 CLI has no jpegQuality flag. `standard` is CRF 18; capture JPEG stays the engine default (80). */
const OPAQUE_QUALITY = "standard";

let graphicActive = 0;
const graphicQueue: Array<() => void> = [];

/** 1 unless COMPOSE_GRAPHIC_CONCURRENCY is a positive integer. A hand-set value may be above 2. */
export function graphicRenderLimit(): number {
  const raw = process.env.COMPOSE_GRAPHIC_CONCURRENCY;
  if (raw == null || raw.trim() === "") return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return 1;
  return value;
}

export async function withGraphicSlot<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const limit = graphicRenderLimit();
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      graphicActive += 1;
      resolve();
    };
    const onAbort = () => {
      const index = graphicQueue.indexOf(start);
      if (index >= 0) graphicQueue.splice(index, 1);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (graphicActive < limit) start();
    else graphicQueue.push(start);
  });
  try {
    return await run();
  } finally {
    graphicActive -= 1;
    graphicQueue.shift()?.();
  }
}

/** Finished state: the end of the animation, before the hold, not the last frame. */
export function finishedSeekSec(durationSec: number, fps: number): { startSec: number; endSec: number } {
  const hold = Math.max(0, durationSec - END_HOLD_SEC);
  const frame = Math.min(Math.max(0, Math.floor(hold * fps)), Math.max(0, Math.round(durationSec * fps) - 1));
  const startSec = frame / fps;
  const endSec = Math.min(durationSec, startSec + 1 / fps);
  return { startSec, endSec: endSec > startSec ? endSec : startSec + 1 / fps };
}

export function probeMatches(probe: GraphicProbe, target: Pick<RenderTarget, "width" | "height" | "fps">, frames: number): boolean {
  return probe.width === target.width
    && probe.height === target.height
    && Math.abs(probe.fps - target.fps) < 0.02
    && probe.frames === frames
    && probe.pixFmt === "yuv420p"
    && probe.codec === "h264";
}

export function probeGraphicStream(file: string): Promise<GraphicProbe> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfprobePath(), [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,avg_frame_rate,nb_frames,duration,pix_fmt,codec_name",
      "-of", "json",
      file,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe thoát ${code}`));
        return;
      }
      try {
        const stream = (JSON.parse(stdout) as { streams?: Record<string, string>[] }).streams?.[0];
        if (!stream) throw new Error("không có luồng hình");
        const fps = parseRate(stream.avg_frame_rate ?? "");
        const counted = Number(stream.nb_frames);
        const duration = Number(stream.duration);
        const frames = Number.isFinite(counted) && counted > 0 ? counted : Math.round(duration * fps);
        resolve({
          width: Number(stream.width),
          height: Number(stream.height),
          fps,
          frames,
          pixFmt: stream.pix_fmt ?? "",
          codec: stream.codec_name ?? "",
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("ffprobe không đọc được"));
      }
    });
  });
}

export async function renderShot(
  shot: Shot,
  target: RenderTarget,
  ctx: ComposeRenderContext,
): Promise<ShotRenderResult> {
  return withGraphicSlot(() => renderGraphicShot(shot, target, ctx), ctx.signal);
}

async function renderGraphicShot(
  shot: Shot,
  target: RenderTarget,
  ctx: ComposeRenderContext,
): Promise<ShotRenderResult> {
  if (!isGraphicKind(shot.source.kind)) throw new Error("render đồ hoạ cần nguồn đồ hoạ");
  const frames = shotFrameCount(shot, target.fps);
  const durationSec = frames / target.fps;
  const mode = ctx.composeGraphics === "static" ? "static" : "animated";
  const seek = mode === "static" ? finishedSeekSec(durationSec, target.fps) : null;
  const rendered = await renderComposeTemplate({
    dataDir: ctx.dataDir,
    templateId: shot.source.kind,
    variables: graphicVariables(shot, durationSec, target, {
      brandColor: ctx.brandColor,
      accentColor: ctx.accentColor,
      projectId: ctx.projectId,
      profileId: ctx.profileId,
      recipeId: ctx.recipeId,
      language: ctx.language,
      grain: ctx.graphicGrain === false ? false : ctx.graphicGrain === true ? true : undefined,
      stylePack: ctx.stylePack,
      videoStyle: ctx.videoStyle,
    }),
    width: target.width,
    height: target.height,
    fps: target.fps,
    durationSec,
    format: "mp4",
    quality: OPAQUE_QUALITY,
    ...(seek ? { startSec: seek.startSec, endSec: seek.endSec } : {}),
    signal: ctx.signal,
    run: ctx.runTemplate,
  });
  if (!rendered.outputPath) return { path: "", frames, warning: rendered.warning ?? "Không dựng được đồ hoạ." };
  const path = shotOutputPath(ctx, shot);
  if (mode === "static") {
    await encodeClip(staticMotionArgs(rendered.outputPath, target, frames), path, ctx.ffmpeg);
    return { path, frames, warning: rendered.warning, graphicPath: "static" };
  }
  const reusable = await reusableClip(rendered.outputPath, target, frames, ctx);
  if (reusable) {
    copyFileSync(rendered.outputPath, path);
    return { path, frames, warning: rendered.warning, graphicPath: "animated" };
  }
  await encodeClip([
    "-i", rendered.outputPath,
    "-vf", `scale=${target.width}:${target.height},fps=${target.fps},setsar=1,tpad=stop_mode=clone:stop=30`,
    "-frames:v", String(frames),
    "-r", String(target.fps),
  ], path, ctx.ffmpeg);
  return { path, frames, warning: rendered.warning, graphicPath: "reencoded" };
}

function staticMotionArgs(input: string, target: RenderTarget, frames: number): string[] {
  // zoompan at 1080×1920 was as slow as the animation. scale/crop is the same slow zoom and stays frame-exact.
  const zoom = `scale=w='trunc(iw*(1+0.08*n/${frames})/2)*2':h='trunc(ih*(1+0.08*n/${frames})/2)*2':eval=frame`;
  const fade = `fade=t=in:st=0:d=${STATIC_FADE_SEC}`;
  return [
    "-stream_loop", "-1",
    "-i", input,
    "-vf", `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,crop=${target.width}:${target.height},fps=${target.fps},${zoom},crop=${target.width}:${target.height},${fade}`,
    "-frames:v", String(frames),
    "-r", String(target.fps),
  ];
}

async function reusableClip(file: string, target: RenderTarget, frames: number, ctx: ComposeRenderContext): Promise<boolean> {
  try {
    const probe = await (ctx.probeGraphic ?? probeGraphicStream)(file);
    return probeMatches(probe, target, frames);
  } catch {
    return false;
  }
}

function parseRate(value: string): number {
  const [num, den] = value.split("/");
  const n = Number(num);
  const d = Number(den ?? 1);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}
