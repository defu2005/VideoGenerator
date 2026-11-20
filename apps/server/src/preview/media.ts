import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dHashFromGray, hashToHex } from "@vg/shared";
import { resolveFfmpegPath } from "../media/ffmpeg.js";

const execFileAsync = promisify(execFile);

export type PreviewFfmpeg = (args: string[]) => Promise<unknown>;

/** Average luma, color and grayscale dHash from a single 9×8 sample. */
export async function lumaAndHash(file: string): Promise<{ luma: number; phash: string; meanColor: [number, number, number] } | null> {
  try {
    const { stdout } = await execFileAsync(resolveFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-i", file,
      "-vf", "scale=9:8:flags=area,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1",
    ], { timeout: 15_000, encoding: "buffer", maxBuffer: 1024 * 1024, windowsHide: true });
    const bytes = stdout as unknown as Buffer;
    if (bytes.length < 72 * 3) return null;
    const pixels = new Uint8Array(72);
    const meanColor: [number, number, number] = [0, 0, 0];
    let sum = 0;
    for (let i = 0; i < 72; i += 1) {
      const r = bytes[i * 3]!, g = bytes[i * 3 + 1]!, b = bytes[i * 3 + 2]!;
      meanColor[0] += r / 72;
      meanColor[1] += g / 72;
      meanColor[2] += b / 72;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      pixels[i] = Math.round(luma);
      sum += luma;
    }
    return { luma: Math.round((sum / 72) * 10) / 10, phash: hashToHex(dHashFromGray(pixels)), meanColor };
  } catch {
    return null;
  }
}
