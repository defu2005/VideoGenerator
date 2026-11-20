import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AgentAssignmentInputSchema, PROTECTED_PROJECT_ID, type AgentAssignment, type PipelineStage } from "@vg/shared";
import type { AuthActor } from "../auth/actor.js";
import { can } from "../auth/policy.js";
import { AppError } from "../lib/errors.js";

type AssignmentRow = Omit<AgentAssignment, "active"> & { active: number };
const columns = `id, instance, role, profile_id AS profileId, project_id AS projectId,
  stage, max_concurrent AS maxConcurrent, active, created_by AS createdBy`;
const assignmentFromRow = (row: AssignmentRow): AgentAssignment => ({ ...row, active: row.active === 1 });

export function listAgentAssignments(db: Database.Database, workspaceId: string): AgentAssignment[] {
  return (db.prepare(`SELECT ${columns} FROM agent_assignments WHERE workspace_id=? ORDER BY rowid`)
    .all(workspaceId) as AssignmentRow[]).map(assignmentFromRow);
}

export function assignedRoles(assignments: readonly AgentAssignment[], instance: string): Set<string> {
  return new Set(assignments.filter((assignment) => assignment.active
    && (assignment.instance === instance || assignment.instance === "*")).map((assignment) => assignment.role));
}

type StageTarget = { id: string; profileId?: string | null };

function specificity(assignment: AgentAssignment) {
  return (assignment.projectId ? 8 : 0) + (assignment.profileId ? 4 : 0) + (assignment.stage ? 2 : 0) + (assignment.instance === "*" ? 0 : 1);
}

/** Channel managers use the profile/project control lease. Scouts independently use the stage job fence. */
export function matchingStageAssignment(assignments: readonly AgentAssignment[], instance: string, project: StageTarget, stage: PipelineStage, role?: string) {
  return assignments.filter((assignment) => assignment.active
    && assignment.role !== "channel_manager"
    && (role === undefined || assignment.role === role)
    && (assignment.instance === instance || assignment.instance === "*")
    && (assignment.projectId === null || assignment.projectId === project.id)
    && (assignment.profileId === null || assignment.profileId === project.profileId)
    && (assignment.stage === null || assignment.stage === stage))
    .sort((a, b) => specificity(b) - specificity(a) || a.maxConcurrent - b.maxConcurrent)[0];
}

export function requireAssignmentUser(actor: AuthActor | undefined): asserts actor is AuthActor {
  if (actor?.kind !== "user" || !can(actor, "settings.write").ok) {
    throw new AppError(403, "ASSIGNMENT_USER_ONLY", "Chỉ người dùng có quyền quản lý cài đặt được quản lý phân công agent.");
  }
}

function requireScope(db: Database.Database, actor: AuthActor, profileId: string | null, projectId: string | null) {
  const visible = (workspaceId: string | null) => workspaceId === actor.workspaceId || (workspaceId === null && actor.ownsUnassigned);
  const missing = () => new AppError(404, "ASSIGNMENT_SCOPE_NOT_FOUND", "Không thấy hồ sơ hoặc dự án trong workspace.");
  if (profileId) {
    const profile = db.prepare("SELECT workspace_id FROM profiles WHERE id=?").get(profileId) as { workspace_id: string | null } | undefined;
    if (!profile || !visible(profile.workspace_id)) throw missing();
  }
  if (projectId) {
    const project = db.prepare("SELECT workspace_id,profile_id FROM projects WHERE id=?").get(projectId) as { workspace_id: string | null; profile_id: string | null } | undefined;
    if (!project || projectId === PROTECTED_PROJECT_ID || !visible(project.workspace_id) || (profileId && profileId !== project.profile_id)) throw missing();
  }
}

export function saveAgentAssignment(db: Database.Database, actor: AuthActor | undefined, input: unknown, id?: string): AgentAssignment {
  requireAssignmentUser(actor);
  const value = AgentAssignmentInputSchema.parse(input);
  return db.transaction(() => {
    requireScope(db, actor, value.profileId, value.projectId);
    const values = [value.instance, value.role, value.profileId, value.projectId, value.stage, value.maxConcurrent, Number(value.active)];
    const assignmentId = id ?? randomUUID();
    if (id) {
      const result = db.prepare(`UPDATE agent_assignments SET instance=?,role=?,profile_id=?,project_id=?,stage=?,max_concurrent=?,active=? WHERE id=? AND workspace_id=?`)
        .run(...values, id, actor.workspaceId);
      if (!result.changes) throw new AppError(404, "ASSIGNMENT_NOT_FOUND", "Không thấy phân công trong workspace.");
    } else {
      db.prepare(`INSERT INTO agent_assignments (instance,role,profile_id,project_id,stage,max_concurrent,active,id,workspace_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(...values, assignmentId, actor.workspaceId, actor.userId);
    }
    return assignmentFromRow(db.prepare(`SELECT ${columns} FROM agent_assignments WHERE id=?`).get(assignmentId) as AssignmentRow);
  }).immediate();
}
