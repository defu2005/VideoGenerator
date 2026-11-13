import { rmSync } from "node:fs";
import {
  buildSceneClipPlan,
  defaultMotion,
  type MotionPreset,
  type RenderTarget,
  type Shot,
  type TimelineScene,
  type TimelineVisual,
} from "@vg/shared";
import { encodeClip, shotFrameCount, shotOutputPath, writeFilter, type ComposeRenderContext, type ShotRenderResult } from "./context.js";

export async function renderShot(
  shot: Shot,
  target: RenderTarget,
  ctx: ComposeRenderContext,
): Promise<ShotRenderResult> {
  const frames = shotFrameCount(shot, target.fps);
  const durationSec = frames / target.fps;
  const source = shot.source.kind === "still" ? shot.source : { kind: "still" as const, candidateId: null, path: null, motion: "static" as const };
  const scene: TimelineScene = {
    sceneId: shot.id,
    order: 0,
    label: shot.id,
    startSec: 0,
    endSec: durationSec,
    durationSec,
    durationFrames: frames,
    voice: null,
    visuals: [visual(source.path, source.candidateId, source.motion, durationSec)],
    fadeInSec: 0,
    fadeOutSec: 0,
  };
  const plan = buildSceneClipPlan(scene, target, ctx.resolvePath);
  const filter = writeFilter(ctx, shot.id, plan.filter);
  const path = shotOutputPath(ctx, shot);
  try {
    await encodeClip([
      ...plan.inputArgs,
      "-filter_complex_script", filter,
      "-map", "[out]",
      "-frames:v", String(frames),
      "-r", String(target.fps),
    ], path, ctx.ffmpeg);
    return { path, frames };
  } finally {
    rmSync(filter, { force: true });
  }
}

function visual(path: string | null, candidateId: string | null, preset: MotionPreset, durationSec: number): TimelineVisual {
  return {
    kind: path ? "IMAGE" : "PLACEHOLDER",
    candidateId,
    path,
    startSec: 0,
    endSec: durationSec,
    motion: motionFor(preset),
    motionPreset: preset,
    licenseKind: null,
  };
}

function motionFor(preset: MotionPreset): TimelineVisual["motion"] {
  const wide = { zoom: 1, x: 0.5, y: 0.5 };
  const close = { zoom: 1.12, x: 0.5, y: 0.5 };
  if (preset === "static") return { type: "kenburns", from: wide, to: wide };
  if (preset === "pull_out") return { type: "kenburns", from: close, to: wide };
  if (preset === "pan_left") return { type: "pan", from: { zoom: 1.08, x: 0.62, y: 0.5 }, to: { zoom: 1.08, x: 0.38, y: 0.5 } };
  if (preset === "pan_right") return { type: "pan", from: { zoom: 1.08, x: 0.38, y: 0.5 }, to: { zoom: 1.08, x: 0.62, y: 0.5 } };
  if (preset === "pan_up") return { type: "pan", from: { zoom: 1.08, x: 0.5, y: 0.62 }, to: { zoom: 1.08, x: 0.5, y: 0.38 } };
  return defaultMotion(preset === "punch_in" ? 0 : 1);
}
