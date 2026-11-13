import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFinalPlan,
  buildSceneClipPlan,
  calloutAssLines,
  CLIP_OUTPUT_ARGS,
  concatListText,
  parseProgressSeconds,
  type BudgetFeatures,
  type ComposePlan,
  type ExecuteReport,
  type RenderBundle,
} from "@vg/shared";
import { renderComposedScene } from "../compose/sceneClip.js";
import { renderMotionGraphic } from "../media/motion.js";
import { StageError } from "../pipeline/stageExecutor.js";
import type { ExecuteIo, RenderSceneFn } from "./types.js";

export const RENDER_BASE_ARGS = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** The default scene renderer: finds the scene plan and renders it. Same as the control plane's. */
export const renderSceneFromPlan: RenderSceneFn = async (plan, sceneId, target, ctx, outPath) => {
  const scene = plan.scenes.find((item) => item.sceneId === sceneId);
  if (!scene) throw new Error(`Không có kế hoạch cho cảnh ${sceneId}`);
  return renderComposedScene(scene, target, ctx, outPath);
};

/**
 * Execute part of a render: scene clips, concat, graphics, filter, final ffmpeg.
 * Runs on the main machine or on a worker with the same code. It reads only the bundle and `io`.
 */
export async function executeRender(bundle: RenderBundle, io: ExecuteIo): Promise<{ outputPath: string; report: ExecuteReport }> {
  const { signal, onProgress } = io;
  const timeline = bundle.timeline;
  const composePlan = bundle.composePlan as ComposePlan | null;
  const resolvePath = io.resolve;
  const croppedPaths = new Set(bundle.croppedNames);
  const clipsDir = join(io.renderDir, "clips");
  mkdirSync(clipsDir, { recursive: true });
  mkdirSync(join(io.versionDir, "thumbs"), { recursive: true });
  const brandColor = bundle.brandColor ?? undefined;
  const accentColor = bundle.accentColor ?? undefined;
  const videoStyle = bundle.videoStyle ?? undefined;
  const composeWarnings: string[] = [];

  // 1. Scene clips (0–60 %), cached by content hash (includes target size).
  const clipPaths: string[] = [];
  let clipsReused = 0;
  let clipsRendered = 0;
  const graphicShots: ExecuteReport["graphicShots"] = [];
  for (const [index, scene] of timeline.scenes.entries()) {
    const clipPath = join(clipsDir, `${bundle.clipHashes[index]}.mp4`);
    clipPaths.push(clipPath);
    onProgress(Math.round((index / timeline.scenes.length) * 60), `Dựng cảnh ${index + 1}/${timeline.scenes.length}`);
    if (existsSync(clipPath)) {
      clipsReused += 1;
      continue;
    }
    const scenePlan = composePlan?.scenes.find((item) => item.sceneId === scene.sceneId);
    if (scenePlan) {
      try {
        const sceneRender = await (io.renderScene ?? renderSceneFromPlan)(composePlan!, scene.sceneId, timeline.target, {
          dataDir: io.dataDir,
          outDir: clipsDir,
          resolvePath,
          brandColor,
          accentColor,
          projectId: bundle.projectId,
          profileId: bundle.profileId,
          recipeId: bundle.recipeId,
          videoStyle: videoStyle as never,
          language: bundle.language ?? undefined,
          composeGraphics: bundle.composeGraphics as BudgetFeatures["composeGraphics"],
          graphicGrain: bundle.graphicGrain,
          signal,
        }, clipPath);
        graphicShots.push(...(sceneRender?.graphicShots ?? []));
        clipsRendered += 1;
        continue;
      } catch (error) {
        rmSync(clipPath, { force: true });
        if (isAbort(error) || signal.aborted) throw error;
        composeWarnings.push(`Cảnh ${scene.order + 1}: dùng ảnh tĩnh vì ${(error as Error).message}`);
      }
    }
    const plan = buildSceneClipPlan(scene, timeline.target, resolvePath, { croppedPaths });
    const filterPath = join(clipsDir, `${bundle.clipHashes[index]}.filter.txt`);
    const partPath = join(clipsDir, `${bundle.clipHashes[index]}.part.mp4`);
    writeFileSync(filterPath, plan.filter);
    try {
      await io.ffmpeg([
        ...RENDER_BASE_ARGS,
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
  const concatPath = join(io.renderDir, "clips.txt");
  writeFileSync(concatPath, concatListText(clipPaths));
  const assFileName = bundle.assText !== null ? "subtitles.ass" : null;
  if (assFileName) writeFileSync(join(io.renderDir, assFileName), bundle.assText!);
  const crossfade = timeline.scenes.some((scene) => scene.transitionOut && scene.transitionOut.type !== "cut");
  const graphicWarnings: string[] = [];
  const graphics: { path: string; startSec: number; endSec: number }[] = [];
  for (const graphic of timeline.graphics ?? []) {
    const rendered = await renderMotionGraphic({
      dataDir: io.dataDir,
      templateId: graphic.templateId,
      variables: graphic.variables,
      width: timeline.target.width,
      height: timeline.target.height,
      fps: timeline.target.fps,
      durationSec: graphic.durationSec,
    });
    if (!rendered.outputPath) {
      graphicWarnings.push(rendered.warning ?? `Bỏ ${graphic.templateId}`);
      continue;
    }
    graphics.push({
      path: rendered.outputPath,
      startSec: graphic.startSec,
      endSec: graphic.startSec + graphic.durationSec,
    });
  }
  const kineticFailed = graphicWarnings.some((warning) => warning.includes("kinetic_word"));
  if (assFileName && timeline.editPlan?.emphasis?.length) {
    const extra = calloutAssLines({
      points: timeline.editPlan.emphasis,
      scenes: timeline.scenes,
      wordsByScene: bundle.wordsByScene,
      kineticFailed,
      motionEnabled: (timeline.graphics ?? []).some((graphic) => graphic.templateId === "kinetic_word"),
    });
    if (extra) appendFileSync(join(io.renderDir, assFileName), `\n${extra}\n`);
  }
  let xfadeAvailable = true;
  if (crossfade) {
    try {
      const listed = await io.ffmpeg(["-hide_banner", "-filters"], { signal });
      xfadeAvailable = `${listed.stdout}\n${listed.stderr}`.includes("xfade");
    } catch {
      xfadeAvailable = false;
    }
  }
  const plan = buildFinalPlan({
    totalDurationSec: timeline.totalDurationSec,
    scenes: timeline.scenes,
    music: timeline.music,
    concatListPath: concatPath,
    resolvePath,
    assFileName,
    sceneClips: crossfade ? clipPaths.map((path, index) => ({
      path,
      sceneId: timeline.scenes[index]!.sceneId,
      startSec: timeline.scenes[index]!.startSec,
      durationSec: timeline.scenes[index]!.durationSec,
      transitionOut: timeline.scenes[index]!.transitionOut ?? null,
    })) : undefined,
    xfadeAvailable,
    graphics,
    sfx: bundle.sfx.map((cue) => ({ path: join(io.sfxDir, cue.name), startSec: cue.startSec })),
  });
  const joinWarnings = [
    ...graphicWarnings,
    ...(plan.warning ? [plan.warning] : []),
  ];
  const finalFilter = "final.filter.txt";
  writeFileSync(join(io.renderDir, finalFilter), plan.filter);
  const partPath = join(io.versionDir, "output.part.mp4");
  const outputPath = join(io.versionDir, "output.mp4");
  onProgress(60, "Ghép video, phụ đề và âm thanh");
  try {
    await io.ffmpeg([
      ...RENDER_BASE_ARGS,
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
      join("versions", bundle.renderId, "output.part.mp4"),
    ], {
      cwd: io.renderDir,
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
    rmSync(io.versionDir, { recursive: true, force: true });
    if (isAbort(error) || signal.aborted) throw error;
    throw new StageError(`FFmpeg lỗi khi ghép video: ${(error as Error).message}`, "RENDER_FINAL_FAILED", false);
  } finally {
    rmSync(join(io.renderDir, finalFilter), { force: true });
  }
  return { outputPath, report: { clipsReused, clipsRendered, graphicShots, composeWarnings, joinWarnings } };
}
