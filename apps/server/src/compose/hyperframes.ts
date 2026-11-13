import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPOSE_RENDER_VERSION, COMPOSE_VERSION, motionTelemetryEnv } from "@vg/shared";
import { gsapFile, killProcessTree, writeCompositionHtml } from "../media/motion.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function composeAssetRoot(): string {
  return join(serverRoot, "assets", "compose");
}

function fontFile(weight: "400" | "700", subset: "vietnamese" | "latin" | "latin-ext" = "vietnamese"): string {
  return join(dirname(require.resolve("@fontsource/be-vietnam-pro/package.json")), "files", `be-vietnam-pro-${subset}-${weight}-normal.woff2`);
}

/** Script shared by the templates (colours, safe box, text fitting). */
function commonScript(): string {
  const file = join(composeAssetRoot(), "common.js");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export async function renderComposeTemplate(input: {
  dataDir: string;
  templateId: string;
  variables: Record<string, unknown>;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  /** Opaque MP4 for a full-scene graphic. Omitted keeps the alpha clip used by overlays. */
  format?: "mp4" | "webm" | "mov";
  quality?: "draft" | "standard" | "high";
  /** One frame of the finished state. Both ends are seconds on the composition clock. */
  startSec?: number;
  endSec?: number;
  signal?: AbortSignal;
  run?: (command: string, args: string[], env: NodeJS.ProcessEnv, outputPath: string) => Promise<void>;
}): Promise<{ outputPath: string; seconds: number; cached: boolean; warning?: string }> {
  const source = join(composeAssetRoot(), input.templateId, "index.html");
  if (!/^[a-z0-9_]+$/.test(input.templateId) || !existsSync(source)) {
    return { outputPath: "", seconds: 0, cached: false, warning: `Không có mẫu ${input.templateId}` };
  }
  const html = readFileSync(source);
  const common = commonScript();
  const format = input.format ?? (process.platform === "win32" ? "webm" : "mov");
  const quality = input.quality ?? "draft";
  const key = createHash("sha256").update(JSON.stringify({
    version: COMPOSE_VERSION,
    renderVersion: COMPOSE_RENDER_VERSION,
    template: html.toString("utf8"),
    common,
    variables: input.variables,
    width: input.width,
    height: input.height,
    fps: input.fps,
    durationSec: input.durationSec,
    format,
    quality,
    startSec: input.startSec ?? null,
    endSec: input.endSec ?? null,
  })).digest("hex").slice(0, 24);
  const outputPath = join(input.dataDir, "compose-cache", `${input.templateId}-${key}.${format}`);
  if (existsSync(outputPath)) return { outputPath, seconds: 0, cached: true };
  const workDir = join(input.dataDir, "compose-cache", "work", key);
  const started = Date.now();
  try {
    mkdirSync(workDir, { recursive: true });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(join(workDir, "index.html"), writeCompositionHtml(html.toString("utf8"), input));
    writeFileSync(join(workDir, "variables.json"), JSON.stringify(input.variables));
    copyFileSync(gsapFile(), join(workDir, "gsap.min.js"));
    copyFileSync(fontFile("400"), join(workDir, "font.woff2"));
    copyFileSync(fontFile("700"), join(workDir, "font-bold.woff2"));
    writeFileSync(join(workDir, "common.js"), common);
    for (const subset of ["latin", "latin-ext"] as const) {
      copyFileSync(fontFile("400", subset), join(workDir, `font-${subset}.woff2`));
      copyFileSync(fontFile("700", subset), join(workDir, `font-${subset}-bold.woff2`));
    }
    const args = [
      join(dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs"),
      "render", workDir,
      "--output", outputPath,
      "--format", format,
      "--fps", String(input.fps),
      "--workers", "1",
      "--variables-file", join(workDir, "variables.json"),
      "--quality", quality,
    ];
    if (input.startSec != null) args.push("--start", input.startSec.toFixed(3));
    if (input.endSec != null) args.push("--end", input.endSec.toFixed(3));
    await (input.run ?? ((command, commandArgs, env, out) => runHyperframes(command, commandArgs, env, out, input.signal)))(process.execPath, args, withMediaBins(motionTelemetryEnv(process.env)), outputPath);
    return { outputPath, seconds: (Date.now() - started) / 1000, cached: false };
  } catch (error) {
    rmSync(outputPath, { force: true });
    if (input.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    return {
      outputPath: "",
      seconds: (Date.now() - started) / 1000,
      cached: false,
      warning: error instanceof Error ? error.message : "lỗi mẫu",
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function withMediaBins(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const bins: string[] = [];
  const ffmpeg = require("ffmpeg-static") as string | null;
  if (ffmpeg) bins.push(dirname(ffmpeg));
  const probe = require("ffprobe-static") as { path?: string };
  if (probe.path) bins.push(dirname(probe.path));
  const sep = process.platform === "win32" ? ";" : ":";
  const current = env.PATH ?? env.Path ?? "";
  const path = [...bins, current].filter(Boolean).join(sep);
  return { ...env, PATH: path, Path: path };
}

export function runHyperframes(command: string, args: string[], env: NodeJS.ProcessEnv, _outputPath: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new DOMException("aborted", "AbortError"));
      return;
    }
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const onAbort = () => {
      killProcessTree(child.pid);
      finish(new DOMException("aborted", "AbortError"));
    };
    timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish(new Error("hết giờ render mẫu"));
    }, 120_000);
    signal?.addEventListener("abort", onAbort, { once: true });
    // Both pipes must be drained or the child blocks once the OS pipe buffer fills.
    const stderrTail = tailCollector(20);
    const stdoutTail = tailCollector(20);
    child.stderr.on("data", (chunk: Buffer) => stderrTail.push(chunk.toString()));
    child.stdout.on("data", (chunk: Buffer) => stdoutTail.push(chunk.toString()));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderrTail.text() || stdoutTail.text() || `hyperframes thoát ${code}`));
    });
  });
}

/** Keeps only the last `max` lines of a stream, so output size never grows memory. */
function tailCollector(max: number): { push: (text: string) => void; text: () => string } {
  let lines: string[] = [];
  let partial = "";
  return {
    push(text) {
      const parts = (partial + text).split(/\r?\n/);
      partial = parts.pop() ?? "";
      if (partial.length > 8192) partial = partial.slice(-8192);
      lines.push(...parts);
      if (lines.length > max) lines = lines.slice(-max);
    },
    text() {
      return [...lines, partial].filter((line) => line.trim() !== "").slice(-max).join("\n");
    },
  };
}
