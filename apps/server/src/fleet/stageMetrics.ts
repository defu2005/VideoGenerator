import type Database from "better-sqlite3";
import { PROTECTED_PROJECT_ID, resolveAgentWaitMinutes, type PipelineStage, type StageExecutionBrief } from "@vg/shared";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import { listAgentAssignments, matchingStageAssignment } from "../agents/assignments.js";

export function fleetStageMetrics(db: Database.Database, workspace: string | null, now: Date) {
  const ownsLegacy = workspace === defaultWorkspaceId(db);
  const assignments = workspace ? listAgentAssignments(db, workspace) : [];
  const instances = [...new Set(assignments.filter((row) => row.active).map((row) => row.instance))];
  const pending = db.prepare(`SELECT j.stage,j.handoff_at AS handoffAt,p.id,p.profile_id AS profileId,p.settings,pr.default_brief AS brief
    FROM jobs j JOIN projects p ON p.id=j.project_id LEFT JOIN profiles pr ON pr.id=p.profile_id
    WHERE j.executor='agent' AND j.status='QUEUED' AND p.id!=? AND (p.workspace_id=? OR (p.workspace_id IS NULL AND ?))`)
    .all(PROTECTED_PROJECT_ID, workspace, Number(ownsLegacy)) as Array<{ stage: PipelineStage; handoffAt: string; id: string; profileId: string | null; settings: string; brief: string | null }>;
  const queue = new Map<string, number>();
  let needsVisualScout = false;
  for (const row of pending) {
    const roles = new Set(instances.flatMap((instance) => matchingStageAssignment(assignments, instance, row, row.stage)?.role ?? []));
    if (!roles.size) roles.add(row.stage === "VISUAL_SEARCH" ? "visual_scout" : "Chưa phân công");
    for (const role of roles) queue.set(role, (queue.get(role) ?? 0) + 1);
    if (row.stage === "VISUAL_SEARCH") {
      const settings = JSON.parse(row.settings) as StageExecutionBrief;
      const profileBrief = JSON.parse(row.brief ?? "{}") as StageExecutionBrief | null;
      const minutes = resolveAgentWaitMinutes(settings, profileBrief ?? {});
      if (now.getTime() - Date.parse(row.handoffAt) > minutes * 30_000) needsVisualScout = true;
    }
  }
  const claimedJobs = db.prepare(`SELECT j.agent_instance AS instance,COUNT(*) AS count FROM jobs j JOIN projects p ON p.id=j.project_id
    WHERE j.executor='agent' AND j.status='RUNNING' AND j.lease_until>? AND p.id!=?
    AND (p.workspace_id=? OR (p.workspace_id IS NULL AND ?)) GROUP BY j.agent_instance ORDER BY j.agent_instance`)
    .all(now.toISOString(), PROTECTED_PROJECT_ID, workspace, Number(ownsLegacy)) as Array<{ instance: string; count: number }>;
  const completed = db.prepare(`SELECT j.started_at AS startedAt,j.finished_at AS finishedAt,
    (SELECT COUNT(DISTINCT v.scene_id) FROM visual_selections v JOIN visual_candidates c ON c.id=v.candidate_id
      WHERE v.project_id=p.id AND v.selected_by='AGENT' AND c.origin='agent' AND v.updated_at>=j.started_at AND v.updated_at<=j.finished_at) AS scenes
    FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.executor='agent' AND j.agent_instance IS NOT NULL
    AND j.stage='VISUAL_SEARCH' AND j.status='SUCCEEDED' AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
    AND p.id!=? AND (p.workspace_id=? OR (p.workspace_id IS NULL AND ?)) ORDER BY j.finished_at DESC LIMIT 100`)
    .all(PROTECTED_PROJECT_ID, workspace, Number(ownsLegacy)) as Array<{ startedAt: string; finishedAt: string; scenes: number }>;
  const samples = completed.flatMap((row) => row.scenes > 0 ? [(Date.parse(row.finishedAt) - Date.parse(row.startedAt)) / (1000 * row.scenes)] : [])
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0).sort((a, b) => a - b);
  const middle = Math.floor(samples.length / 2);
  const medianSecondsPerScene = samples.length === 0 ? null : (samples[middle]! + samples[Math.floor((samples.length - 1) / 2)]!) / 2;
  return { queueByRole: [...queue].map(([role, count]) => ({ role, count })), claimedJobs, medianSecondsPerScene, sampleJobs: samples.length, needsVisualScout };
}
