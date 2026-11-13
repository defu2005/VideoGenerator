import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { redactOperatorText } from "@vg/shared";
import { maskSecretArgs } from "../registry/audit.js";
import type { AuthActor } from "./actor.js";
import { isAuthAllowlisted } from "./guard.js";

export const AUDIT_RETENTION_DAYS = 180;
const PAYLOAD_LIMIT = 4096;

export type AuditSource = "api" | "assistant" | "mcp" | "operator" | "system";

export type AuditRow = {
  workspaceId?: string | null;
  actor?: Pick<AuthActor, "kind" | "userId" | "keyId"> | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: "ok" | "denied" | "error";
  statusCode?: number | null;
  source: AuditSource;
  summary?: string | null;
  payload?: unknown;
  requestId?: string | null;
  at?: string;
};

/** Redacted JSON, never longer than 4 KB. */
export function redactedPayload(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  try {
    text = redactOperatorText(JSON.stringify(maskSecretArgs(value)));
  } catch {
    return null;
  }
  return text.length > PAYLOAD_LIMIT ? `${text.slice(0, PAYLOAD_LIMIT - 12)}…[cắt bớt]` : text;
}

export function writeAudit(sqlite: Database.Database, row: AuditRow): void {
  sqlite.prepare(
    `INSERT INTO audit_log
      (id, at, workspace_id, actor_kind, actor_user_id, actor_key_id, action, target_type, target_id,
       outcome, status_code, source, summary, payload, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    row.at ?? new Date().toISOString(),
    row.workspaceId ?? null,
    row.actor?.kind ?? null,
    row.actor?.userId ?? null,
    row.actor?.keyId ?? null,
    row.action.slice(0, 200),
    row.targetType ?? null,
    row.targetId ?? null,
    row.outcome,
    row.statusCode ?? null,
    row.source,
    row.summary ? redactOperatorText(row.summary).slice(0, 500) : null,
    redactedPayload(row.payload),
    row.requestId ?? null,
  );
}

export function purgeOldAudit(sqlite: Database.Database, now = new Date()): number {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
  return sqlite.prepare("DELETE FROM audit_log WHERE at < ?").run(cutoff).changes;
}

const SIGN_IN = /^\/api\/auth\/sign-in(\/|$)/;

function outcomeFor(status: number): AuditRow["outcome"] {
  if (status < 400) return "ok";
  if (status === 401 || status === 403 || status === 404) return "denied";
  return "error";
}

/** Every non-GET request that passed the guard leaves a row, including refusals. */
export function registerApiAudit(server: FastifyInstance, sqlite: Database.Database): void {
  server.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    const method = request.method.toUpperCase();
    if (SIGN_IN.test(path) && method === "POST" && reply.statusCode >= 400) {
      writeAudit(sqlite, {
        action: "sign-in",
        outcome: "denied",
        statusCode: reply.statusCode,
        source: "api",
        requestId: String(request.id),
      });
      return;
    }
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    if (path.startsWith("/api/auth/")) return;
    const actor = request.actor;
    if (!actor) return;
    const template = request.routeOptions.url ?? path;
    if (isAuthAllowlisted(method, template)) return;
    const params = (request.params ?? {}) as Record<string, unknown>;
    const targetId = typeof params.id === "string" ? params.id : null;
    try {
      writeAudit(sqlite, {
        workspaceId: actor.workspaceId || null,
        actor,
        action: `${method} ${template}`,
        targetType: template.split("/")[2] ?? null,
        targetId,
        outcome: outcomeFor(reply.statusCode),
        statusCode: reply.statusCode,
        source: "api",
        payload: request.body,
        requestId: String(request.id),
      });
    } catch (error) {
      request.log.error({ err: error }, "audit_log write failed");
    }
  });
}
