import { CLIP_OUTPUT_ARGS, type RenderTarget, type Shot } from "@vg/shared";
import { probeDurationSec } from "../../media/ffmpeg.js";
import { encodeClip, shotFrameCount, shotOutputPath, type ComposeRenderContext, type ShotRenderResult } from "./context.js";

export async function renderShot(
  shot: Shot,
  target: RenderTarget,
  ctx: ComposeRenderContext,
): Promise<ShotRenderResult> {
  if (shot.source.kind !== "footage") throw new Error("render footage cần nguồn footage");
  const frames = shotFrameCount(shot, target.fps);
  const dur = frames / target.fps;
  const file = ctx.resolvePath(shot.source.path ?? "");
  const available = await probeDurationSec(file);
  const short = available > 0 && available + 0.05 < shot.source.inSec + dur;
  const path = shotOutputPath(ctx, shot);
  const { width, height, fps } = target;
  await encodeClip([
    "-ss", String(shot.source.inSec),
    "-t", String(dur),
    "-i", file,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,tpad=stop_mode=clone:stop=30`,
    "-frames:v", String(frames),
    "-r", String(fps),
  ], path, ctx.ffmpeg);
  return short
    ? { path, frames, warning: "Footage ngắn hơn cảnh quay, giữ khung cuối, không lặp." }
    : { path, frames };
}

export { CLIP_OUTPUT_ARGS };
