import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ttsCatalogEntry, type NodeSecretGrant, type SealedSecret } from "@vg/shared";
import { writeAudit } from "../auth/auditLog.js";
import { AppError } from "../lib/errors.js";
import { ttsSecretKey } from "../settings/tts.js";
import { isBoxPublicKey, sealSecret } from "./secretBox.js";
import { getLocalOnlyKeys } from "./settings.js";

/** Extra time a key stays valid after the lease TTL, for a node that is slow to start. */
export const SECRET_GRACE_MS = 5 * 60 * 1000;

/** The only key names that may ever leave this machine: the TTS provider keys. Never `.env`, OAuth or publishing tokens. */
const SENDABLE_KEY = /^tts\.[a-z0-9_-]{2,30}\.apiKey$/;

export function isSendableKeyName(name: string): boolean {
  return SENDABLE_KEY.test(name);
}

type GrantRow = {
  id: string; lease_id: string; job_id: string; node_id: string; stage: string; scope: string; label: string;
  secret_hash: string; created_at: string; expires_at: string; revoked_at: string | null; revoked_reason: string | null;
};

export type GrantInput = {
  node: { id: string; name: string };
  leaseId: string;
  jobId: string;
  stage: string;
  providerId: string;
  /** The node's one-lease X25519 public key. Without it nothing is sent. */
  nodePublicKey: string | undefined;
};

function labelOf(providerId: string): string {
  return `${ttsCatalogEntry(providerId)?.label ?? providerId} TTS`;
}

