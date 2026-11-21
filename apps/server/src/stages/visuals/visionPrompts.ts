import {
  VisionCheckBatchSchema,
  VisionConsistencySchema,
  VisionResearchSchema,
  type VisionCheckBatch,
  type VisionConsistency,
  type VisionResearch,
} from "@vg/shared";

export { VisionCheckBatchSchema, VisionConsistencySchema, VisionResearchSchema };
export type { VisionCheckBatch, VisionConsistency, VisionResearch };

export function buildVisionCheckPrompt(input: {
  narration: string;
  visualDescription: string;
  aspectRatio: string;
  images: { label: string }[];
  /** TASK-146: the beat's visual intent and purpose. Added to the prompt only when present. */
  visualIntent?: string;
  beatPurpose?: string;
}): { system: string; prompt: string } {
  const beat = Boolean(input.visualIntent || input.beatPurpose);
  const instruction = beat
    ? "For each image label, return fit (0-10), depicts, issues[], cropOk. The image must show visualIntent for this beat (beatPurpose says what the shot is for). An image that does not show visualIntent is wrong_subject."
    : "For each image label, return fit (0-10), depicts, issues[], cropOk.";
  return {
    system: [
      "You are a vision model checking whether candidate images fit a video scene.",
      "Score each labelled image from 0–10 for fit to the narration and visual description.",
      "For issues use only: watermark, text_overlay, wrong_subject, wrong_era, low_quality, collage, nsfw, logo_only.",
      "Return only schema fields (label, fit, depicts, issues, cropOk, optional subject). No other keys.",
      "Put other problems in depicts as a short phrase.",
      "When you can see the main subject, add subject as fractions of the image: x, y, width, height.",
      "Return JSON only matching the schema.",
    ].join(" "),
    prompt: JSON.stringify({
      narration: input.narration,
      visualDescription: input.visualDescription,
      aspectRatio: input.aspectRatio,
      ...(input.visualIntent ? { visualIntent: input.visualIntent } : {}),
      ...(input.beatPurpose ? { beatPurpose: input.beatPurpose } : {}),
      images: input.images,
      instruction,
    }, null, 2),
  };
}

export function buildVisionResearchPrompt(input: {
  narration: string;
  visualDescription: string;
  depicts: string;
  issues: string[];
  previousQueries: string[];
}): { system: string; prompt: string } {
  return {
    system: "Suggest up to 3 new English image-search queries from vision feedback. Return JSON only.",
    prompt: JSON.stringify({
      narration: input.narration,
      visualDescription: input.visualDescription,
      visionDepicts: input.depicts,
      visionIssues: input.issues,
      previousQueries: input.previousQueries,
    }, null, 2),
  };
}

export function buildVisionConsistencyPrompt(input: {
  scenes: { sceneId: string; label: string; visualDescription: string; imageLabel: string }[];
}): { system: string; prompt: string } {
  return {
    system: [
      "Compare the selected scene images for inconsistent style or era, and accidental duplicates.",
      "Flag only clear problems. Return JSON with flags[{sceneId, reason, kind}].",
    ].join(" "),
    prompt: JSON.stringify({ scenes: input.scenes }, null, 2),
  };
}
