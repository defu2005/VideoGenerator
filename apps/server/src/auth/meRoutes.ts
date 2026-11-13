import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { allowedActions } from "./policy.js";
import { membershipsOf } from "./workspaces.js";

const AuditQuery = z.object({
  workspace: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  source: z.enum(["api", "assistant", "mcp", "operator", "system"]).optional(),
  outcome: z.enum(["ok", "denied", "error"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

type AuditDbRow = {
  id: string; at: string; workspace_id: string | null; actor_kind: string | null; actor_user_id: string | null;
  actor_key_id: string | null; action: string; target_type: string | null; target_id: string | null;
  outcome: string; status_code: number | null; source: string; summary: string | null; payload: string | null;
  request_id: string | null;
};

export function registerMeRoutes(server: FastifyInstance, sqlite: Database.Database): void {
  server.get("/api/me", async (request) => {
    const actor = request.actor;
    if (!actor) throw new AppError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");
    const user = sqlite.prepare("SELECT id, name, email, two_factor_enabled AS tf FROM user WHERE id = ?").get(actor.userId) as
      { id: string; name: string; email: string; tf: number | null } | undefined;
    const twoFactorEnabled = user?.tf === 1;
    const twoFactorRequired = actor.kind === "user" && actor.flags?.requireTwoFactor === true
      && (actor.role === "owner" || actor.role === "admin") && !twoFactorEnabled;
    const org = sqlite.prepare("SELECT id, name FROM organization WHERE id = ?").get(actor.workspaceId) as
      { id: string; name: string } | undefined;
    const names = new Map(
      (sqlite.prepare("SELECT id, name FROM organization").all() as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
    );
    return {
      user: user ? { id: user.id, name: user.name, email: user.email } : { id: actor.userId, name: "", email: "" },
      twoFactorEnabled,
      twoFactorRequired,
      workspace: { id: actor.workspaceId, name: org?.name ?? "", flags: actor.flags ?? {} },
      workspaces: membershipsOf(sqlite, actor.userId).map((m) => ({
        id: m.workspaceId, name: names.get(m.workspaceId) ?? "", role: m.role,
      })),
      role: actor.role,
      channelIds: actor.channelIds,
      isInstanceOwner: actor.isInstanceOwner,
      allowed: allowedActions(actor),
    };
  });

  server.get("/api/audit", async (request) => {
    const actor = request.actor;
    if (!actor) throw new AppError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");
    const query = AuditQuery.parse(request.query);
    if (query.workspace && query.workspace !== actor.workspaceId) {
      throw new AppError(404, "NOT_FOUND", "Không tìm thấy.");
    }
    const where: string[] = ["workspace_id = ?"];
    const args: unknown[] = [actor.workspaceId];
    if (query.actor) { where.push("actor_user_id = ?"); args.push(query.actor); }
    if (query.action) { where.push("action LIKE ?"); args.push(`%${query.action.replace(/[%_]/g, "")}%`); }
    if (query.source) { where.push("source = ?"); args.push(query.source); }
    if (query.outcome) { where.push("outcome = ?"); args.push(query.outcome); }
    if (query.from) { where.push("at >= ?"); args.push(query.from); }
    if (query.to) { where.push("at <= ?"); args.push(query.to); }
    if (query.cursor) {
      const [at, id] = query.cursor.split("|");
      if (at && id) { where.push("(at < ? OR (at = ? AND id < ?))"); args.push(at, at, id); }
    }
    const rows = sqlite.prepare(
      `SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY at DESC, id DESC LIMIT ?`,
    ).all(...args, query.limit + 1) as AuditDbRow[];
    const page = rows.slice(0, query.limit);
    const userNames = new Map<string, string>();
    const keyNames = new Map<string, string>();
    for (const row of page) {
      if (row.actor_user_id && !userNames.has(row.actor_user_id)) {
        const found = sqlite.prepare("SELECT name FROM user WHERE id = ?").get(row.actor_user_id) as { name: string } | undefined;
        if (found) userNames.set(row.actor_user_id, found.name);
      }
      if (row.actor_key_id && !keyNames.has(row.actor_key_id)) {
        const found = sqlite.prepare("SELECT name FROM apikey WHERE id = ?").get(row.actor_key_id) as { name: string | null } | undefined;
        if (found?.name) keyNames.set(row.actor_key_id, found.name);
      }
    }
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id, at: row.at, workspaceId: row.workspace_id, actorKind: row.actor_kind,
        actorUserId: row.actor_user_id, actorKeyId: row.actor_key_id,
        actorName: row.actor_user_id ? userNames.get(row.actor_user_id) ?? null : null,
        actorKeyName: row.actor_key_id ? keyNames.get(row.actor_key_id) ?? null : null, action: row.action,
        targetType: row.target_type, targetId: row.target_id, outcome: row.outcome,
        statusCode: row.status_code, source: row.source, summary: row.summary,
        payload: row.payload, requestId: row.request_id,
      })),
      nextCursor: rows.length > query.limit && last ? `${last.at}|${last.id}` : null,
    };
  });
}
