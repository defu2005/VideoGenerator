import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMPOSE_RENDER_VERSION, COMPOSE_VERSION, concatListText, isGraphicKind, type RenderTarget, type ScenePlan, type Shot } from "@vg/shared";
import { encodeClip, type ComposeRenderContext } from "./render/context.js";
import { withGraphicStyle } from "./render/graphicStyle.js";
import { renderShot as renderFootage } from "./render/footage.js";
import { graphicRenderLimit, renderShot as renderGraphic } from "./render/graphic.js";
import { renderShot as renderStill } from "./render/still.js";

export function sceneCacheMaterial(
  scenePlan: ScenePlan,
  assets: string[],
  target: RenderTarget,
  ctx: ComposeRenderContext,
) {
  return {
    scenePlan,
    assets,
    target,
    version: COMPOSE_VERSION,
    renderVersion: COMPOSE_RENDER_VERSION,
    brandColor: ctx.brandColor ?? null,
    accentColor: ctx.accentColor ?? null,
    language: ctx.language ?? null,
    projectId: ctx.projectId ?? null,
    composeGraphics: ctx.composeGraphics ?? "animated",
    graphicGrain: ctx.graphicGrain === true,
    styleFingerprint: ctx.videoStyle?.fingerprint ?? null,
    styleAxes: ctx.videoStyle
      ? scenePlan.shots.map((shot) => ({ id: shot.id, axes: ctx.videoStyle?.byShot[shot.id]?.axes ?? null }))
      : null,
    fps: target.fps,
    format: "mp4",
    quality: "standard",
    width: target.width,
    height: target.height,
  };
}

export function sceneCacheKey(
  scenePlan: ScenePlan,
  assets: string[],
  target: RenderTarget,
  ctx: ComposeRenderContext,
): string {
  return createHash("sha256").update(JSON.stringify(sceneCacheMaterial(scenePlan, assets, target, ctx))).digest("hex").slice(0, 24);
}

export async function renderComposedScene(
  scenePlan: ScenePlan,
  target: RenderTarget,
  ctx: ComposeRenderContext,
  outPath: string,
): Promise<{ frames: number; warnings: string[]; graphicShots: { shotId: string; kind: Shot["kind"]; renderPath: "static" | "animated" | "reencoded" }[] }> {
  const styled = withGraphicStyle(ctx, scenePlan.shots, target);
  const assets = scenePlan.shots.flatMap((shot) => shot.source.kind === "footage" || shot.source.kind === "still" ? [shot.source.path ?? ""] : []);
  const key = sceneCacheKey(scenePlan, assets.map(assetHash), target, styled);
  const cached = join(ctx.dataDir, "compose-cache", `${key}.mp4`);
  const metaPath = join(ctx.dataDir, "compose-cache", `${key}.graphics.json`);
  if (existsSync(cached)) {
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(cached, outPath);
    return { frames: scenePlan.durationFrames, warnings: [], graphicShots: readGraphicShots(metaPath) };
  }
  const work = { ...styled, outDir: join(styled.dataDir, "compose-cache", "shots", key) };
  mkdirSync(work.outDir, { recursive: true });
  const warnings: string[] = [];
  const graphicShots: { shotId: string; kind: Shot["kind"]; renderPath: "static" | "animated" | "reencoded" }[] = [];
  const paths: string[] = [];
  try {
    const renderedShots = await mapLimit(scenePlan.shots, graphicRenderLimit(), (shot) => renderOne(shot, target, work));
    for (const [index, rendered] of renderedShots.entries()) {
      const shot = scenePlan.shots[index]!;
      if (rendered.warning) warnings.push(rendered.warning);
      if (!rendered.path) throw new Error(rendered.warning ?? `Không dựng được cảnh quay ${shot.id}`);
      if (rendered.graphicPath) graphicShots.push({ shotId: shot.id, kind: shot.kind, renderPath: rendered.graphicPath });
      paths.push(rendered.path);
    }
    const list = join(work.outDir, "concat.txt");
    writeFileSync(list, concatListText(paths));
    mkdirSync(join(ctx.dataDir, "compose-cache"), { recursive: true });
    await encodeClip([
      "-f", "concat",
      "-safe", "0",
      "-i", list,
      "-frames:v", String(scenePlan.durationFrames),
      "-r", String(target.fps),
    ], cached, ctx.ffmpeg);
    writeFileSync(metaPath, JSON.stringify(graphicShots));
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(cached, outPath);
    return { frames: scenePlan.durationFrames, warnings, graphicShots };
  } finally {
    rmSync(work.outDir, { recursive: true, force: true });
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!);
    }
  }
  if (items.length === 0) return results;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function readGraphicShots(path: string): { shotId: string; kind: Shot["kind"]; renderPath: "static" | "animated" | "reencoded" }[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed as { shotId: string; kind: Shot["kind"]; renderPath: "static" | "animated" | "reencoded" }[] : [];
  } catch {
    return [];
  }
}

function renderOne(shot: Shot, target: RenderTarget, ctx: ComposeRenderContext) {
  if (shot.source.kind === "footage") return renderFootage(shot, target, ctx);
  if (isGraphicKind(shot.source.kind)) return renderGraphic(shot, target, ctx);
  return renderStill(shot, target, ctx);
}

function assetHash(path: string): string {
  if (!path || !existsSync(path)) return path;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
