import { z } from "zod";
import { isSideJobStage, type PipelineStage } from "./enums.js";

export const STAGE_STATES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "DONE",
  "FAILED",
  "STALE",
  "WAITING_USER",
  "SKIPPED",
] as const;
export const StageStateSchema = z.enum(STAGE_STATES);
export type StageState = z.infer<typeof StageStateSchema>;

export const STAGE_ORDER: readonly PipelineStage[] = [
  "RESEARCH",
  "SCRIPT",
  "SCENE_PLAN",
  "VISUAL_SEARCH",
  "VISUAL_REVIEW",
  "VOICE",
  "SUBTITLE",
  "MUSIC_SEARCH",
  "MUSIC_REVIEW",
  "TIMELINE",
  "FINAL_APPROVAL",
  "RENDER",
];

export const GATES: readonly PipelineStage[] = [
  "VISUAL_REVIEW",
  "MUSIC_REVIEW",
  "FINAL_APPROVAL",
];

export function isGate(stage: PipelineStage): boolean {
  return GATES.includes(stage);
}

export function stagesAfter(stage: PipelineStage): PipelineStage[] {
  const index = STAGE_ORDER.indexOf(stage);
  return index < 0 ? [] : STAGE_ORDER.slice(index + 1);
}

/**
 * What must be DONE or SKIPPED before a stage may start.
 * MUSIC_SEARCH also reads voice-track duration, so VOICE is a real input.
 * SCRIPT mood reaches music through SCENE_PLAN. Visuals are not an input.
 */
export const STAGE_DEPENDS: Record<PipelineStage, readonly PipelineStage[]> = {
  TOPIC: [],
  RESEARCH: [],
  SCRIPT: ["RESEARCH"],
  SCENE_PLAN: ["SCRIPT"],
  VISUAL_SEARCH: ["SCENE_PLAN"],
  VISUAL_REVIEW: ["VISUAL_SEARCH"],
  VOICE: ["SCENE_PLAN"],
  SUBTITLE: ["VOICE"],
  MUSIC_SEARCH: ["SCENE_PLAN", "VOICE"],
  MUSIC_REVIEW: ["MUSIC_SEARCH"],
  TIMELINE: ["VISUAL_REVIEW", "SUBTITLE", "MUSIC_REVIEW"],
  FINAL_APPROVAL: ["TIMELINE"],
  RENDER: ["FINAL_APPROVAL"],
  DONE: ["RENDER"],
  PUBLISH: [],
  CLIP: [],
  ASSISTANT: [],
  MEDIA_FETCH: [],
};

const VISUAL_LANE = new Set<PipelineStage>(["VISUAL_SEARCH", "VISUAL_REVIEW"]);
const AUDIO_LANE = new Set<PipelineStage>(["VOICE", "SUBTITLE", "MUSIC_SEARCH", "MUSIC_REVIEW"]);
const AUDIO_JOBS = new Set<PipelineStage>(["VOICE", "SUBTITLE", "MUSIC_SEARCH"]);

export type StageLane = "visual" | "audio";

export function stageLane(stage: PipelineStage): StageLane | null {
  if (VISUAL_LANE.has(stage)) return "visual";
  if (AUDIO_LANE.has(stage)) return "audio";
  return null;
}

/** Lane of a job that occupies a worker slot. Gates are not jobs. */
export function jobLane(stage: PipelineStage): StageLane | null {
  if (stage === "VISUAL_SEARCH") return "visual";
  if (AUDIO_JOBS.has(stage)) return "audio";
  return null;
}

/** Stages in STAGE_ORDER that depend on `origin`, directly or further down the graph. */
export function dependentStages(origin: PipelineStage): PipelineStage[] {
  const result: PipelineStage[] = [];
  const seen = new Set<PipelineStage>([origin]);
  const queue: PipelineStage[] = [origin];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const stage of STAGE_ORDER) {
      if (seen.has(stage)) continue;
      if (!STAGE_DEPENDS[stage].includes(current)) continue;
      seen.add(stage);
      result.push(stage);
      queue.push(stage);
    }
  }
  return result;
}

export function activeJobsBlockStage(
  stage: PipelineStage,
  jobs: ReadonlyArray<{ stage: PipelineStage; status?: string }>,
): boolean {
  const active = jobs.filter((job) => {
    if (isSideJobStage(job.stage)) return false;
    return job.status === undefined || job.status === "QUEUED" || job.status === "RUNNING";
  });
  if (active.length === 0) return false;
  const lane = stageLane(stage);
  if (lane === null) return true;
  return active.some((job) => {
    const other = jobLane(job.stage);
    return other === null || other === lane;
  });
}
