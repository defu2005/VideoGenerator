import { VISION_IMAGE_TOKEN_ESTIMATE } from "@vg/shared";

export function estimateTokens(text: string, json = false): number {
  const charsPerToken = /[^\u0000-\u007f]/.test(text) ? 3 : 4;
  const estimate = Math.ceil(text.length / charsPerToken);
  return json ? Math.ceil(estimate * 1.15) : estimate;
}

/**
 * Fixed per-image input estimate for ≤768 px vision JPEGs.
 * Documented constant: {@link VISION_IMAGE_TOKEN_ESTIMATE} (= 1000).
 */
export function estimateVisionImageTokens(imageCount: number): number {
  return Math.max(0, imageCount) * VISION_IMAGE_TOKEN_ESTIMATE;
}

export function estimatePromptTokens(text: string, imageCount = 0, json = false): number {
  return estimateTokens(text, json) + estimateVisionImageTokens(imageCount);
}
