import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  PipelineStateSchema,
  JobErrorSchema,
  JobUsageSchema,
  PipelineStageSchema,
  ProjectSchema,
  JobSchema,
  StageRecordSchema,
  STAGE_ORDER,
  type Job,
  type JobError,
  type JobUsage,
  type PipelineEvent,
  type PipelineStage,
  type PipelineState,
  type Project,
  type StageRecord,
  type StageState,
} from "@vg/shared";
import type { JobErrorSummary } from "@vg/shared";
import { PipelineEventBus } from "./eventBus.js";

type ProjectRow = {
  id: string;
  title: string;
  description: string;
  topic: string;
  mode: string;
  settings: string | Project["settings"];
  status: string;
  stage: string;
  thumbnail_path: string | null;
  duration_sec: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  run_mode: string | null;
};

type JobRow = {
  id: string;
  project_id: string;
  stage: string;
  scope: string | null;
  status: string;
  progress: number;
  message: string | null;
  attempt: number;
  max_attempts: number;
  error: string | JobError | null;
  usage: string | JobUsage | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_after: string;
  previous_state: string;
};

type StageRow = {
  project_id: string;
  stage: string;
  state: string;
  progress: number;
  message: string | null;
  job_id: string | null;
  updated_at: string;
  error: string | JobError | null;
};

export class JobRepository {
  private eventQueue: PipelineEvent[] | undefined;

  constructor(
    readonly sqlite: Database.Database,
    readonly events: PipelineEventBus,
    private readonly now: () => Date = () => new Date(),
  ) {}

  atomic<T>(work: () => T): T {
    if (this.eventQueue) return work();
    const queued: PipelineEvent[] = [];
    const run = this.sqlite.transaction(() => {
      this.eventQueue = queued;
      try {
        return work();
      } finally {
        this.eventQueue = undefined;
      }
    });
    const result = run();
    for (const event of queued) this.events.publish(event);
    return result;
  }

