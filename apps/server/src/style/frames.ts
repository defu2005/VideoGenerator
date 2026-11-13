import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hashImage } from "../services/imageHash.js";

/**
 * dHash of frames the render already wrote into `thumbs`.
 * `hashImage` scales each JPEG to 9×8 grey and calls `dHashFromGray` in `packages/shared/src/visuals/phash.ts`.
 * A file that is not a JPEG is skipped, so a placeholder thumb does not start ffmpeg.
 */
export async function frameHashesFromThumbs(thumbsDir: string, sceneIds: string[]): Promise<string[]> {
  const hashes = await Promise.all(sceneIds.slice(0, 64).map(async (sceneId) => {
    const file = join(thumbsDir, `${sceneId}.jpg`);
    if (!existsSync(file)) return null;
    let header: Buffer;
    try {
      header = readFileSync(file).subarray(0, 3);
    } catch {
      return null;
    }
    if (header[0] !== 0xff || header[1] !== 0xd8) return null;
    const hashed = await hashImage(file);
    return hashed?.phash ?? null;
  }));
  return hashes.filter((hash): hash is string => typeof hash === "string");
}
