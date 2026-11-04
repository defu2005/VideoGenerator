import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { downscaleForVision } from "../../media/ffmpeg.js";
import { LlmError, type LlmImageAttachment } from "./types.js";

export type PreparedVisionImage = {
  label: string;
  path: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64: string;
  contentHash: string;
};

/** Resize each attachment to ≤768px JPEG and return base64 + content hash for the cache key. */
export async function prepareVisionImages(
  images: LlmImageAttachment[] | undefined,
  cacheDir: string,
  signal?: AbortSignal,
): Promise<PreparedVisionImage[]> {
  if (!images?.length) return [];
  mkdirSync(cacheDir, { recursive: true });
  const prepared: PreparedVisionImage[] = [];
  for (const image of images) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!existsSync(image.path)) {
      throw new LlmError(`Vision image missing: ${image.path}`, "LLM_BAD_REQUEST", false);
    }
    const hash = createHash("sha256").update(readFileSync(image.path)).digest("hex").slice(0, 16);
    const dest = join(cacheDir, `${hash}.jpg`);
    try {
      await downscaleForVision(image.path, dest, signal);
    } catch (error) {
      if (error instanceof LlmError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT|not found|ffmpeg/i.test(message)) {
        throw new LlmError(
          "FFmpeg is required to resize images for vision checks. Set FFMPEG_PATH or install ffmpeg-static.",
          "FFMPEG_MISSING",
          false,
        );
      }
      throw error;
    }
    const bytes = readFileSync(dest);
    prepared.push({
      label: image.label,
      path: dest,
      mimeType: "image/jpeg",
      base64: bytes.toString("base64"),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return prepared;
}

export function visionCacheKeyExtra(images: PreparedVisionImage[]): string {
  if (!images.length) return "";
  return images.map((image) => `${image.label}:${image.contentHash}`).join("|");
}

export function mimeFromPath(filePath: string): PreparedVisionImage["mimeType"] {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

export function safeImageFileName(label: string, index: number): string {
  const cleaned = label.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || `image-${index}`;
  return `${cleaned}${extname(cleaned) ? "" : ".jpg"}`;
}

export function describeImagesForPrompt(images: PreparedVisionImage[]): string {
  if (!images.length) return "";
  return [
    "Attached images (use the labels when referring to them):",
    ...images.map((image, index) => `- ${image.label} (file ${basename(image.path)}, #${index + 1})`),
  ].join("\n");
}
