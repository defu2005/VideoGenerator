import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  DEFAULT_NODE_CONFIG,
  NodeCapabilityInfoSchema,
  NodeCapabilitySchema,
  NodeDesiredConfigSchema,
  NodePatchSchema,
  NodeProbeSchema,
  NodeResourcesSchema,
  type NodeDetail,
  type NodeJobSummary,
  type NodeProbe,
  type NodeDesiredConfig,
  type NodeStatus,
  type VideoNode,
} from "@vg/shared";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "../auth/auditLog.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { readAppVersion } from "../render/appVersion.js";
import { hashToken, newJoinToken, newNodeToken } from "./tokens.js";

export const JOIN_TOKEN_TTL_MS = 60 * 60 * 1000;
export const NODE_OFFLINE_AFTER_MS = 45_000;

export type NodeRow = {
  id: string;
  name: string;
  token_hash: string | null;
  status: NodeStatus;
  version: string | null;
  capabilities: string | null;
  capability_info: string | null;
  resources: string | null;
  desired_config: string | null;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
  probe: string | null;
};

const INVALID_JOIN = new AppError(401, "INVALID_JOIN_TOKEN", "Mã tham gia không hợp lệ hoặc đã hết hạn.");

function parse<T>(value: unknown, schema: z.ZodType<T>, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    const parsed = schema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Keep only capability names the control plane understands, once each. */
export function cleanCapabilities(items: string[]): string[] {
  return [...new Set(items.filter((item) => NodeCapabilitySchema.safeParse(item).success))];
}

function cleanInfo(info: Record<string, string> | undefined, capabilities: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(info ?? {})) if (capabilities.includes(key)) out[key] = value;
  return out;
}

export class NodeService {
  /** Called with a job id whenever its lease ends without a result, so leftovers can be removed. */
  onReleased?: (jobId: string) => void;
  /** A node reported a lease the server no longer honours. Secrets of that lease must go. */
  onCancelled?: (jobId: string, leaseId: string) => void;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly repository: JobRepository,
    private readonly orchestrator: PipelineOrchestrator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createJoinToken(actor: { userId?: string; workspaceId?: string | null } | undefined): { id: string; token: string; expiresAt: string } {
    const token = newJoinToken();
    const id = randomUUID();
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + JOIN_TOKEN_TTL_MS).toISOString();
    this.sqlite.prepare(
      "INSERT INTO node_join_tokens (id, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).run(id, hashToken(token), actor?.userId ?? null, createdAt.toISOString(), expiresAt);
    writeAudit(this.sqlite, {
      workspaceId: actor?.workspaceId ?? null,
      action: "node.join_token_created",
      targetType: "node_join_token",
      targetId: id,
      outcome: "ok",
      source: "api",
      summary: "Tạo mã tham gia cho máy worker",
    });
    return { id, token, expiresAt };
  }

