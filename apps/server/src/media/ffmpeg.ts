import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