export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())} ${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function summaryOf(nodeName: string, jobId: string, label: string, expiresAt: string, verb = "nhận"): string {
  return `Node ${nodeName} ${verb} khoá ${label} cho job ${jobId}, hết hạn lúc ${formatExpiry(expiresAt)}`;
}

/**
 * Short-lived, lease-scoped secrets for worker nodes (TASK-120).
 * The plain key lives in the vault and in the sealed lease response only. Here we keep a hash and metadata.
 */
export class LeaseSecretService {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly leaseSec: () => number,
    private readonly loadSecret: (key: string) => string | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Why a key cannot go to a node, or null when it can. The stage stays on this machine when this is non-null. */
  blockedReason(providerId: string): string | null {
    const key = ttsSecretKey(providerId);
    if (!isSendableKeyName(key)) return "Khoá này không được phép gửi ra máy khác.";
    if (getLocalOnlyKeys(this.sqlite).includes(key)) return `Khoá ${labelOf(providerId)} được đặt "không gửi ra node".`;
    if (!this.loadSecret(key)) return `Chưa có khoá ${labelOf(providerId)}.`;
    return null;
  }

  /** Seal the provider's key for this node and lease. Returns null (and writes nothing) when the key may not or cannot be sent. */
  grant(input: GrantInput): SealedSecret | null {
    if (!input.nodePublicKey || !isBoxPublicKey(input.nodePublicKey)) return null;
    if (this.blockedReason(input.providerId)) return null;
    const plain = this.loadSecret(ttsSecretKey(input.providerId));
    if (!plain) return null;
    const at = this.now();
    const expiresAt = new Date(at.getTime() + this.leaseSec() * 1000 + SECRET_GRACE_MS).toISOString();
    const scope = `tts:${input.providerId}`;
    const label = labelOf(input.providerId);
    const sealed = sealSecret(plain, input.nodePublicKey, { scope, label, expiresAt });
    this.sqlite.prepare(
      `INSERT INTO node_lease_secrets (id, lease_id, job_id, node_id, stage, scope, label, secret_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), input.leaseId, input.jobId, input.node.id, input.stage, scope, label,
      createHash("sha256").update(plain).digest("hex"), at.toISOString(), expiresAt);
    this.audit(input.node, input.jobId, label, expiresAt, "node.secret_granted", "nhận");
    return sealed;
  }

  /**
   * The node asks again (it restarted its process mid-job). Same expiry as the first grant, never longer.
   * Expired or revoked is 410. The caller checks the lease itself.
   */
  regrant(node: { id: string; name: string }, jobId: string, leaseId: string, nodePublicKey: string | undefined): SealedSecret {
    const row = this.sqlite.prepare(
      "SELECT * FROM node_lease_secrets WHERE job_id = ? AND lease_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(jobId, leaseId, node.id) as GrantRow | undefined;
    if (!row) throw new AppError(404, "SECRET_NOT_FOUND", "Không có khoá cho lease này.");
    if (row.revoked_at || Date.parse(row.expires_at) <= this.now().getTime()) {
      throw new AppError(410, "SECRET_GONE", "Khoá đã hết hạn hoặc đã bị thu hồi.");
    }
    if (!nodePublicKey || !isBoxPublicKey(nodePublicKey)) throw new AppError(400, "PUBLIC_KEY_REQUIRED", "Thiếu publicKey hợp lệ.");
    const providerId = row.scope.slice("tts:".length);
    const plain = this.loadSecret(ttsSecretKey(providerId));
    if (!plain || this.blockedReason(providerId)) {
      this.revokeLease(leaseId, "key_unavailable");
      throw new AppError(410, "SECRET_GONE", "Khoá không còn được phép gửi.");
    }
    this.audit(node, jobId, row.label, row.expires_at, "node.secret_regranted", "nhận lại");
    return sealSecret(plain, nodePublicKey, { scope: row.scope, label: row.label, expiresAt: row.expires_at });
  }

  /** Is there a grant for this lease that is already expired or revoked? Used to answer 410 before the stale-lease 409. */
  isGone(jobId: string, leaseId: string, nodeId: string): boolean {
    const row = this.sqlite.prepare(
      "SELECT revoked_at, expires_at FROM node_lease_secrets WHERE job_id = ? AND lease_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(jobId, leaseId, nodeId) as { revoked_at: string | null; expires_at: string } | undefined;
    return Boolean(row && (row.revoked_at || Date.parse(row.expires_at) <= this.now().getTime()));
  }

  revokeLease(leaseId: string, reason: string): void {
    this.sqlite.prepare("UPDATE node_lease_secrets SET revoked_at = ?, revoked_reason = ? WHERE lease_id = ? AND revoked_at IS NULL")
      .run(this.now().toISOString(), reason, leaseId);
  }

  /** Every lease a job ever had loses its key: complete, fail, cancel, node lost, revoke. */
  revokeJob(jobId: string, reason: string): void {
    this.sqlite.prepare("UPDATE node_lease_secrets SET revoked_at = ?, revoked_reason = ? WHERE job_id = ? AND revoked_at IS NULL")
      .run(this.now().toISOString(), reason, jobId);
  }

  revokeNode(nodeId: string, reason: string): void {
    this.sqlite.prepare("UPDATE node_lease_secrets SET revoked_at = ?, revoked_reason = ? WHERE node_id = ? AND revoked_at IS NULL")
      .run(this.now().toISOString(), reason, nodeId);
  }

  list(limit = 50): NodeSecretGrant[] {
    const rows = this.sqlite.prepare(
      `SELECT s.*, n.name AS node_name FROM node_lease_secrets s LEFT JOIN nodes n ON n.id = s.node_id
       ORDER BY s.created_at DESC LIMIT ?`,
    ).all(Math.max(1, Math.min(200, limit))) as Array<GrantRow & { node_name: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      nodeId: row.node_id,
      nodeName: row.node_name ?? "máy đã xoá",
      jobId: row.job_id,
      stage: row.stage,
      scope: row.scope,
      label: row.label,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
      summary: summaryOf(row.node_name ?? "máy đã xoá", row.job_id, row.label, row.expires_at),
    }));
  }

  private audit(node: { id: string; name: string }, jobId: string, label: string, expiresAt: string, action: string, verb: string): void {
    writeAudit(this.sqlite, {
      action, targetType: "node", targetId: node.id, outcome: "ok", source: "system",
      summary: summaryOf(node.name, jobId, label, expiresAt, verb),
    });
  }
}
