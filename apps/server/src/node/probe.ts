import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { motionTelemetryEnv, type NodeProbe } from "@vg/shared";
import { probeDurationSec, resolveFfmpegPath } from "../media/ffmpeg.js";

/*
 * Capability probe (TASK-119). Proves the machine can render by doing a tiny real render through the same
 * HyperFrames path the compose renderer uses: one 1-second solid-colour composition at low resolution.
 * Idea only taken from renderers' "smoke render" health checks; no code copied.
 */

export const PROBE_TIMEOUT_MS = 60_000;
export const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const COMPOSITION = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#1e3a8a}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="1" data-width="320" data-height="180" data-fps="10"></div></body></html>`;

export type ProbeDeps = {
  ffmpegVersion?: () => Promise<boolean>;
  /** Renders the probe composition into `outputPath`. Rejects with the failure. */
  render?: (workDir: string, outputPath: string, signal: AbortSignal) => Promise<void>;
  duration?: (file: string) => Promise<number>;
  now?: () => Date;
};

function ffmpegOk(): Promise<boolean> {
  return new Promise((done) => {
    try {
      const child = spawn(resolveFfmpegPath(), ["-version"], { stdio: "ignore", windowsHide: true });
      child.on("error", () => done(false));
      child.on("exit", (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

async function realRender(workDir: string, outputPath: string, signal: AbortSignal): Promise<void> {
  const require = createRequire(import.meta.url);
  const entry = join(dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs");
  const { runHyperframes, withMediaBins } = await import("../compose/hyperframes.js");
  await runHyperframes(process.execPath, [
    entry, "render", workDir, "--output", outputPath, "--format", "mp4", "--fps", "10", "--workers", "1", "--quality", "draft",
  ], withMediaBins(motionTelemetryEnv(process.env)), outputPath, signal);
}

/** Maps a raw failure to the short Vietnamese reason shown on the Nodes page. */
export function probeReason(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "Hết thời gian";
  const text = error instanceof Error ? error.message : String(error);
  if (/Cannot find (module|package)|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|resolve.*hyperframes/i.test(text)) return "Thiếu gói HyperFrames";
  if (/chrom|browser|puppeteer|launch|libnss|sandbox|shared libraries/i.test(text)) return "Không mở được trình duyệt cho HyperFrames";
  if (/ffmpeg|ffprobe/i.test(text)) return "Thiếu ffmpeg";
  return `Dựng thử lỗi: ${text.replace(/\s+/g, " ").slice(0, 160)}`;
}

export async function runRenderProbe(dataDir: string, deps: ProbeDeps = {}): Promise<NodeProbe> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const checkedAt = now().toISOString();
  const done = (ok: boolean, reason?: string): NodeProbe => ({
    render: { ok, ...(reason ? { reason } : {}), checkedAt, ms: Date.now() - started },
  });
  if (!(await (deps.ffmpegVersion ?? ffmpegOk)())) return done(false, "Thiếu ffmpeg");
  const base = join(dataDir, "tmp");
  mkdirSync(base, { recursive: true });
  const workDir = mkdtempSync(join(base, "probe-"));
  try {
    writeFileSync(join(workDir, "index.html"), COMPOSITION);
    const outputPath = join(workDir, "probe.mp4");
    await (deps.render ?? realRender)(workDir, outputPath, AbortSignal.timeout(PROBE_TIMEOUT_MS));
    if (statSync(outputPath, { throwIfNoEntry: false })?.size === undefined) return done(false, "Dựng thử không tạo ra tệp");
    const seconds = await (deps.duration ?? ((file) => probeDurationSec(file)))(outputPath);
    if (!(seconds > 0)) return done(false, "Tệp dựng thử không đọc được thời lượng");
    return done(true);
  } catch (error) {
    return done(false, probeReason(error));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
