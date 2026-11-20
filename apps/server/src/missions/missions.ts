import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { PROTECTED_PROJECT_ID } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { publishAgentEvent } from "../events/agentBus.js";
import { autonomySettings } from "../operator/autonomy.js";

// TASK-129c slice 1: mission state, transitions, ownership and handover. Pure state rules live here;
// the duty module and the routes call in. No LLM is called from this file: the orchestrator writes the plan.

export const MISSION_STATES = ["planning", "producing", "waiting_user", "scheduled", "published", "measuring", "done", "failed", "cancelled"] as const;
export type MissionState = (typeof MISSION_STATES)[number];
export const TERMINAL_STATES: ReadonlySet<MissionState> = new Set<MissionState>(["done", "failed", "cancelled"]);

/** Legal moves only. Anything not listed throws MISSION_ILLEGAL_TRANSITION. Cancel is allowed only before publishing. */
const TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  planning: ["producing", "cancelled", "failed"],
  producing: ["waiting_user", "scheduled", "cancelled", "failed"],
  waiting_user: ["producing", "cancelled", "failed"],
  scheduled: ["published", "cancelled", "failed"],
  published: ["measuring", "done", "failed"],
  measuring: ["done", "failed"],
  done: [],
  failed: [],
  cancelled: [],
};

const AUTONOMY_ORDER = ["off", "assist", "supervised", "autonomous"] as const;
export type MissionAutonomy = (typeof AUTONOMY_ORDER)[number];

export const MAX_PLAN_STEPS = 50;
export const MAX_MISSION_PROJECTS = 20;

export type MissionRow = {
  id: string; workspaceId: string; createdBy: string; command: string; channelProfileId: string | null;
  projectIds: string[]; plan: Array<Record<string, unknown>>; state: MissionState; owner: string | null;
  autonomyLevel: MissionAutonomy; deadline: string | null; budgetUsd: number | null; report: string | null;
  createdAt: string; updatedAt: string;
};

type Raw = {
  id: string; workspace_id: string; created_by: string; command: string; channel_profile_id: string | null;
  project_ids: string; plan: string; state: string; owner: string | null; autonomy_level: string;
  deadline: string | null; budget_usd: number | null; report: string | null; created_at: string; updated_at: string;
};

function toRow(raw: Raw): MissionRow {
  return {
    id: raw.id, workspaceId: raw.workspace_id, createdBy: raw.created_by, command: raw.command,
    channelProfileId: raw.channel_profile_id, projectIds: JSON.parse(raw.project_ids) as string[],
    plan: JSON.parse(raw.plan) as Array<Record<string, unknown>>, state: raw.state as MissionState, owner: raw.owner,
    autonomyLevel: raw.autonomy_level as MissionAutonomy, deadline: raw.deadline, budgetUsd: raw.budget_usd,
    report: raw.report, createdAt: raw.created_at, updatedAt: raw.updated_at,
  };
}

/** Throws unless `from -> to` is a legal move. Pure, so the table can be tested alone. */
export function assertTransition(from: MissionState, to: MissionState): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(409, "MISSION_ILLEGAL_TRANSITION", `Không thể chuyển mission từ ${from} sang ${to}.`);
  }
}