  /** One token joins one node. Unknown, used and expired tokens all answer the same. */
  join(input: { joinToken: string; name: string; version: string; capabilities: string[]; capabilityInfo?: Record<string, string>; resources: unknown; probe?: NodeProbe }): {
    nodeId: string;
    nodeToken: string;
    desiredConfig: NodeDesiredConfig;
  } {
    const nodeToken = newNodeToken();
    const nodeId = randomUUID();
    const at = this.now().toISOString();
    const capabilities = cleanCapabilities(input.capabilities);
    const desired: NodeDesiredConfig = { ...DEFAULT_NODE_CONFIG, capabilities };
    this.sqlite.transaction(() => {
      const claimed = this.sqlite.prepare(
        "UPDATE node_join_tokens SET used_at = ?, used_by_node_id = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      ).run(at, nodeId, hashToken(input.joinToken), at);
      if (claimed.changes !== 1) throw INVALID_JOIN;
      this.sqlite.prepare(
        `INSERT INTO nodes (id, name, token_hash, status, version, capabilities, resources, desired_config, last_seen_at, created_at, probe, capability_info)
         VALUES (?, ?, ?, 'online', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(nodeId, input.name, hashToken(nodeToken), input.version, JSON.stringify(capabilities), JSON.stringify(input.resources),
        JSON.stringify(desired), at, at, input.probe ? JSON.stringify(input.probe) : null, JSON.stringify(cleanInfo(input.capabilityInfo, capabilities)));
    })();
    writeAudit(this.sqlite, {
      action: "node.joined", targetType: "node", targetId: nodeId, outcome: "ok", source: "system",
      summary: `Máy worker "${input.name}" đã tham gia`,
    });
    return { nodeId, nodeToken, desiredConfig: desired };
  }

  /** The node behind a bearer token, or undefined (unknown token, revoked node). */
  authenticate(bearer: string | undefined): NodeRow | undefined {
    if (!bearer || !bearer.startsWith("vgn_")) return undefined;
    return this.sqlite.prepare("SELECT * FROM nodes WHERE token_hash = ? AND revoked_at IS NULL").get(hashToken(bearer)) as NodeRow | undefined;
  }

  desiredOf(row: NodeRow): NodeDesiredConfig {
    return parse(row.desired_config, NodeDesiredConfigSchema, DEFAULT_NODE_CONFIG);
  }

  runningCount(nodeId: string): number {
    return (this.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE node_id = ? AND status = 'RUNNING'").get(nodeId) as { n: number }).n;
  }

  private statusFor(desired: NodeDesiredConfig, version: string): NodeStatus {
    if (version !== readAppVersion()) return "version_mismatch";
    return desired.drain ? "draining" : "online";
  }

  heartbeat(node: NodeRow, body: {
    version: string;
    capabilities: string[];
    capabilityInfo?: Record<string, string>;
    resources: unknown;
    probe?: NodeProbe;
    running: Array<{ jobId: string; leaseId: string; progress: number; message?: string }>;
  }): { desiredConfig: NodeDesiredConfig; targetVersion: string | null; cancel: string[] } {
    const desired = this.desiredOf(node);
    const at = this.now();
    const until = new Date(at.getTime() + this.config.NODE_LEASE_SEC * 1000).toISOString();
    const capabilities = cleanCapabilities(body.capabilities);
    // A capability the node declares for the first time is switched on; one the user switched off stays off.
    const known = parse(node.capabilities, z.array(z.string()), []);
    const fresh = capabilities.filter((item) => !known.includes(item) && !desired.capabilities.includes(item));
    if (fresh.length) {
      desired.capabilities = [...desired.capabilities, ...fresh];
      this.sqlite.prepare("UPDATE nodes SET desired_config = ? WHERE id = ?").run(JSON.stringify(desired), node.id);
    }
    this.sqlite.prepare(
      "UPDATE nodes SET last_seen_at = ?, version = ?, capabilities = ?, capability_info = ?, resources = ?, status = ?, probe = COALESCE(?, probe) WHERE id = ?",
    ).run(at.toISOString(), body.version, JSON.stringify(capabilities), JSON.stringify(cleanInfo(body.capabilityInfo, capabilities)), JSON.stringify(body.resources), this.statusFor(desired, body.version),
      body.probe ? JSON.stringify(body.probe) : null, node.id);
    const cancel: string[] = [];
    for (const item of body.running) {
      const job = this.repository.getJob(item.jobId);
      const lease = this.repository.getJobLease(item.jobId);
      if (!job || job.status !== "RUNNING" || !lease || lease.nodeId !== node.id || lease.leaseId !== item.leaseId) {
        cancel.push(item.jobId);
        this.onCancelled?.(item.jobId, item.leaseId);
        continue;
      }
      this.repository.setJobLease(item.jobId, { nodeId: node.id, leaseId: item.leaseId, leaseUntil: until, heartbeatAt: at.toISOString() });
      this.orchestrator.reportProgress(
        item.jobId,
        Math.max(1, Math.min(99, Math.round(item.progress))),
        item.message ? `[${node.name}] ${item.message}` : undefined,
      );
    }
    const target = readAppVersion();
    return { desiredConfig: desired, targetVersion: body.version === target ? null : target, cancel };
  }

  list(): VideoNode[] {
    const rows = this.sqlite.prepare("SELECT * FROM nodes ORDER BY created_at ASC").all() as NodeRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      version: row.version,
      capabilities: parse(row.capabilities, z.array(z.string()), []),
      capabilityInfo: parse(row.capability_info, NodeCapabilityInfoSchema, {}),
      resources: parse(row.resources, NodeResourcesSchema.nullable(), null),
      desiredConfig: this.desiredOf(row),
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      runningJobs: this.runningCount(row.id),
      probe: this.probeOf(row),
    }));
  }

  /** Detail for the Nodes page drawer: running jobs, last 20 jobs with outcome and duration, failures in the last 24 h. */
  detail(id: string): NodeDetail {
    const node = this.list().find((item) => item.id === id);
    if (!node) throw new AppError(404, "NODE_NOT_FOUND", "Không thấy máy worker này.");
    type JobRow = { id: string; project_id: string | null; stage: string; status: string; progress: number; message: string | null; started_at: string | null; finished_at: string | null; error: string | null };
    const toSummary = (row: JobRow): NodeJobSummary => {
      let errorCode: string | null = null;
      if (row.error) {
        try { errorCode = (JSON.parse(row.error) as { code?: string }).code ?? null; } catch { errorCode = null; }
      }
      const started = row.started_at ? Date.parse(row.started_at) : NaN;
      const finished = row.finished_at ? Date.parse(row.finished_at) : NaN;
      return {
        jobId: row.id, projectId: row.project_id, stage: row.stage, status: row.status, progress: row.progress, message: row.message,
        startedAt: row.started_at, finishedAt: row.finished_at,
        durationMs: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : null, errorCode,
      };
    };
    const columns = "id, project_id, stage, status, progress, message, started_at, finished_at, error";
    const running = (this.sqlite.prepare(`SELECT ${columns} FROM jobs WHERE node_id = ? AND status = 'RUNNING' ORDER BY started_at DESC`).all(id) as JobRow[]).map(toSummary);
    const recent = (this.sqlite.prepare(`SELECT ${columns} FROM jobs WHERE node_id = ? AND status != 'RUNNING' ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 20`).all(id) as JobRow[]).map(toSummary);
    const since = new Date(this.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    const failures24h = (this.sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE node_id = ? AND status = 'FAILED' AND finished_at >= ?").get(id, since) as { n: number }).n;
    return { node, running, recent, failures24h };
  }

  probeOf(row: NodeRow): NodeProbe | null {
    return parse(row.probe, NodeProbeSchema.nullable(), null);
  }

  /** A node whose real render check failed must not get render jobs, whatever its capabilities say. */
  renderProbeFailed(row: NodeRow): boolean {
    return this.probeOf(row)?.render.ok === false;
  }

  get(id: string): NodeRow | undefined {
    return this.sqlite.prepare("SELECT * FROM nodes WHERE id = ?").get(id) as NodeRow | undefined;
  }

  patch(id: string, input: unknown): VideoNode {
    const row = this.get(id);
    if (!row || row.revoked_at) throw new AppError(404, "NODE_NOT_FOUND", "Không thấy máy worker này.");
    const patch = NodePatchSchema.parse(input);
    const current = this.desiredOf(row);
    if (patch.name !== undefined) this.sqlite.prepare("UPDATE nodes SET name = ? WHERE id = ?").run(patch.name, id);
    const next: NodeDesiredConfig = {
      concurrency: patch.concurrency ?? current.concurrency,
      drain: patch.drain ?? current.drain,
      capabilities: patch.capabilities ?? current.capabilities,
    };
    const status: NodeStatus = row.status === "offline" ? "offline" : this.statusFor(next, row.version ?? readAppVersion());
    this.sqlite.prepare("UPDATE nodes SET desired_config = ?, status = ? WHERE id = ?").run(JSON.stringify(next), status, id);
    return this.list().find((node) => node.id === id)!;
  }

  /** Revoke: the token stops working now and the node's jobs go back to the queue. */
  revoke(id: string, actor?: { workspaceId?: string | null }): void {
    const row = this.get(id);
    if (!row) throw new AppError(404, "NODE_NOT_FOUND", "Không thấy máy worker này.");
    if (row.revoked_at) return;
    this.sqlite.prepare("UPDATE nodes SET revoked_at = ?, token_hash = NULL, status = 'revoked' WHERE id = ?").run(this.now().toISOString(), id);
    const jobs = this.sqlite.prepare("SELECT id FROM jobs WHERE node_id = ? AND status = 'RUNNING'").all(id) as Array<{ id: string }>;
    for (const { id: jobId } of jobs) {
      this.orchestrator.failJob(jobId, { code: "NODE_LOST", message: `Máy worker "${row.name}" đã bị thu hồi nên bước dựng chạy lại.`, retryable: true });
      this.repository.setJobLease(jobId, null);
      this.onReleased?.(jobId);
    }
    writeAudit(this.sqlite, {
      workspaceId: actor?.workspaceId ?? null, action: "node.revoked", targetType: "node", targetId: id,
      outcome: "ok", source: "api", summary: `Thu hồi máy worker "${row.name}"`,
    });
  }

  /** Every 10 s: quiet nodes turn offline; jobs whose lease ran out go back to the queue (or fail NODE_LOST). */
  sweep(): void {
    const now = this.now();
    this.sqlite.prepare(
      "UPDATE nodes SET status = 'offline' WHERE revoked_at IS NULL AND status != 'offline' AND (last_seen_at IS NULL OR last_seen_at < ?)",
    ).run(new Date(now.getTime() - NODE_OFFLINE_AFTER_MS).toISOString());
    const expired = this.sqlite.prepare(
      `SELECT j.id AS id, n.name AS name FROM jobs j LEFT JOIN nodes n ON n.id = j.node_id
       WHERE j.node_id IS NOT NULL AND j.status = 'RUNNING' AND j.lease_until < ?`,
    ).all(now.toISOString()) as Array<{ id: string; name: string | null }>;
    for (const row of expired) {
      this.orchestrator.failJob(row.id, {
        code: "NODE_LOST",
        message: `Máy worker "${row.name ?? "không rõ"}" mất kết nối giữa chừng nên bước dựng bị gián đoạn.`,
        retryable: true,
      });
      this.repository.setJobLease(row.id, null);
      this.onReleased?.(row.id);
    }
    const ended = this.sqlite.prepare("SELECT id FROM jobs WHERE lease_id IS NOT NULL AND status != 'RUNNING'").all() as Array<{ id: string }>;
    for (const { id } of ended) {
      this.repository.setJobLease(id, null);
      this.onReleased?.(id);
    }
  }

  /** Can a node take a render right now? Drives the "prefer" placement rule. */
  hasAvailableRenderNode(): boolean {
    const rows = this.sqlite.prepare("SELECT * FROM nodes WHERE revoked_at IS NULL AND status = 'online'").all() as NodeRow[];
    return rows.some((row) => {
      const desired = this.desiredOf(row);
      return desired.capabilities.includes("render") && !desired.drain && !this.renderProbeFailed(row) && this.runningCount(row.id) < desired.concurrency;
    });
  }

  /** TASK-120: can a node take a stage that needs this capability (for example `tts:piper`) right now? */
  hasAvailableNodeFor(capability: string): boolean {
    if (capability === "render") return this.hasAvailableRenderNode();
    const rows = this.sqlite.prepare("SELECT * FROM nodes WHERE revoked_at IS NULL AND status = 'online'").all() as NodeRow[];
    return rows.some((row) => {
      const desired = this.desiredOf(row);
      return desired.capabilities.includes(capability) && !desired.drain && this.runningCount(row.id) < desired.concurrency;
    });
  }
}
