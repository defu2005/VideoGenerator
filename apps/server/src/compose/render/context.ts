import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLIP_OUTPUT_ARGS, type BudgetFeatures, type RenderTarget, type ResolvedStyle, type Shot, type StylePack, type TemplateStyle, type VariantPick } from "@vg/shared";
import { runFfmpeg } from "../../media/ffmpeg.js";

export type ShotRenderResult = {
  path: string;
  frames: number;
  warning?: string;
  /** How a graphic shot was produced. Absent for footage and stills. */
  graphicPath?: "static" | "animated" | "reencoded";
};

export type GraphicProbe = {
  width: number;
  height: number;
  fps: number;
  frames: number;
  pixFmt: string;
  codec: string;
};

export type ComposeRenderContext = {
  dataDir: string;
  outDir: string;
  resolvePath: (path: string) => string;
  brandColor?: string;
  accentColor?: string;
  /** Picks the template variant together with the shot id. */
  projectId?: string;
  /** Profile id. With the project id it seeds variant picks for the whole video. */
  profileId?: string | null;
  /** Format recipe id. The matching genre pack supplies the genre style layer. */
  recipeId?: string | null;
  /**
   * Channel pack for this render. Omit to build one from the brand colour.
   * `null` keeps the genre layer and the base tokens only.
   */
  stylePack?: StylePack | null;
  /**
   * Style resolved once for the video, plus the template style of each graphic shot.
   * Scene and clip cache keys read `fingerprint` and each shot's `axes`.
   */
  videoStyle?: {
    fingerprint: string;
    byShot: Record<string, TemplateStyle>;
    packId?: string | null;
    packVersion?: number | null;
    resolved?: ResolvedStyle;
    picks?: VariantPick[];
  };
  /** Video language, for number formatting in charts. */
  language?: string;
  composeGraphics?: BudgetFeatures["composeGraphics"];
  graphicGrain?: boolean;
  signal?: AbortSignal;
  ffmpeg?: (args: string[]) => Promise<unknown>;
  runTemplate?: (command: string, args: string[], env: NodeJS.ProcessEnv, outputPath: string) => Promise<void>;
  /** ffprobe of a HyperFrames file. A throw means the stream is not reusable. */
  probeGraphic?: (file: string) => Promise<GraphicProbe>;
};

export const COMPOSE_FFMPEG_BASE = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];

export function shotFrameCount(shot: Pick<Shot, "startSec" | "endSec">, fps: number): number {
  return Math.max(1, Math.round(shot.endSec * fps) - Math.round(shot.startSec * fps));
}

export async function encodeClip(
  args: string[],
  outPath: string,
  ffmpeg: ComposeRenderContext["ffmpeg"] = runFfmpeg,
): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true });
  const part = `${outPath}.part.mp4`;
  try {
    await ffmpeg([...COMPOSE_FFMPEG_BASE, ...args, ...CLIP_OUTPUT_ARGS, part]);
    renameSync(part, outPath);
  } catch (error) {
    rmSync(part, { force: true });
    throw error;
  }
}

export function shotOutputPath(ctx: ComposeRenderContext, shot: Shot): string {
  mkdirSync(ctx.outDir, { recursive: true });
  return join(ctx.outDir, `${shot.id.replace(/[^a-zA-Z0-9_-]/g, "")}.mp4`);
}

export function writeFilter(ctx: ComposeRenderContext, name: string, filter: string): string {
  mkdirSync(ctx.outDir, { recursive: true });
  const path = join(ctx.outDir, `${name}.filter.txt`);
  writeFileSync(path, filter);
  return path;
}
