import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { isGate, ProjectRunSchema, PROTECTED_PROJECT_ID, STAGE_DEPENDS, STAGE_ORDER, type PipelineStage, type ProjectRun } from "@vg/shared";
import { z } from "zod";
import { currentActor } from "../auth/requestContext.js";
import { can } from "../auth/policy.js";
import { defaultWorkspaceId } from "../auth/workspaces.js";
import { AppError } from "../lib/errors.js";
import { projectRunBaseVersion } from "./projectSnapshot.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { NodeRow } from "./nodeService.js";

const activeStatuses = "('GRANTED','RUNNING')";
const columns = `id,project_id AS projectId,workspace_id AS workspaceId,node_id AS nodeId,lease_id AS leaseId,
  lease_until AS leaseUntil,heartbeat_at AS heartbeatAt,status,from_stage AS fromStage,stop_before AS stopBefore,
  base_version AS baseVersion,last_seq AS lastSeq,budget_cap_usd AS budgetCapUsd,created_at AS createdAt,ended_at AS endedAt,end_reason AS endReason`;

function asRun(value: unknown): ProjectRun | undefined {
  if (!value) return undefined;
  const row = value as Record<string, unknown>;
  return ProjectRunSchema.parse({ ...row, stopBefore: JSON.parse(String(row.stopBefore)) });
}

/** All run transitions use control's clock and the persisted node identity. */
export class ProjectRunService {
  constructor(private readonly db: Database.Database, private readonly orchestrator: PipelineOrchestrator,
    private readonly now: () => Date = () => new Date(), private readonly ttlMs = 90_000) {}

  get(runId: string): ProjectRun | undefined {
    return asRun(this.db.prepare(`SELECT ${columns} FROM project_runs WHERE id=?`).get(runId));
  }

  private persistedNode(node: Pick<NodeRow, "id">) {
    const stored = this.db.prepare("SELECT * FROM nodes WHERE id=? AND revoked_at IS NULL").get(node.id) as NodeRow | undefined;
    if (!stored) throw new AppError(401, "NODE_UNAUTHORIZED", "Máy worker đã bị thu hồi hoặc không tồn tại.");
    return stored;
  }

