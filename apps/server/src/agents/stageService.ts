import { randomUUID } from "node:crypto";
import { PROTECTED_PROJECT_ID, STAGE_DEPENDS, isSideJobStage, jobLane, redactExportText, resolveAgentWaitMinutes, resolveStageExecution, type Job, type JobError, type PipelineStage, type Project, type StageExecutionBrief } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { currentActor } from "../auth/requestContext.js";
import { can } from "../auth/policy.js";
import type { TrustedAgent } from "../supervision/identity.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { publishAgentEvent } from "../events/agentBus.js";
import { recordStageRelease } from "./releaseMonitor.js";
import { stageAgentUsage, type AgentUsage } from "./usage.js";
import { captureStageFeedback } from "../learning/stageFeedback.js";
import { listAgentAssignments, matchingStageAssignment } from "./assignments.js";
import { sendMessage } from "../supervision/mailbox.js";
import { getKeyProfile } from "../supervision/identity.js";
import { type StageAgentAdapter, VISUAL_HANDOFF_ERRORS } from "./stageAdapters/index.js";

export const STAGE_AGENT_LEASE_MS = 10 * 60_000;
export type StageClaimFilter = { stages?: PipelineStage[]; projectId?: string; profileId?: string };
type Deps = {
  repository: JobRepository; orchestrator: PipelineOrchestrator; now?: () => Date;
  adapters?: readonly StageAgentAdapter[];
  context?: (job: Job) => unknown;
  validateComplete?: (job: Job) => void | Promise<void>;
  openReason?: (job: Pick<Job, "projectId" | "stage">) => string | null;
  supportedStages?: readonly PipelineStage[];
};

