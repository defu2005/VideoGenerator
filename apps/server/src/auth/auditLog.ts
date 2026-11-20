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

const pendingAuditRows = new Map<Database.Database, AuditRow[]>();
let auditFlushTimer: NodeJS.Timeout | null = null;

export function getPendingAuditCount(sqlite?: Database.Database): number {
  if (sqlite) return pendingAuditRows.get(sqlite)?.length ?? 0;
  let total = 0;
  for (const list of pendingAuditRows.values()) total += list.length;
  return total;
}

export function clearAuditQueue(sqlite?: Database.Database): void {
  if (sqlite) pendingAuditRows.delete(sqlite);
  else pendingAuditRows.clear();
}

export function flushAuditQueue(targetSqlite?: Database.Database): number {
  let totalFlushed = 0;
  const targets = targetSqlite ? [[targetSqlite, pendingAuditRows.get(targetSqlite) ?? []] as const] : [...pendingAuditRows.entries()];

  for (const [sqlite, rows] of targets) {
    if (!rows || rows.length === 0) continue;
    pendingAuditRows.delete(sqlite);

    try {
      sqlite.transaction(() => {
        const stmt = sqlite.prepare(
          `INSERT INTO audit_log
            (id, at, workspace_id, actor_kind, actor_user_id, actor_key_id, action, target_type, target_id,
             outcome, status_code, source, summary, payload, request_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const row of rows) {
          stmt.run(
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
          totalFlushed++;
        }
      })();
    } catch (error) {
      // Put rows back on transaction failure
      const existing = pendingAuditRows.get(sqlite) ?? [];
      pendingAuditRows.set(sqlite, [...rows, ...existing]);
      throw error;
    }
  }

  return totalFlushed;
}

function ensureAuditTimer(): void {
  if (!auditFlushTimer) {
    auditFlushTimer = setInterval(() => {
      try {
        flushAuditQueue();
      } catch {
        // flush errors in background tick are ignored
      }
    }, 1000);
    if (typeof auditFlushTimer.unref === "function") {
      auditFlushTimer.unref();
    }
  }
}

export function writeAudit(
  sqlite: Database.Database,
  row: AuditRow,
  options?: { immediate?: boolean; batch?: boolean },
): void {
  const isTest = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  const shouldBatch = options?.batch ?? (!isTest && !options?.immediate);

  if (!shouldBatch) {
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
    return;
  }

  let list = pendingAuditRows.get(sqlite);
  if (!list) {
    list = [];
    pendingAuditRows.set(sqlite, list);
  }
  list.push(row);
  ensureAuditTimer();
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