  getProject(projectId: string): Project | undefined {
    const row = this.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
    if (!row) return undefined;
    return ProjectSchema.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      topic: row.topic,
      mode: row.mode,
      settings: typeof row.settings === "string" ? JSON.parse(row.settings) as unknown : row.settings,
      status: row.status,
      stage: row.stage,
      thumbnailPath: row.thumbnail_path,
      durationSec: row.duration_sec,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    });
  }

  getRunMode(projectId: string): "ALL" | "SINGLE" | null {
    const row = this.sqlite.prepare("SELECT run_mode FROM projects WHERE id = ?").get(projectId) as { run_mode: string | null } | undefined;
    if (row?.run_mode === "ALL" || row?.run_mode === "SINGLE") return row.run_mode;
    return null;
  }

  getScriptOrigin(projectId: string): { origin: "AGENT" | "USER"; edited: boolean } | undefined {
    const row = this.sqlite.prepare("SELECT origin, edited FROM scripts WHERE project_id = ?")
      .get(projectId) as { origin: "AGENT" | "USER"; edited: number } | undefined;
    return row ? { origin: row.origin, edited: Boolean(row.edited) } : undefined;
  }

  setRunMode(projectId: string, runMode: "ALL" | "SINGLE" | null): void {
    this.sqlite.prepare("UPDATE projects SET run_mode = ?, updated_at = ? WHERE id = ?")
      .run(runMode, this.now().toISOString(), projectId);
  }

  updateProject(projectId: string, updates: { status?: Project["status"]; stage?: Project["stage"]; runMode?: "ALL" | "SINGLE" | null }): Project {
    const current = this.getProject(projectId);
    if (!current) throw new Error(`Project ${projectId} disappeared during pipeline transition`);
    const status = updates.status ?? current.status;
    const stage = updates.stage ?? current.stage;
    const runMode = updates.runMode === undefined ? this.getRunMode(projectId) : updates.runMode;
    const updatedAt = this.now().toISOString();
    this.sqlite.prepare("UPDATE projects SET status = ?, stage = ?, run_mode = ?, updated_at = ? WHERE id = ?")
      .run(status, stage, runMode, updatedAt, projectId);
    const project = { ...current, status, stage, updatedAt };
    this.emit({ type: "project.updated", projectId, data: project, at: updatedAt });
    return project;
  }

  ensureStages(projectId: string): void {
    const insert = this.sqlite.prepare(
      "INSERT OR IGNORE INTO project_stages (project_id, stage, state, progress, message, job_id, updated_at, error) VALUES (?, ?, 'PENDING', 0, NULL, NULL, ?, NULL)",
    );
    const timestamp = this.now().toISOString();
    for (const stage of STAGE_ORDER) insert.run(projectId, stage, timestamp);
  }

  getStages(projectId: string): StageRecord[] {
    this.ensureStages(projectId);
    const rows = this.sqlite.prepare(
      "SELECT * FROM project_stages WHERE project_id = ? ORDER BY rowid",
    ).all(projectId) as StageRow[];
    return rows.map((row) => StageRecordSchema.parse({
      stage: row.stage,
      state: row.state,
      progress: row.progress,
      message: row.message,
      jobId: row.job_id,
      updatedAt: row.updated_at,
      error: JobErrorSchema.nullable().parse(parseJson(row.error)),
    }));
  }

  getStage(projectId: string, stage: PipelineStage): StageRecord {
    this.ensureStages(projectId);
    const row = this.sqlite.prepare(
      "SELECT * FROM project_stages WHERE project_id = ? AND stage = ?",
    ).get(projectId, stage) as StageRow;
    return this.toStage(row);
  }

  updateStage(projectId: string, stage: PipelineStage, updates: Partial<Omit<StageRecord, "stage">>): StageRecord {
    const current = this.getStage(projectId, stage);
    const next = StageRecordSchema.parse({ ...current, ...updates, updatedAt: this.now().toISOString() });
    this.sqlite.prepare(
      "UPDATE project_stages SET state = ?, progress = ?, message = ?, job_id = ?, updated_at = ?, error = ? WHERE project_id = ? AND stage = ?",
    ).run(next.state, next.progress, next.message, next.jobId, next.updatedAt, next.error ? JSON.stringify(next.error) : null, projectId, stage);
    this.emit({ type: "stage.updated", projectId, data: next, at: next.updatedAt });
    return next;
  }

  createJob(input: {
    projectId: string;
    stage: PipelineStage;
    maxAttempts: number;
    attempt?: number;
    previousState: StageState;
    runAfter?: Date;
  }): Job {
    const timestamp = this.now().toISOString();
    const job = JobSchema.parse({
      id: randomUUID(),
      projectId: input.projectId,
      stage: input.stage,
      scope: null,
      status: "QUEUED",
      progress: 0,
      message: null,
      attempt: input.attempt ?? 1,
      maxAttempts: input.maxAttempts,
      error: null,
      usage: null,
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
      runAfter: (input.runAfter ?? this.now()).toISOString(),
    });
    this.sqlite.prepare(
      "INSERT INTO jobs (id, project_id, stage, scope, status, progress, message, attempt, max_attempts, error, usage, created_at, started_at, finished_at, run_after, previous_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(job.id, job.projectId, job.stage, job.scope, job.status, job.progress, job.message, job.attempt, job.maxAttempts, null, null, job.createdAt, job.startedAt, job.finishedAt, job.runAfter, input.previousState);
    this.emit({ type: "job.updated", projectId: job.projectId, data: job, at: timestamp });
    return job;
  }

  getJob(jobId: string): Job | undefined {
    const row = this.sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    return row ? this.toJob(row) : undefined;
  }

  updateJob(jobId: string, updates: Partial<Omit<Job, "id" | "projectId" | "stage" | "createdAt">>): Job {
    const current = this.getJob(jobId);
    if (!current) throw new Error(`Job ${jobId} disappeared during pipeline transition`);
    const next = JobSchema.parse({ ...current, ...updates });
    this.sqlite.prepare(
      "UPDATE jobs SET status = ?, progress = ?, message = ?, attempt = ?, max_attempts = ?, error = ?, usage = ?, started_at = ?, finished_at = ?, run_after = ? WHERE id = ?",
    ).run(next.status, next.progress, next.message, next.attempt, next.maxAttempts,
      next.error ? JSON.stringify(next.error) : null, next.usage ? JSON.stringify(next.usage) : null,
      next.startedAt, next.finishedAt, next.runAfter, jobId);
    this.emit({ type: "job.updated", projectId: next.projectId, data: next, at: this.now().toISOString() });
    return next;
  }

  getPreviousState(jobId: string): StageState {
    const row = this.sqlite.prepare("SELECT previous_state FROM jobs WHERE id = ?").get(jobId) as { previous_state: StageState } | undefined;
    return row?.previous_state ?? "PENDING";
  }

  getActiveJob(projectId: string): Job | null {
    const row = this.sqlite.prepare(
      "SELECT * FROM jobs WHERE project_id = ? AND status IN ('QUEUED', 'RUNNING') ORDER BY created_at ASC LIMIT 1",
    ).get(projectId) as JobRow | undefined;
    return row ? this.toJob(row) : null;
  }

  getNextQueuedJob(now: Date): Job | undefined {
    const row = this.sqlite.prepare(
      "SELECT j.* FROM jobs j WHERE j.status = 'QUEUED' AND j.run_after <= ? AND NOT EXISTS (SELECT 1 FROM jobs active WHERE active.project_id = j.project_id AND active.status = 'RUNNING') ORDER BY j.created_at ASC LIMIT 1",
    ).get(now.toISOString()) as JobRow | undefined;
    return row ? this.toJob(row) : undefined;
  }

  listJobs(projectId: string, limit: number): Job[] {
    const rows = this.sqlite.prepare(
      "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ).all(projectId, limit) as JobRow[];
    return rows.map((row) => this.toJob(row));
  }

  getRunningJobs(): Job[] {
    const rows = this.sqlite.prepare("SELECT * FROM jobs WHERE status = 'RUNNING'").all() as JobRow[];
    return rows.map((row) => this.toJob(row));
  }

  getPipeline(projectId: string): PipelineState | undefined {
    const project = this.getProject(projectId);
    if (!project) return undefined;
    const state = PipelineStateSchema.parse({
      projectId,
      mode: project.mode,
      runMode: this.getRunMode(projectId),
      currentStage: project.stage,
      status: project.status,
      stages: this.getStages(projectId),
      activeJob: this.getActiveJob(projectId),
    });
    return state;
  }

  getRecentErrors(): JobErrorSummary[] {
    const rows = this.sqlite.prepare(
      "SELECT j.id AS job_id, j.project_id, p.title AS project_title, j.stage, j.error, j.finished_at FROM jobs j JOIN projects p ON p.id = j.project_id WHERE j.status = 'FAILED' ORDER BY j.finished_at DESC, j.rowid DESC LIMIT 10",
    ).all() as Array<{ job_id: string; project_id: string; project_title: string; stage: string; error: string | JobError | null; finished_at: string | null }>;
    return rows.map((row) => {
      const error = JobErrorSchema.nullable().parse(parseJson(row.error));
      return {
        jobId: row.job_id,
        projectId: row.project_id,
        projectTitle: row.project_title,
        stage: PipelineStageSchema.parse(row.stage),
        code: error?.code ?? "JOB_FAILED",
        message: error?.message ?? "Job failed without an error message",
        at: row.finished_at ?? this.now().toISOString(),
      };
    });
  }

  private toStage(row: StageRow): StageRecord {
    return StageRecordSchema.parse({
      stage: row.stage,
      state: row.state,
      progress: row.progress,
      message: row.message,
      jobId: row.job_id,
      updatedAt: row.updated_at,
      error: JobErrorSchema.nullable().parse(parseJson(row.error)),
    });
  }

  private toJob(row: JobRow): Job {
    return JobSchema.parse({
      id: row.id,
      projectId: row.project_id,
      stage: row.stage,
      scope: row.scope,
      status: row.status,
      progress: row.progress,
      message: row.message,
      attempt: row.attempt,
      maxAttempts: row.max_attempts,
      error: JobErrorSchema.nullable().parse(parseJson(row.error)),
      usage: JobUsageSchema.nullable().parse(parseJson(row.usage)),
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      runAfter: row.run_after,
    });
  }

  private emit(event: PipelineEvent): void {
    if (this.eventQueue) this.eventQueue.push(event);
    else this.events.publish(event);
  }

  emitVisualUpdated(projectId: string, sceneId: string, action: string): void {
    this.emit({
      type: "visual.updated",
      projectId,
      data: { sceneId, action },
      at: this.now().toISOString(),
    });
  }
}

function parseJson(value: unknown): unknown | null {
  if (value === null) return null;
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}
