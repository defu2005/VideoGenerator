/** TASK-126: decide per scene whether VISUAL_SEARCH may reuse stored candidates and skip the scene. */

/** Candidates sent to the vision model per scene (and per web pass). */
export const VISION_BATCH_SIZE = 5;

export type SceneReusePlan = {
  /** The search hash matches: stored candidates are reused, providers are not searched again. */
  reuseCandidates: boolean;
  /** Vision is required but none of the top stored candidates was ever vision-checked. */
  needsVerify: boolean;
  /** Nothing to do for this scene in this run. */
  skip: boolean;
};

export function planSceneReuse(input: {
  hashMatches: boolean;
  visionRequired: boolean;
  protectedSelection: boolean;
  /** The scene already has a selection whose candidate passes the gate. */
  hasValidSelection: boolean;
  /** For the top K stored candidates (best first): does each have a vision result? */
  topCandidatesVisionChecked: readonly boolean[];
}): SceneReusePlan {
  if (!input.hashMatches) return { reuseCandidates: false, needsVerify: false, skip: false };
  const needsVerify = input.visionRequired
    && !input.protectedSelection
    && !input.hasValidSelection
    && !input.topCandidatesVisionChecked.slice(0, VISION_BATCH_SIZE).some(Boolean);
  return { reuseCandidates: true, needsVerify, skip: !needsVerify };
}
