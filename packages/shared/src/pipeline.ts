import { z } from "zod";
import type { PipelineStage } from "./enums.js";

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
