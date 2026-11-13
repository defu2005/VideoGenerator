import {
  clampStageTimeoutMs,
  isPlannedTimeoutStage,
  type Project,
  type ProjectSettings,
  type StageTimeoutPlan,
} from "@vg/shared";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";

export type ClampedStageTimeout = {
  requestedMinutes: number;
  minutes: number;
  timeoutMs: number;
};

export function writeStageTimeoutStages(
  sqlite: Database.Database,
  project: Project,
  mutate: (stages: StageTimeoutPlan["stages"]) => void,
): void {
  const stages = { ...(project.settings.stageTimeouts?.stages ?? {}) };
  mutate(stages);
  const settings: ProjectSettings = {
    ...project.settings,
    stageTimeouts: {
      source: Object.values(stages).some((entry) => entry.source === "user")
        ? "mixed"
        : project.settings.stageTimeouts?.source ?? "baseline",
      inputHash: project.settings.stageTimeouts?.inputHash ?? "",
      summary: project.settings.stageTimeouts?.summary ?? "Bạn chỉnh một bước.",
      stages,
    },
  };
  sqlite.prepare("UPDATE projects SET settings = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(settings), new Date().toISOString(), project.id);
}

export function stageTimeoutMinutes(
  project: Project,
  minutesByStage: Record<string, number>,
): { stages: StageTimeoutPlan["stages"]; clamped: Record<string, ClampedStageTimeout> } {
  const names = Object.keys(minutesByStage);
  if (names.length < 1 || names.length > 11) {
    throw new AppError(400, "INVALID_STAGE_TIMEOUTS", "Chỉ nhận từ 1 đến 11 bước.");
  }
  const stages = { ...(project.settings.stageTimeouts?.stages ?? {}) };
  const clamped: Record<string, ClampedStageTimeout> = {};
  for (const stage of names) {
    if (!isPlannedTimeoutStage(stage)) {
      throw new AppError(400, "UNKNOWN_STAGE", `Bước không có thời gian tối đa riêng: ${stage}.`);
    }
    const requestedMinutes = minutesByStage[stage]!;
    const timeoutMs = clampStageTimeoutMs(stage, Math.round(requestedMinutes * 60_000));
    stages[stage] = { timeoutMs, reason: "Bạn chọn.", source: "user" };
    clamped[stage] = { requestedMinutes, minutes: timeoutMs / 60_000, timeoutMs };
  }
  return { stages, clamped };
}