export function canTransition(from: MissionState, to: MissionState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Protected project: no mission may touch it, whatever the profile allows. */
export function assertNotProtected(projectIds: readonly string[]): void {
  if (projectIds.includes(PROTECTED_PROJECT_ID)) {
    throw new AppError(403, "MISSION_PROTECTED_PROJECT", "Dự án này được bảo vệ; mission không được chạm vào.");
  }
}

/** A mission may not run above the profile maximum the user set. */
export function assertAutonomyWithin(requested: MissionAutonomy, maximum: MissionAutonomy): void {
  if (AUTONOMY_ORDER.indexOf(requested) > AUTONOMY_ORDER.indexOf(maximum)) {
    throw new AppError(422, "MISSION_AUTONOMY_ABOVE_PROFILE", "Mức tự chủ của mission vượt quá mức tối đa của hồ sơ.");
  }
}

/** Projects and the channel profile must exist in this workspace (fails closed; other workspaces look like missing). */
export function assertWorkspaceRefs(sqlite: Database.Database, workspaceId: string, projectIds: readonly string[], channelProfileId: string | null): void {
  for (const projectId of projectIds) {
    const row = sqlite.prepare("SELECT id FROM projects WHERE id = ? AND workspace_id = ?").get(projectId, workspaceId);
    if (!row) throw new AppError(422, "MISSION_UNKNOWN_PROJECT", "Dự án không tồn tại trong workspace này.");
  }
  if (channelProfileId) {
    const row = sqlite.prepare("SELECT id FROM profiles WHERE id = ? AND workspace_id = ?").get(channelProfileId, workspaceId);
    if (!row) throw new AppError(422, "MISSION_UNKNOWN_PROFILE", "Hồ sơ kênh không tồn tại trong workspace này.");
  }
}

export function getMission(sqlite: Database.Database, workspaceId: string, id: string): MissionRow {
  const raw = sqlite.prepare("SELECT * FROM missions WHERE id = ? AND workspace_id = ?").get(id, workspaceId) as Raw | undefined;
  if (!raw) throw new AppError(404, "MISSION_NOT_FOUND", "Không tìm thấy mission trong workspace này.");
  return toRow(raw);
}

export function listMissions(sqlite: Database.Database, workspaceId: string, limit = 50): MissionRow[] {
  return (sqlite.prepare("SELECT * FROM missions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(workspaceId, limit) as Raw[]).map(toRow);
}

export type CreateMissionInput = {
  command: string; channelProfileId?: string | null; projectIds?: string[]; autonomyLevel?: MissionAutonomy;
  deadline?: string | null; budgetUsd?: number | null;
};

/** The owner is passed in by the caller (the current duty holder, or null when nobody holds duty). */
export function createMission(
  sqlite: Database.Database, workspaceId: string, input: CreateMissionInput,
  context: { createdBy: string; owner: string | null; now?: Date },
): MissionRow {
  const projectIds = [...new Set(input.projectIds ?? [])];
  if (projectIds.length > MAX_MISSION_PROJECTS) throw new AppError(422, "MISSION_TOO_MANY_PROJECTS", "Mission có quá nhiều dự án.");
  assertNotProtected(projectIds);
  const channelProfileId = input.channelProfileId ?? null;
  assertWorkspaceRefs(sqlite, workspaceId, projectIds, channelProfileId);
  const maximum = autonomySettings(sqlite, channelProfileId ?? undefined).level as MissionAutonomy;
  const autonomyLevel = input.autonomyLevel ?? maximum;
  assertAutonomyWithin(autonomyLevel, maximum);
  const now = (context.now ?? new Date()).toISOString();
  const id = randomUUID();
  sqlite.prepare(`INSERT INTO missions (id, workspace_id, created_by, command, channel_profile_id, project_ids, plan, state, owner,
      autonomy_level, deadline, budget_usd, report, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', 'planning', ?, ?, ?, ?, NULL, ?, ?)`)
    .run(id, workspaceId, context.createdBy, input.command, channelProfileId, JSON.stringify(projectIds),
      context.owner, autonomyLevel, input.deadline ?? null, input.budgetUsd ?? null, now, now);
  const mission = getMission(sqlite, workspaceId, id);
  publishAgentEvent({ type: "mission_created", summary: `Mission mới: ${input.command.slice(0, 80)}`, link: `/missions/${id}` }, { workspaceId });
  return mission;
}

function requireOwner(mission: MissionRow, instance: string): void {
  if (mission.owner !== instance) throw new AppError(403, "MISSION_NOT_OWNER", "Chỉ agent đang giữ mission mới được ghi.");
}

/** Owner writes the plan (replaces the whole list). Allowed only while planning. */
export function setMissionPlan(
  sqlite: Database.Database, workspaceId: string, id: string, instance: string, steps: Array<Record<string, unknown>>, now = new Date(),
): MissionRow {
  if (steps.length > MAX_PLAN_STEPS) throw new AppError(422, "MISSION_PLAN_TOO_LONG", "Kế hoạch có quá nhiều bước.");
  const mission = getMission(sqlite, workspaceId, id);
  requireOwner(mission, instance);
  if (mission.state !== "planning") throw new AppError(409, "MISSION_NOT_PLANNING", "Chỉ ghi kế hoạch khi mission đang planning.");
  sqlite.prepare("UPDATE missions SET plan = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(steps), now.toISOString(), id);
  return getMission(sqlite, workspaceId, id);
}

/** Owner attaches a project. Protected and foreign-workspace projects are refused. */
export function attachMissionProject(
  sqlite: Database.Database, workspaceId: string, id: string, instance: string, projectId: string, now = new Date(),
): MissionRow {
  const mission = getMission(sqlite, workspaceId, id);
  requireOwner(mission, instance);
  assertNotProtected([projectId]);
  assertWorkspaceRefs(sqlite, workspaceId, [projectId], null);
  if (TERMINAL_STATES.has(mission.state)) throw new AppError(409, "MISSION_CLOSED", "Mission đã đóng.");
  const projectIds = [...new Set([...mission.projectIds, projectId])];
  if (projectIds.length > MAX_MISSION_PROJECTS) throw new AppError(422, "MISSION_TOO_MANY_PROJECTS", "Mission có quá nhiều dự án.");
  sqlite.prepare("UPDATE missions SET project_ids = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(projectIds), now.toISOString(), id);
  return getMission(sqlite, workspaceId, id);
}

/**
 * Agent move. The owner may only start its own planning (planning -> producing) or fail a mission.
 * Every other edge belongs to the app tick, so an agent can never clear a user gate or publish by itself.
 */
export function moveMissionByAgent(
  sqlite: Database.Database, workspaceId: string, id: string, instance: string, to: MissionState, now = new Date(),
): MissionRow {
  const mission = getMission(sqlite, workspaceId, id);
  requireOwner(mission, instance);
  const allowed = (mission.state === "planning" && to === "producing") || (to === "failed" && !TERMINAL_STATES.has(mission.state));
  if (!allowed) throw new AppError(403, "MISSION_AGENT_MOVE_FORBIDDEN", "Agent chỉ được bắt đầu mission (planning → producing) hoặc đánh dấu lỗi.");
  return applyState(sqlite, mission, to, now);
}

/** The user may cancel any open mission in the workspace. Ownership is not required. */
export function cancelMission(sqlite: Database.Database, workspaceId: string, id: string, now = new Date()): MissionRow {
  const mission = getMission(sqlite, workspaceId, id);
  return sqlite.transaction(() => {
    // Cancelling a scheduled mission withdraws its queued publications. The executor refuses CANCELLED rows (PUBLISH_INACTIVE).
    // Uploads already in progress are left alone: they may already be on the platform.
    if (mission.state === "scheduled") {
      sqlite.prepare("UPDATE publications SET status = 'CANCELLED', updated_at = ? WHERE mission_id = ? AND status IN ('QUEUED', 'SCHEDULED')")
        .run(now.toISOString(), id);
    }
    return applyState(sqlite, mission, "cancelled", now);
  })();
}

/** Every state change, from any path (user, agent, checkpoint tick), reaches agents through this one event. */
export function emitMissionStateChanged(workspaceId: string, missionId: string, from: string, to: string): void {
  publishAgentEvent({ type: "mission_state_changed", summary: `Mission ${from} → ${to}`, link: `/missions/${missionId}` }, { workspaceId });
}

function applyState(sqlite: Database.Database, mission: MissionRow, to: MissionState, now: Date): MissionRow {
  assertTransition(mission.state, to);
  sqlite.prepare("UPDATE missions SET state = ?, updated_at = ? WHERE id = ?").run(to, now.toISOString(), mission.id);
  emitMissionStateChanged(mission.workspaceId, mission.id, mission.state, to);
  return getMission(sqlite, mission.workspaceId, mission.id);
}

/**
 * Duty handover: every open mission whose owner is not `toInstance` (including unowned ones) moves to the new holder.
 * Runs in one transaction; events are published only after it commits. Terminal missions keep their owner.
 */
export function handOverMissions(sqlite: Database.Database, toInstance: string, now = new Date()): number {
  const closed = [...TERMINAL_STATES];
  const placeholders = closed.map(() => "?").join(",");
  const candidates = sqlite.prepare(
    `SELECT id, workspace_id FROM missions WHERE state NOT IN (${placeholders}) AND (owner IS NULL OR owner != ?)`,
  ).all(...closed, toInstance) as Array<{ id: string; workspace_id: string }>;
  if (!candidates.length) return 0;
  const update = sqlite.prepare("UPDATE missions SET owner = ?, updated_at = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const row of candidates) update.run(toInstance, now.toISOString(), row.id);
  })();
  for (const row of candidates) {
    publishAgentEvent({
      type: "mission_owner_changed", summary: `Mission ${row.id.slice(0, 8)} chuyển cho ${toInstance}.`, link: `/missions/${row.id}`,
    }, { workspaceId: row.workspace_id });
  }
  return candidates.length;
}
