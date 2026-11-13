import type { AspectRatio, ComposePlan, JobUsage, RenderBundle, RenderTarget } from "@vg/shared";
import type { FfmpegRunOptions } from "../media/ffmpeg.js";
import type { ComposeRenderContext } from "../compose/render/context.js";

export type ExecFfmpeg = (args: string[], options: FfmpegRunOptions) => Promise<{ stdout: string; stderr: string }>;

export type RenderSceneFn = (
  plan: ComposePlan,
  sceneId: string,
  target: RenderTarget,
  ctx: ComposeRenderContext,
  outPath: string,
) => Promise<{ graphicShots?: Array<{ shotId: string; kind: string; renderPath: "static" | "animated" | "reencoded" }> } | void>;

/** What the execute part may touch. No database, no LLM, no vault, no auth. */
export type ExecuteIo = {
  /** Turns a file name in the bundle (a path or a logical name) into a file on this machine. */
  resolve: (name: string) => string;
  dataDir: string;
  /** Work folder for clip cache, concat list, subtitles and filter files. */
  renderDir: string;
  /** Folder that receives output.mp4: `<renderDir>/versions/<renderId>`. Removed if the final pass fails. */
  versionDir: string;
  /** Folder of the sound effects that ship with the app. */
  sfxDir: string;
  ffmpeg: ExecFfmpeg;
  renderScene?: RenderSceneFn;
  signal: AbortSignal;
  onProgress: (pct: number, message: string) => void;
};

/** What the control plane keeps between prepare and finalize. JSON only. */
export type FinalizeState = {
  inputHash: string;
  renderId: string;
  outputAspect: AspectRatio;
  projectAspect: AspectRatio;
  isVariant: boolean;
  storedAspect: AspectRatio | null;
  composeWarnings: string[];
  composeUsage: JobUsage | null;
  startedMs: number;
};

export type PreparedRender = {
  bundle: RenderBundle;
  state: FinalizeState;
};
