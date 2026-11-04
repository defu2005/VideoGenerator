import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  return typeof ffmpegStatic === "string" ? ffmpegStatic : "ffmpeg";
}

export function resolveFfprobePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FFPROBE_PATH) return env.FFPROBE_PATH;
  const staticPath = typeof ffprobeStatic === "object" && "path" in ffprobeStatic ? ffprobeStatic.path : undefined;
  return staticPath || "ffprobe";
}

export function probeDurationSec(file: string, signal?: AbortSignal): Promise<number> {
  if (!file || !existsSync(file)) return Promise.resolve(0);
  return new Promise<number>((resolvePromise, rejectPromise) => {
    if (signal?.aborted) {
      rejectPromise(new DOMException("aborted", "AbortError"));
      return;
    }
    const ffprobe = resolveFfprobePath();
    const child = spawn(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });

    const onAbort = () => {
      child.kill();
      rejectPromise(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        rejectPromise(new Error(stderr || `ffprobe failed for ${file}`));
        return;
      }
      const value = Number.parseFloat((stdout || "0").trim());
      resolvePromise(Number.isFinite(value) ? value : 0);
    });
  });
}

export function ensureFileDirectory(filePath: string): string {
  const path = resolve(filePath);
  const folder = dirname(path);
  return folder;
}

export type MediaProbe = { durationSec: number; width: number; height: number; hasVideo: boolean; hasAudio: boolean };

export type FfmpegRunOptions = { cwd?: string; signal?: AbortSignal; onStdout?: (chunk: string) => void };

/** Runs ffmpeg; rejects with the stderr tail on a non-zero exit. Abort kills the process. */
export function runFfmpeg(args: string[], options: FfmpegRunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return runTool(resolveFfmpegPath(), args, options);
}

function runTool(command: string, args: string[], options: FfmpegRunOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const { signal } = options;
    if (signal?.aborted) {
      rejectPromise(new DOMException("aborted", "AbortError"));
      return;
    }
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let settled = false;
    const onAbort = () => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        rejectPromise(new DOMException("aborted", "AbortError"));
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (stdout.length < 1_000_000) stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      if (!settled) {
        settled = true;
        rejectPromise(error);
      }
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).slice(-8).join("\n");
        rejectPromise(new Error(tail || `${command} exited with code ${code}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

export async function probeMedia(file: string, signal?: AbortSignal): Promise<MediaProbe> {
  const { stdout } = await runTool(resolveFfprobePath(), [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file,
  ], { signal });
  const data = JSON.parse(stdout || "{}") as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  return {
    durationSec: Number.parseFloat(data.format?.duration ?? "0") || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasVideo: Boolean(video),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
  };
}

/**
 * Downscale an image for vision LLM calls: long side ≤ 768 px, JPEG quality ≈ 80.
 * Portrait-safe (`-2` keeps even height). No-op copy via ffmpeg when already small.
 */
export async function downscaleForVision(
  src: string,
  dst: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!existsSync(src)) throw new Error(`Vision source missing: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst)) return;
  await runFfmpeg([
    "-hide_banner", "-nostdin", "-y",
    "-i", src,
    "-vf", "scale='min(768,iw)':-2",
    "-q:v", "2",
    dst,
  ], { signal });
}
