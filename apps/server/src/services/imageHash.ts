import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { dHashFromGray, hashToHex } from "@vg/shared";

const execFileAsync = promisify(execFile);

export async function hashImage(pathOrBuffer: string | Buffer): Promise<{ phash: string; phashCenter: string } | null> {
  if (!ffmpegPath) return null;
  const dir = mkdtempSync(join(tmpdir(), "vg-hash-"));
  const input = join(dir, "in");
  try {
    if (typeof pathOrBuffer === "string") {
      writeFileSync(input, readFileSync(pathOrBuffer));
    } else {
      writeFileSync(input, pathOrBuffer);
    }
    const full = await grayFrame(input, "scale=9:8:flags=area,format=gray");
    const center = await grayFrame(input, "crop=iw*0.8:ih*0.8,scale=9:8:flags=area,format=gray");
    if (!full || !center) return null;
    return { phash: hashToHex(dHashFromGray(full)), phashCenter: hashToHex(dHashFromGray(center)) };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function grayFrame(input: string, filter: string): Promise<Uint8Array | null> {
  if (!ffmpegPath) return null;
  const { stdout } = await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-i", input, "-vf", filter, "-frames:v", "1", "-f", "rawvideo", "pipe:1",
  ], { timeout: 10_000, encoding: "buffer", maxBuffer: 1024 * 1024 });
  const bytes = stdout as unknown as Buffer;
  return bytes.length >= 72 ? new Uint8Array(bytes.subarray(0, 72)) : null;
}