  grant(node: Pick<NodeRow, "id">, input: { projectId: string; fromStage: PipelineStage; stopBefore: PipelineStage[]; budgetCapUsd: number }): ProjectRun {
    z.number().finite().nonnegative().parse(input.budgetCapUsd);
    if (!STAGE_ORDER.includes(input.fromStage) || input.stopBefore.some((stage) => !STAGE_ORDER.includes(stage))) {
      throw new AppError(400, "RUN_STAGE_INVALID", "Bước bắt đầu hoặc điểm dừng không thuộc pipeline.");
    }
    return this.db.transaction(() => {
      const stored = this.persistedNode(node);
      const project = this.orchestrator.repository.getProject(input.projectId);
      const row = this.db.prepare("SELECT workspace_id FROM projects WHERE id=?").get(input.projectId) as { workspace_id: string | null } | undefined;
      const workspace = row?.workspace_id ?? defaultWorkspaceId(this.db);
      if (!project || !workspace || input.projectId === PROTECTED_PROJECT_ID || (stored.workspace_id && stored.workspace_id !== workspace)) {
        throw new AppError(404, "RUN_PROJECT_NOT_FOUND", "Không thấy dự án được phép giao cho máy này.");
      }
      const actor = currentActor();
      if (actor && !can(actor, "stage.run", { workspaceId: workspace, profileId: project.profileId }).ok) {
        throw new AppError(404, "RUN_PROJECT_NOT_FOUND", "Không thấy dự án trong phạm vi được phép.");
      }
      this.expire();
      const active = this.db.prepare(`SELECT 1 FROM project_runs WHERE project_id=? AND status IN ${activeStatuses}`).get(project.id);
      if (active || this.orchestrator.repository.getActiveJobs(project.id).length) {
        throw new AppError(409, "RUN_PROJECT_BUSY", "Dự án đang có việc hoặc một lần chạy còn hiệu lực.");
      }
      const at = this.now().toISOString();
      const run = ProjectRunSchema.parse({
        id: randomUUID(), projectId: project.id, workspaceId: workspace, nodeId: stored.id, leaseId: randomUUID(),
        leaseUntil: new Date(this.now().getTime() + this.ttlMs).toISOString(), heartbeatAt: at, status: "GRANTED",
        fromStage: input.fromStage, stopBefore: [...new Set(input.stopBefore)], baseVersion: this.baseVersion(project.id),
        lastSeq: 0, budgetCapUsd: input.budgetCapUsd, createdAt: at, endedAt: null, endReason: null,
      });
      this.db.prepare(`INSERT INTO project_runs(id,project_id,workspace_id,node_id,lease_id,lease_until,heartbeat_at,status,
        from_stage,stop_before,base_version,last_seq,budget_cap_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(run.id, run.projectId, run.workspaceId, run.nodeId, run.leaseId, run.leaseUntil, at, run.status,
          run.fromStage, JSON.stringify(run.stopBefore), run.baseVersion, 0, run.budgetCapUsd, at);
      return run;
    }).immediate();
  }

  baseVersion(projectId: string): string {
    return projectRunBaseVersion(this.orchestrator.inputVersions, projectId);
  }

  activeForProject(projectId: string): ProjectRun | undefined {
    return asRun(this.db.prepare(`SELECT ${columns} FROM project_runs WHERE project_id=? AND status IN ${activeStatuses} AND lease_until>? LIMIT 1`)
      .get(projectId, this.now().toISOString()));
  }

  holding(node: Pick<NodeRow, "id">, runId: string, leaseId: string): ProjectRun {
    const stored = this.persistedNode(node), run = this.get(runId);
    const project = run && this.db.prepare("SELECT workspace_id FROM projects WHERE id=?").get(run.projectId) as { workspace_id: string | null } | undefined;
    if (!run || run.nodeId !== stored.id || run.leaseId !== leaseId || !["GRANTED", "RUNNING"].includes(run.status)
      || run.leaseUntil <= this.now().toISOString() || (stored.workspace_id && stored.workspace_id !== run.workspaceId)
      || !project || (project.workspace_id ?? defaultWorkspaceId(this.db)) !== run.workspaceId
      || run.projectId === PROTECTED_PROJECT_ID) {
      throw new AppError(409, "LEASE_STALE", "Quyền chạy dự án đã hết hạn hoặc bị thu hồi.");
    }
    return run;
  }

  heartbeat(node: Pick<NodeRow, "id">, runId: string, leaseId: string): ProjectRun {
    return this.db.transaction(() => {
      this.holding(node, runId, leaseId);
      const at = this.now().toISOString(), until = new Date(this.now().getTime() + this.ttlMs).toISOString();
      this.db.prepare("UPDATE project_runs SET status='RUNNING',heartbeat_at=?,lease_until=? WHERE id=? AND lease_id=?")
        .run(at, until, runId, leaseId);
      return this.get(runId)!;
    }).immediate();
  }

  pendingFor(node: Pick<NodeRow, "id">): ProjectRun | undefined {
    const stored = this.persistedNode(node);
    const row = this.db.prepare("SELECT id,lease_id FROM project_runs WHERE node_id=? AND status='GRANTED' AND lease_until>? ORDER BY created_at,id LIMIT 1")
      .get(stored.id, this.now().toISOString()) as { id: string; lease_id: string } | undefined;
    return row ? this.holding(stored, row.id, row.lease_id) : undefined;
  }

  finish(node: Pick<NodeRow, "id">, runId: string, input: {
    leaseId: string; lastSeq: number; reason: "DONE" | "BOUNDARY" | "BUDGET" | "PAUSED" | "FAILED"; blockedGate?: PipelineStage;
  }): ProjectRun {
    return this.orchestrator.repository.atomic(() => {
      const run = this.holding(node, runId, input.leaseId);
      if (run.lastSeq !== input.lastSeq) throw new AppError(409, "RUN_SEQUENCE_GAP", "Máy chính chưa nhận đủ checkpoint của đoạn.");
      const stages = this.orchestrator.repository.getStages(run.projectId);
      if ((input.reason === "DONE" && stages.some(({ state }) => state !== "DONE" && state !== "SKIPPED"))
        || (input.reason === "FAILED" && !stages.some(({ state }) => state === "FAILED"))) {
        throw new AppError(409, "RUN_END_INVALID", "Trạng thái kết thúc không khớp checkpoint.");
      }
      if (input.blockedGate && (input.reason !== "BOUNDARY" || !isGate(input.blockedGate)
        || !STAGE_DEPENDS[input.blockedGate].every((stage) => stages.some((record) => record.stage === stage
          && (record.state === "DONE" || record.state === "SKIPPED"))))) {
        throw new AppError(409, "RUN_END_INVALID", "Cổng bàn giao không khớp checkpoint.");
      }
      const status = input.reason === "DONE" ? "DONE" : input.reason === "FAILED" ? "FAILED" : "PAUSED_AT_GATE";
      const at = this.now().toISOString();
      this.db.prepare("UPDATE project_runs SET status=?,ended_at=?,end_reason=? WHERE id=?")
        .run(status, at, input.blockedGate ? `BOUNDARY:${input.blockedGate}` : input.reason, run.id);
      if (status === "DONE") this.orchestrator.repository.updateProject(run.projectId, { status: "COMPLETED", stage: "DONE", runMode: null });
      else if (input.reason !== "BOUNDARY") this.orchestrator.repository.setRunMode(run.projectId, null);
      return this.get(runId)!;
    }, "immediate");
  }

  expire(): number {
    return this.db.prepare(`UPDATE project_runs SET status='LOST',ended_at=?,end_reason='HEARTBEAT_LOST'
      WHERE status IN ${activeStatuses} AND lease_until<=?`).run(this.now().toISOString(), this.now().toISOString()).changes;
  }

  cancel(projectId: string, reason: string): number {
    const project = this.db.prepare("SELECT workspace_id,profile_id FROM projects WHERE id=?").get(projectId) as { workspace_id: string | null; profile_id: string | null } | undefined;
    const actor = currentActor();
    if (!project || (actor && !can(actor, "stage.run", { workspaceId: project.workspace_id ?? defaultWorkspaceId(this.db), profileId: project.profile_id }).ok)) {
      throw new AppError(404, "RUN_PROJECT_NOT_FOUND", "Không thấy dự án trong phạm vi được phép.");
    }
    return this.db.prepare(`UPDATE project_runs SET status='CANCELLED',ended_at=?,end_reason=? WHERE project_id=? AND status IN ${activeStatuses}`)
      .run(this.now().toISOString(), reason.slice(0, 300), projectId).changes;
  }
}
