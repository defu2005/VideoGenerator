import { parseImage } from "./imageStore.js";

export const VISION_MIN_SIDE_PX = 64;
export const VISION_MIN_BYTES = 2 * 1024;

/** Images this small are not sent to a vision model. */
export function visionSourceProblem(bytes: Buffer): "invalid_source" | null {
  if (bytes.byteLength < VISION_MIN_BYTES) return "invalid_source";
  try {
    const image = parseImage(bytes);
    if (Math.min(image.width, image.height) < VISION_MIN_SIDE_PX) return "invalid_source";
  } catch {
    return "invalid_source";
  }
  return null;
}
