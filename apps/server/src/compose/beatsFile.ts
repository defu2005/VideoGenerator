import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectBeats, type BeatGrid } from "@vg/shared";
import { resolveFfmpegPath } from "../media/ffmpeg.js";

export async function beatGridForMusic(
  dataDir: string,
  musicPath: string,
  run?: (path: string) => Promise<Buffer>,
): Promise<BeatGrid | null> {
  const hash = createHash("sha256").update(existsSync(musicPath) ? readFileSync(musicPath) : musicPath).digest("hex").slice(0, 24);
  const cachePath = join(dataDir, "compose-cache", `beats-${hash}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8")) as BeatGrid | null;
  const pcm = run ? await run(musicPath) : await decodeMono(musicPath);
  const samples = Math.floor(pcm.byteLength / 4);
  const copy = new ArrayBuffer(samples * 4);
  new Uint8Array(copy).set(pcm.subarray(0, samples * 4));
  const grid = detectBeats(new Float32Array(copy), 11025);
  mkdirSync(join(dataDir, "compose-cache"), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(grid));
  return grid;
}

function decodeMono(musicPath: string): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(resolveFfmpegPath(), [
      "-v", "error", "-i", musicPath, "-ac", "1", "-ar", "11025", "-f", "f32le", "pipe:1",
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks));
      else rejectPromise(new Error(stderr.trim() || `ffmpeg thoát ${code}`));
    });
  });
}

export function musicStamp(musicPath: string): string {
  if (!existsSync(musicPath)) return musicPath;
  const stat = statSync(musicPath);
  return `${stat.size}:${stat.mtimeMs}`;
}