/** Agent jobs use exactly TASK-118's job fencing columns, never a parallel lease table. */
export class AgentStageService {
  private readonly adapters: Map<PipelineStage, StageAgentAdapter>;
  constructor(private readonly deps: Deps) {
    if (deps.adapters) {
      this.adapters = new Map(deps.adapters.map((adapter) => [adapter.stage, adapter]));
    } else {
      const stages = deps.context && deps.validateComplete ? (deps.supportedStages ?? ["VISUAL_SEARCH"]) : [];
      this.adapters = new Map();
      for (const stage of stages) {
        this.adapters.set(stage, {
          stage,
          role: stage === "VISUAL_SEARCH" ? "visual_scout" : `${stage.toLowerCase()}_scout`,
          buildContext: deps.context ?? (() => ({})),
          validateComplete: deps.validateComplete ?? (() => {}),
          openReason: deps.openReason,
          handoffErrors: VISUAL_HANDOFF_ERRORS,
        });
      }
    }
  }
  get supportedStages(): readonly PipelineStage[] {
    return Array.from(this.adapters.keys());
  }
  adapterFor(stage: PipelineStage): StageAgentAdapter | undefined {
    return this.adapters.get(stage);
  }
  private now() { return this.deps.now?.() ?? new Date(); }
  private profile(project: Project): StageExecutionBrief {
    if (!project.profileId) return {};
    const row = this.deps.repository.sqlite.prepare("SELECT default_brief FROM profiles WHERE id=?").get(project.profileId) as { default_brief: string } | undefined;
    try { return row ? JSON.parse(row.default_brief) ?? {} : {}; } catch { return {}; }
  }
  mode(job: Job) {
    // Returning to the app is a per-job override; cannot_do/take-back must not bounce straight back.
    if (job.executor === "app" && job.handoffAt) return "app";
    const project = this.deps.repository.getProject(job.projectId);
    return project ? resolveStageExecution(job.stage, project.settings, this.profile(project)) : "app";
  }
  beforeLocal(job: Job) {
    return this.mode(job) === "agent" && Boolean(this.handoff(job.id, "Cấu hình giao stage cho agent."));
  }
  afterError(job: Job, error: JobError) {
    if (this.mode(job) !== "app_then_agent") return false;
    const adapter = this.adapterFor(job.stage);
    if (!adapter) return false;
    const matchesHandoff = adapter.handoffErrors.includes(error.code);
    const providerQuota = adapter.stage === "VISUAL_SEARCH" && /(?:BRAVE|IMAGE|VISUAL).*(?:QUOTA|RATE_LIMIT)/.test(error.code) && job.attempt >= job.maxAttempts;
    return (matchesHandoff || providerQuota) && Boolean(this.handoff(job.id, `${error.code}: ${error.message}`));
  }
  afterLocal(job: Job) {
    if (this.mode(job) !== "app_then_agent") return false;
    const adapter = this.adapterFor(job.stage);
    const reason = adapter?.openReason?.(job);
    return Boolean(reason && this.handoff(job.id, reason));
  }
  /** TASK-121 has exhausted its image repairs. Reuse its normal rerun-and-continue path,
   * then delegate before a worker can take the new job. Scene selections are never reset. */
  handoffAfterRepair(projectId: string, reason: string): Job | null {
    return this.deps.repository.atomic(() => {
      const repo = this.deps.repository, project = repo.getProject(projectId);
      if (!project || projectId === PROTECTED_PROJECT_ID || project.kind === "clip") return null;
      if (resolveStageExecution("VISUAL_SEARCH", project.settings, this.profile(project)) === "app") return null;
      const active = repo.getActiveJobs(projectId).filter((job) => !isSideJobStage(job.stage));
      const delegated = active.find((job) => job.stage === "VISUAL_SEARCH" && job.executor === "agent");
      if (delegated) return delegated;
      if (active.some((job) => jobLane(job.stage) === null || jobLane(job.stage) === jobLane("VISUAL_SEARCH"))) return null;
      const last = repo.sqlite.prepare("SELECT id FROM jobs WHERE project_id=? AND stage='VISUAL_SEARCH' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(projectId) as { id: string } | undefined;
      // One rescue per app attempt. A returned/taken-back job must not be delegated repeatedly by repair ticks.
      if (last && repo.getJob(last.id)?.handoffAt) return null;
      const open = this.adapterFor("VISUAL_SEARCH")?.openReason?.({ projectId, stage: "VISUAL_SEARCH" });
      if (!open) return null;
      repo.ensureStages(projectId);
      if (STAGE_DEPENDS.VISUAL_SEARCH.some((stage) => !["DONE", "SKIPPED"].includes(repo.getStage(projectId, stage).state))) return null;
      this.deps.orchestrator.runStageThenContinue(projectId, "VISUAL_SEARCH");
      const job = repo.getActiveJobs(projectId).find((job) => job.stage === "VISUAL_SEARCH");
      return job ? this.handoff(job.id, `Sau vòng sửa ảnh: ${redactExportText(reason).slice(0, 200)}. ${open}`) : null;
    }, "immediate");
  }
  /** A delegated queue has a bounded wait even when there is no local executor enabled. */
  sweep() {
    const repo = this.deps.repository;
    repo.atomic(() => {
      // Recover queues persisted before routing was installed, even with WORKER_ENABLED=false.
      const pending = repo.sqlite.prepare("SELECT id FROM jobs WHERE executor='app' AND status='QUEUED' AND handoff_at IS NULL AND project_id!=?").all(PROTECTED_PROJECT_ID) as Array<{ id: string }>;
      for (const { id } of pending) this.beforeLocal(repo.getJob(id)!);
      const expired = repo.sqlite.prepare("SELECT id FROM jobs WHERE executor='agent' AND status='RUNNING' AND lease_until<=? AND project_id!=?").all(this.now().toISOString(), PROTECTED_PROJECT_ID) as Array<{ id: string }>;
      for (const { id } of expired) {
        const job = repo.getJob(id)!;
        repo.setJobLease(id, null);
        repo.sqlite.prepare("UPDATE jobs SET handoff_at=? WHERE id=?").run(this.now().toISOString(), id);
        repo.updateJob(id, { status: "QUEUED", message: "Agent mất heartbeat; chờ agent nhận lại." });
        repo.updateStage(job.projectId, job.stage, { state: "QUEUED", jobId: id, message: "Chờ agent nhận lại." });
      }
      const rows = repo.sqlite.prepare("SELECT id FROM jobs WHERE executor='agent' AND status='QUEUED' AND handoff_at IS NOT NULL").all() as Array<{ id: string }>;
      for (const { id } of rows) {
        const job = repo.getJob(id)!, project = repo.getProject(job.projectId);
        if (!project || job.projectId === PROTECTED_PROJECT_ID) continue;
        const minutes = resolveAgentWaitMinutes(project.settings, this.profile(project));
        if (this.now().getTime() - Date.parse(job.handoffAt!) < minutes * 60_000) continue;
        this.deps.orchestrator.failJob(id, { code: "STAGE_AGENT_UNAVAILABLE", message: `Đã chờ ${minutes} phút nhưng không có agent nào nhận. ${job.handoffReason ?? ""}`, retryable: false });
        repo.setJobLease(id, null);
      }
    }, "immediate");
  }
  private project(job: Job) {
    const project = this.deps.repository.getProject(job.projectId);
    if (!project || job.projectId === PROTECTED_PROJECT_ID) throw new AppError(404, "STAGE_JOB_NOT_FOUND", "Không thấy việc trong phạm vi được phép.");
    const actor = currentActor();
    const row = this.deps.repository.sqlite.prepare("SELECT workspace_id FROM projects WHERE id=?").get(project.id) as { workspace_id: string | null };
    if (!actor || (row.workspace_id === null && !actor.ownsUnassigned) || !can(actor, "stage.run", { workspaceId: row.workspace_id, profileId: project.profileId ?? null }).ok) throw new AppError(404, "STAGE_JOB_NOT_FOUND", "Không thấy việc trong phạm vi được phép.");
    return project;
  }
  private agent(agent: TrustedAgent) {
    if (currentActor()?.kind !== "apikey" || !agent.trusted || ["operator", "assistant", "other"].includes(agent.kind)) {
      throw new AppError(403, "STAGE_AGENT_KEY_REQUIRED", "Cần khóa máy đã gắn danh tính agent bên ngoài.");
    }
  }
  private holding(agent: TrustedAgent, jobId: string, leaseId: string) {
    this.agent(agent);
    const job = this.deps.repository.getJob(jobId);
    if (!job) throw new AppError(404, "STAGE_JOB_NOT_FOUND", "Không thấy việc trong phạm vi được phép.");
    this.project(job);
    const lease = this.deps.repository.getExecutionLease(jobId);
    if (job.executor !== "agent" || job.status !== "RUNNING" || !lease || lease.agentInstance !== agent.instance || lease.leaseId !== leaseId || Date.parse(lease.leaseUntil) <= this.now().getTime()) {
      throw new AppError(409, "LEASE_LOST", "Lease của stage đã hết hạn hoặc bị thu hồi; không được ghi tiếp.");
    }
    return job;
  }
  /** Toolkit writes must recheck the same fence after downloads/model work and inside their write transaction. */
  withLease<T>(agent: TrustedAgent, jobId: string, leaseId: string, work: (job: Job) => T): T {
    return this.deps.repository.atomic(() => work(this.holding(agent, jobId, leaseId)), "immediate");
  }
  handoff(jobId: string, reason: string): Job | null {
    return this.deps.repository.atomic(() => {
      const repo = this.deps.repository, job = repo.getJob(jobId);
      if (!job || job.projectId === PROTECTED_PROJECT_ID || !["QUEUED", "RUNNING"].includes(job.status) || job.executor === "agent") return null;
      if (!this.supportedStages.includes(job.stage)) return null;
      const at = this.now().toISOString(), note = redactExportText(reason).slice(0, 500);
      repo.sqlite.prepare("UPDATE jobs SET executor='agent',handoff_reason=?,handoff_at=?,agent_instance=NULL,node_id=NULL,lease_id=NULL,lease_until=NULL,heartbeat_at=NULL WHERE id=?")
        .run(note, at, job.id);
      repo.updateJob(job.id, { status: "QUEUED", message: `Chờ agent nhận ${job.stage}: ${note}`, error: null, finishedAt: null });
      repo.updateStage(job.projectId, job.stage, { state: "QUEUED", message: `Chờ agent nhận: ${note}`, jobId: job.id, error: null });
      publishAgentEvent({ type: "stage_handoff", projectId: job.projectId, stage: job.stage, summary: note });
      return repo.getJob(job.id)!;
    }, "immediate");
  }
  claim(agent: TrustedAgent, filter: StageClaimFilter = {}) {
    this.agent(agent);
    const claimed = this.deps.repository.atomic(() => {
      const repo = this.deps.repository, now = this.now();
      const actor = currentActor()!;
      const assignments = listAgentAssignments(repo.sqlite, actor.workspaceId);
      const active = (repo.sqlite.prepare(`SELECT j.project_id AS projectId, p.profile_id AS profileId, j.stage
        FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.executor='agent' AND j.agent_instance=?
        AND j.status='RUNNING' AND j.lease_until>? AND (p.workspace_id=? OR (p.workspace_id IS NULL AND ?))`)
        .all(agent.instance, now.toISOString(), actor.workspaceId, actor.ownsUnassigned ? 1 : 0)) as Array<{ projectId: string; profileId: string | null; stage: PipelineStage }>;
      // A more permissive assignment on a new job cannot override the cap of a job already held.
      const activeLimit = active.reduce((limit, job) => {
        const adapter = this.adapterFor(job.stage);
        const assignment = matchingStageAssignment(assignments, agent.instance, { id: job.projectId, profileId: job.profileId }, job.stage, adapter?.role);
        return Math.min(limit, assignment?.maxConcurrent ?? 1);
      }, Infinity);
      if (active.length >= activeLimit) return null;
      const rows = repo.sqlite.prepare("SELECT id FROM jobs WHERE executor='agent' AND project_id != ? AND (status='QUEUED' OR (status='RUNNING' AND lease_until<=?)) ORDER BY handoff_at,created_at,rowid")
        .all(PROTECTED_PROJECT_ID, now.toISOString()) as Array<{ id: string }>;
      for (const { id } of rows) {
        let job = repo.getJob(id)!;
        const adapter = this.adapterFor(job.stage);
        if (!adapter || !this.supportedStages.includes(job.stage) || (filter.stages && !filter.stages.includes(job.stage)) || (filter.projectId && filter.projectId !== job.projectId)) continue;
        let project: Project;
        try { project = this.project(job); } catch (error) { if (error instanceof AppError && error.statusCode === 404) continue; throw error; }
        if (filter.profileId && project.profileId !== filter.profileId) continue;
        const assignment = matchingStageAssignment(assignments, agent.instance, project, job.stage, adapter.role);
        if (!assignment || active.length >= assignment.maxConcurrent) continue;
        const leaseId = randomUUID(), until = new Date(now.getTime() + STAGE_AGENT_LEASE_MS).toISOString();
        // One guarded UPDATE reserves the existing job fence; the pipeline transition is in the same transaction.
        const reserved = repo.sqlite.prepare(`UPDATE jobs SET status='QUEUED',node_id=NULL,agent_instance=?,lease_id=?,lease_until=?,heartbeat_at=?
          WHERE id=? AND executor='agent' AND (status='QUEUED' OR (status='RUNNING' AND lease_until<=?))`)
          .run(agent.instance, leaseId, until, now.toISOString(), id, now.toISOString());
        if (!reserved.changes) continue;
        const started = this.deps.orchestrator.startJob(id);
        if (!started) { repo.setJobLease(id, null); continue; }
        job = started;
        this.deps.orchestrator.reportProgress(id, job.progress, `Agent ${agent.instance} đang xử lý ${job.stage}`);
        const claimedJob = repo.getJob(id)!;
        const context = adapter.buildContext(claimedJob); // Context failure rolls back the reservation too.
        publishAgentEvent({ type: "stage_claimed", projectId: job.projectId, stage: job.stage, summary: `${agent.instance} nhận ${job.stage}.` });
        return { job: claimedJob, leaseId, leaseUntil: until, context };
      }
      return null;
    }, "immediate");
    if (claimed) this.reportStage(agent, claimed.job, `nhận ${claimed.job.stage}`);
    return claimed;
  }
  /**
   * TASK-129a step 5: one `report` to the duty agent per successful claim/finish/release. Sent after the
   * transition commits, so a mailbox failure (rate limit, no workspace) never rolls the transition back.
   * `from` is the key's fixed instance; the workspace comes from the job's project and fails closed.
   */
  private reportStage(agent: TrustedAgent, job: Job, action: string) {
    try {
      const sqlite = this.deps.repository.sqlite;
      const row = sqlite.prepare("SELECT workspace_id FROM projects WHERE id=?").get(job.projectId) as { workspace_id: string | null } | undefined;
      if (!row?.workspace_id) return false;
      // The sender is the key's fixed instance, never the x-agent-name header (an unnamed key is trusted but unnamed).
      const keyId = currentActor()?.kind === "apikey" ? currentActor()!.keyId : null;
      const profile = getKeyProfile(sqlite, keyId);
      if (!profile || profile.instanceName === "unknown") return false;
      const from = `${profile.agentKind}/${profile.instanceName}`;
      sendMessage(sqlite, {
        workspaceId: row.workspace_id, from, to: "duty", kind: "report", projectId: job.projectId,
        body: `${from} ${action} (job ${job.id}).`,
      }, this.now());
      return true;
    } catch (error) {
      // Log the error code only: a dropped report must not be silent, and the message may carry user text.
      console.warn(`[stage-report] không gửi được báo cáo ${action}: ${(error as { code?: string })?.code ?? "UNKNOWN"}`);
      return false;
    }
  }
  heartbeat(agent: TrustedAgent, jobId: string, leaseId: string, progress?: number, note?: string) {
    return this.deps.repository.atomic(() => {
      const job = this.holding(agent, jobId, leaseId), now = this.now();
      const until = new Date(now.getTime() + STAGE_AGENT_LEASE_MS).toISOString();
      this.deps.repository.setJobLease(jobId, { agentInstance: agent.instance, leaseId, leaseUntil: until, heartbeatAt: now.toISOString() });
      this.deps.orchestrator.reportProgress(jobId, Math.max(0, Math.min(99, progress ?? job.progress)), `Agent ${agent.instance}: ${redactExportText(note ?? "đang xử lý").slice(0, 300)}`);
      return { jobId, leaseUntil: until };
    }, "immediate");
  }
  async complete(agent: TrustedAgent, jobId: string, leaseId: string, summary: string, usage?: AgentUsage) {
    const job = this.holding(agent, jobId, leaseId);
    const adapter = this.adapterFor(job.stage);
    if (!adapter) throw new AppError(422, "STAGE_ADAPTER_NOT_FOUND", "Stage không hỗ trợ agent ngoài.");
    await adapter.validateComplete(job);
    await adapter.prepareComplete?.(job);
    const done = this.deps.repository.atomic(() => {
      this.holding(agent, jobId, leaseId); // Fence again after any asynchronous post-stage validation.
      this.deps.orchestrator.recordUsage(jobId, stageAgentUsage(agent, usage));
      this.deps.orchestrator.completeJob(jobId, redactExportText(summary).slice(0, 1000));
      this.deps.repository.setJobLease(jobId, null);
      this.deps.repository.updateJob(jobId, {});
      publishAgentEvent({ type: "stage_completed_by_agent", projectId: job.projectId, stage: job.stage, summary: `${agent.instance}: ${redactExportText(summary).slice(0, 500)}` });
      return this.deps.repository.getJob(jobId)!;
    }, "immediate");
    this.reportStage(agent, done, `hoàn tất ${done.stage}`);
    return done;
  }
  release(agent: TrustedAgent, jobId: string, leaseId: string, reason: string) {
    const done = this.deps.repository.atomic(() => {
      const job = this.holding(agent, jobId, leaseId);
      const repo = this.deps.repository, executor = reason === "cannot_do" ? "app" : "agent";
      repo.setJobLease(jobId, null);
      repo.sqlite.prepare("UPDATE jobs SET executor=? WHERE id=?").run(executor, jobId);
      repo.updateJob(jobId, { status: "QUEUED", message: `Agent trả việc: ${redactExportText(reason).slice(0, 500)}` });
      repo.updateStage(job.projectId, job.stage, { state: "QUEUED", jobId, message: "Agent đã trả việc về hàng đợi." });
      recordStageRelease(repo.sqlite, jobId, this.now());
      if (reason === "cannot_do") {
        // TASK-148a: an agent that cannot do a stage is feedback for the stage's lessons.
        captureStageFeedback(repo.sqlite, {
          projectId: job.projectId, stage: job.stage, kind: "agent_release", target: "job",
          before: null, after: null, reason, source: "agent",
        });
      }
      publishAgentEvent({ type: "stage_released", projectId: job.projectId, stage: job.stage, summary: `${agent.instance}: ${redactExportText(reason).slice(0, 500)}` });
      return repo.getJob(jobId)!;
    }, "immediate");
    this.reportStage(agent, done, `trả ${done.stage}`);
    return done;
  }
  takeBack(jobId: string) {
    return this.deps.repository.atomic(() => {
      const repo = this.deps.repository, job = repo.getJob(jobId);
      if (currentActor()?.kind !== "user") throw new AppError(403, "STAGE_USER_ONLY", "Chỉ người dùng được lấy lại stage.");
      if (!job) throw new AppError(404, "STAGE_JOB_NOT_FOUND", "Không thấy việc trong phạm vi được phép.");
      this.project(job);
      if (job.executor !== "agent" || !["RUNNING", "QUEUED"].includes(job.status)) throw new AppError(409, "STAGE_NOT_DELEGATED", "Stage này không còn được giao cho agent.");
      repo.setJobLease(jobId, null);
      repo.sqlite.prepare("UPDATE jobs SET executor='app' WHERE id=?").run(jobId);
      repo.updateJob(jobId, { status: "QUEUED", message: "Người dùng đã lấy lại stage; chạy bằng app." });
      repo.updateStage(job.projectId, job.stage, { state: "QUEUED", jobId, message: "Người dùng đã lấy lại stage; chạy bằng app." });
      return repo.getJob(jobId)!;
    }, "immediate");
  }
}
