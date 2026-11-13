import type Database from "better-sqlite3";
import type { Job } from "@vg/shared";
import type { NodeService } from "./nodeService.js";
import { getRemoteRenderSettings, getRemoteStagesSettings } from "./settings.js";

/**
 * What a non-render stage needs from a node. `null` means the stage stays on this machine:
 * the key is marked "không gửi ra node", is missing, or the job already failed once remotely.
 */
export type StageNeed = { capability: string } | null;

export type PlacementDeps = Pick<NodeService, "hasAvailableRenderNode"> & Partial<Pick<NodeService, "hasAvailableNodeFor">>;

/**
 * May this machine run a queued job itself?
 * off: always. only: never a render. prefer: a render waits up to `remoteWaitSec` for a free node, then runs here.
 *
 * RENDER is unchanged since TASK-118. VOICE and MEDIA_FETCH (TASK-120) default to off. For them `only` means "never here while a
 * node that can do it is available" (a job no node can take, such as one whose key must stay local, still runs here).
 */
export function localMayTake(
  sqlite: Database.Database,
  nodes: PlacementDeps,
  job: Job,
  now: Date,
  stageNeed?: (job: Job) => StageNeed,
): boolean {
  if (job.stage === "VOICE" || job.stage === "MEDIA_FETCH") return localMayTakeStage(sqlite, nodes, job, now, stageNeed);
  if (job.stage !== "RENDER") return true;
  const settings = getRemoteRenderSettings(sqlite);
  if (settings.mode === "off") return true;
  if (settings.mode === "only") return false;
  if (!nodes.hasAvailableRenderNode()) return true;
  const since = Date.parse(job.runAfter > job.createdAt ? job.runAfter : job.createdAt);
  return now.getTime() - since >= settings.remoteWaitSec * 1000;
}

function localMayTakeStage(
  sqlite: Database.Database,
  nodes: PlacementDeps,
  job: Job,
  now: Date,
  stageNeed?: (job: Job) => StageNeed,
): boolean {
  const mode = getRemoteStagesSettings(sqlite)[job.stage as "VOICE" | "MEDIA_FETCH"];
  if (mode === "off") return true;
  if (job.attempt > 1) return true; // a retry after a remote failure runs here
  const need = stageNeed?.(job) ?? null;
  if (!need) return true;
  if (!nodes.hasAvailableNodeFor?.(need.capability)) return true;
  if (mode === "only") return false;
  const since = Date.parse(job.runAfter > job.createdAt ? job.runAfter : job.createdAt);
  return now.getTime() - since >= getRemoteRenderSettings(sqlite).remoteWaitSec * 1000;
}
