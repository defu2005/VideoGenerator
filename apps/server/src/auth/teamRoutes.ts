import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { AuthActor } from "./actor.js";
import { writeAudit } from "./auditLog.js";
import { LOCAL_SERVICE_KEY_NAME } from "./localKey.js";
import { WORKSPACE_ROLES, type WorkspaceRole } from "./roles.js";
import { parseFlags, roleOf } from "./workspaces.js";

/** Invitation links stay valid for 7 days (the plugin default is 48 hours, too short for a link that is pasted by hand). */
export const INVITE_TTL_MS = 7 * 24 * 3600_000;
export const INVITE_GRANTS_PREFIX = "invite-grants:";

const GRANT_ROLES = ["editor", "reviewer", "publisher", "viewer"] as const;
const GrantInput = z.object({
  profileId: z.string().min(1).max(100),
  role: z.enum(GRANT_ROLES).optional(),
});
const GrantsBody = z.object({ grants: z.array(GrantInput).max(200) });
const InviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(WORKSPACE_ROLES).default("viewer"),
  grants: z.array(GrantInput).max(200).default([]),
});
const RoleBody = z.object({ role: z.enum(WORKSPACE_ROLES) });
const SettingsBody = z.object({
  hideFinanceFromViewers: z.boolean().optional(),
  adminsCanUseOperator: z.boolean().optional(),
  requireTwoFactor: z.boolean().optional(),
}).strict();

type Grant = z.infer<typeof GrantInput>;

function need(request: FastifyRequest): AuthActor {
  const actor = request.actor;
  if (!actor) throw new AppError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");
  return actor;
}

const isPrivileged = (role: WorkspaceRole) => role === "owner" || role === "admin";

function ownerCount(sqlite: Database.Database, workspaceId: string): number {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM member WHERE organization_id = ? AND role LIKE '%owner%'").get(workspaceId) as { n: number };
  return row.n;
}

function memberRow(sqlite: Database.Database, workspaceId: string, userId: string) {
  return sqlite.prepare("SELECT id, user_id AS userId, role FROM member WHERE organization_id = ? AND user_id = ?")
    .get(workspaceId, userId) as { id: string; userId: string; role: string } | undefined;
}

/** An admin handles only the lower four roles. Only an owner touches owners and admins. */
function assertMayManage(actor: AuthActor, targetRole: WorkspaceRole, newRole?: WorkspaceRole): void {
  if (actor.role === "owner") return;
  if (isPrivileged(targetRole)) throw new AppError(403, "FORBIDDEN", "Chỉ chủ sở hữu mới đổi được chủ sở hữu và quản trị viên.");
  if (newRole && isPrivileged(newRole)) throw new AppError(403, "FORBIDDEN", "Chỉ chủ sở hữu mới giao được vai trò chủ sở hữu hoặc quản trị viên.");
}

function validateGrants(sqlite: Database.Database, workspaceId: string, grants: Grant[]): Grant[] {
  const seen = new Set<string>();
  const out: Grant[] = [];
  for (const grant of grants) {
    if (seen.has(grant.profileId)) continue;
    seen.add(grant.profileId);
    const found = sqlite.prepare("SELECT 1 FROM profiles WHERE id = ? AND workspace_id = ?").get(grant.profileId, workspaceId);
    if (!found) throw new AppError(400, "VALIDATION_ERROR", "Có kênh không thuộc không gian này.");
    out.push(grant);
  }
  return out;
}

/** Replace all of a member's channel grants. Empty list means every channel. */
export function replaceGrants(sqlite: Database.Database, workspaceId: string, userId: string, grants: Grant[], createdBy: string | null): void {
  const run = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM channel_grants WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
    for (const grant of grants) {
      sqlite.prepare(
        "INSERT INTO channel_grants (id, workspace_id, user_id, profile_id, role, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(randomUUID(), workspaceId, userId, grant.profileId, grant.role ?? "viewer", new Date().toISOString(), createdBy);
    }
  });
  run();
}

function auditTeam(sqlite: Database.Database, actor: AuthActor, request: FastifyRequest, input: {
  action: string; targetType: string; targetId: string; summary: string; payload?: unknown; outcome?: "ok" | "denied";
}): void {
  try {
    writeAudit(sqlite, {
      workspaceId: actor.workspaceId, actor, action: input.action, targetType: input.targetType, targetId: input.targetId,
      outcome: input.outcome ?? "ok", source: "api", summary: input.summary, payload: input.payload, requestId: String(request.id),
    });
  } catch (error) {
    request.log.error({ err: error }, "audit_log write failed");
  }
}

function inviteLink(request: FastifyRequest, id: string): string {
  const origin = typeof request.headers.origin === "string" && /^https?:\/\//.test(request.headers.origin)
    ? request.headers.origin
    : "";
  return `${origin}/invite/${id}`;
}

/** Owner: any key. Admin: only their own, never the local service key. */
function canRevokeKey(actor: AuthActor, holderId: string, name: string | null): boolean {
  if (actor.role === "owner") return true;
  if (name === LOCAL_SERVICE_KEY_NAME) return false;
  return actor.role === "admin" && holderId === actor.userId;
}

export function registerTeamRoutes(server: FastifyInstance, sqlite: Database.Database): void {
  server.get("/api/workspace/members", async (request) => {
    const actor = need(request);
    const rows = sqlite.prepare(
      `SELECT m.user_id AS userId, m.role AS role, m.created_at AS joinedAt, u.name AS name, u.email AS email,
              u.two_factor_enabled AS twoFactor,
              (SELECT MAX(s.updated_at) FROM session s WHERE s.user_id = u.id) AS lastActive
         FROM member m JOIN user u ON u.id = m.user_id
        WHERE m.organization_id = ? ORDER BY m.created_at ASC`,
    ).all(actor.workspaceId) as Array<{
      userId: string; role: string; joinedAt: number; name: string; email: string; twoFactor: number | null; lastActive: number | null;
    }>;
    const grantRows = sqlite.prepare("SELECT user_id AS userId, profile_id AS profileId, role FROM channel_grants WHERE workspace_id = ?")
      .all(actor.workspaceId) as Array<{ userId: string; profileId: string; role: string }>;
    const profiles = sqlite.prepare("SELECT id, name FROM profiles WHERE workspace_id = ? ORDER BY name ASC")
      .all(actor.workspaceId) as Array<{ id: string; name: string }>;
    return {
      members: rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        role: roleOf(row.role),
        twoFactorEnabled: row.twoFactor === 1,
        lastActiveAt: row.lastActive ? new Date(row.lastActive).toISOString() : null,
        joinedAt: new Date(row.joinedAt).toISOString(),
        grants: grantRows.filter((g) => g.userId === row.userId).map((g) => ({ profileId: g.profileId, role: roleOf(g.role) })),
        isSelf: row.userId === actor.userId,
      })),
      channels: profiles,
    };
  });

  server.patch("/api/workspace/members/:userId", async (request) => {
    const actor = need(request);
    const { userId } = request.params as { userId: string };
    const body = RoleBody.parse(request.body);
    const target = memberRow(sqlite, actor.workspaceId, userId);
    if (!target) throw new AppError(404, "NOT_FOUND", "Không tìm thấy thành viên.");
    if (userId === actor.userId) throw new AppError(400, "VALIDATION_ERROR", "Bạn không tự đổi vai trò của mình được.");
    const current = roleOf(target.role);
    assertMayManage(actor, current, body.role);
    if (current === "owner" && body.role !== "owner" && ownerCount(sqlite, actor.workspaceId) <= 1) {
      throw new AppError(409, "LAST_OWNER", "Không gian cần ít nhất một chủ sở hữu.");
    }
    const run = sqlite.transaction(() => {
      sqlite.prepare("UPDATE member SET role = ? WHERE id = ?").run(body.role, target.id);
      if (isPrivileged(body.role)) sqlite.prepare("DELETE FROM channel_grants WHERE workspace_id = ? AND user_id = ?").run(actor.workspaceId, userId);
    });
    run();
    auditTeam(sqlite, actor, request, {
      action: "member.role_changed", targetType: "member", targetId: userId,
      summary: `Đổi vai trò ${current} → ${body.role}`, payload: { from: current, to: body.role },
    });
    return { ok: true, role: body.role };
  });

  server.put("/api/workspace/members/:userId/grants", async (request) => {
    const actor = need(request);
    const { userId } = request.params as { userId: string };
    const body = GrantsBody.parse(request.body);
    const target = memberRow(sqlite, actor.workspaceId, userId);
    if (!target) throw new AppError(404, "NOT_FOUND", "Không tìm thấy thành viên.");
    const current = roleOf(target.role);
    assertMayManage(actor, current);
    if (isPrivileged(current) && body.grants.length > 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Chủ sở hữu và quản trị viên luôn thấy mọi kênh.");
    }
    const grants = validateGrants(sqlite, actor.workspaceId, body.grants);
    replaceGrants(sqlite, actor.workspaceId, userId, grants, actor.userId);
    auditTeam(sqlite, actor, request, {
      action: "member.grants_changed", targetType: "member", targetId: userId,
      summary: grants.length === 0 ? "Cho xem tất cả kênh" : `Giới hạn ${grants.length} kênh`, payload: { grants },
    });
    return { ok: true, grants };
  });

  server.delete("/api/workspace/members/:userId", async (request) => {
    const actor = need(request);
    const { userId } = request.params as { userId: string };
    const target = memberRow(sqlite, actor.workspaceId, userId);
    if (!target) throw new AppError(404, "NOT_FOUND", "Không tìm thấy thành viên.");
    if (userId === actor.userId) throw new AppError(400, "VALIDATION_ERROR", "Bạn không tự xoá mình khỏi không gian được.");
    const current = roleOf(target.role);
    assertMayManage(actor, current);
    if (current === "owner" && ownerCount(sqlite, actor.workspaceId) <= 1) {
      throw new AppError(409, "LAST_OWNER", "Không gian cần ít nhất một chủ sở hữu.");
    }
    const run = sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM channel_grants WHERE workspace_id = ? AND user_id = ?").run(actor.workspaceId, userId);
      sqlite.prepare("DELETE FROM member WHERE id = ?").run(target.id);
      sqlite.prepare("UPDATE session SET active_organization_id = NULL WHERE user_id = ? AND active_organization_id = ?").run(userId, actor.workspaceId);
    });
    run();
    auditTeam(sqlite, actor, request, {
      action: "member.removed", targetType: "member", targetId: userId, summary: `Xoá thành viên (vai trò ${current})`,
    });
    return { ok: true };
  });

  server.get("/api/workspace/invitations", async (request) => {
    const actor = need(request);
    const rows = sqlite.prepare(
      `SELECT id, email, role, expires_at AS expiresAt, created_at AS createdAt FROM invitation
        WHERE organization_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC`,
    ).all(actor.workspaceId, Date.now()) as Array<{ id: string; email: string; role: string | null; expiresAt: number; createdAt: number }>;
    return {
      invitations: rows.map((row) => {
        const meta = sqlite.prepare("SELECT value FROM verification WHERE identifier = ?").get(`${INVITE_GRANTS_PREFIX}${row.id}`) as { value: string } | undefined;
        let grants: Grant[] = [];
        try { grants = meta ? (JSON.parse(meta.value) as Grant[]) : []; } catch { grants = []; }
        return {
          id: row.id, email: row.email, role: roleOf(row.role), grants,
          expiresAt: new Date(row.expiresAt).toISOString(), createdAt: new Date(row.createdAt).toISOString(),
          link: inviteLink(request, row.id),
        };
      }),
    };
  });

  server.post("/api/workspace/invitations", async (request, reply) => {
    const actor = need(request);
    const body = InviteBody.parse(request.body);
    assertMayManage(actor, "viewer", body.role);
    if (isPrivileged(body.role) && body.grants.length > 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Chủ sở hữu và quản trị viên luôn thấy mọi kênh.");
    }
    const grants = validateGrants(sqlite, actor.workspaceId, body.grants);
    const already = sqlite.prepare(
      "SELECT 1 FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND lower(u.email) = ?",
    ).get(actor.workspaceId, body.email);
    if (already) throw new AppError(409, "ALREADY_MEMBER", "Người này đã ở trong không gian.");
    const id = randomUUID();
    const expiresAt = Date.now() + INVITE_TTL_MS;
    const run = sqlite.transaction(() => {
      const older = sqlite.prepare("SELECT id FROM invitation WHERE organization_id = ? AND lower(email) = ? AND status = 'pending'")
        .all(actor.workspaceId, body.email) as Array<{ id: string }>;
      for (const row of older) {
        sqlite.prepare("UPDATE invitation SET status = 'canceled' WHERE id = ?").run(row.id);
        sqlite.prepare("DELETE FROM verification WHERE identifier = ?").run(`${INVITE_GRANTS_PREFIX}${row.id}`);
      }
      sqlite.prepare(
        "INSERT INTO invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
      ).run(id, actor.workspaceId, body.email, body.role, expiresAt, Date.now(), actor.userId);
      if (grants.length > 0) {
        sqlite.prepare("INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(randomUUID(), `${INVITE_GRANTS_PREFIX}${id}`, JSON.stringify(grants), expiresAt, Date.now(), Date.now());
      }
    });
    run();
    auditTeam(sqlite, actor, request, {
      action: "member.invited", targetType: "invitation", targetId: id,
      summary: `Mời vai trò ${body.role}`, payload: { role: body.role, grants },
    });
    return reply.code(201).send({
      id, email: body.email, role: body.role, grants,
      expiresAt: new Date(expiresAt).toISOString(), link: inviteLink(request, id),
    });
  });

  server.delete("/api/workspace/invitations/:id", async (request) => {
    const actor = need(request);
    const { id } = request.params as { id: string };
    const row = sqlite.prepare("SELECT role FROM invitation WHERE id = ? AND organization_id = ? AND status = 'pending'")
      .get(id, actor.workspaceId) as { role: string | null } | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Không tìm thấy lời mời.");
    assertMayManage(actor, "viewer", roleOf(row.role));
    sqlite.prepare("UPDATE invitation SET status = 'canceled' WHERE id = ?").run(id);
    sqlite.prepare("DELETE FROM verification WHERE identifier = ?").run(`${INVITE_GRANTS_PREFIX}${id}`);
    auditTeam(sqlite, actor, request, { action: "invitation.cancelled", targetType: "invitation", targetId: id, summary: "Huỷ lời mời" });
    return { ok: true };
  });

  server.get("/api/workspace/settings", async (request) => {
    const actor = need(request);
    const org = sqlite.prepare("SELECT name, metadata FROM organization WHERE id = ?").get(actor.workspaceId) as
      { name: string; metadata: string | null } | undefined;
    return { name: org?.name ?? "", flags: parseFlags(org?.metadata), canEdit: actor.role === "owner" };
  });

  server.patch("/api/workspace/settings", async (request) => {
    const actor = need(request);
    if (actor.role !== "owner") throw new AppError(403, "FORBIDDEN", "Chỉ chủ sở hữu mới đổi được cài đặt không gian.");
    const body = SettingsBody.parse(request.body);
    if (body.requireTwoFactor === true) {
      const me = sqlite.prepare("SELECT two_factor_enabled AS tf FROM user WHERE id = ?").get(actor.userId) as { tf: number | null } | undefined;
      if (me?.tf !== 1) {
        throw new AppError(409, "TWO_FACTOR_NEEDED_FIRST", "Hãy bật xác thực hai bước cho chính bạn trước khi bắt buộc cho cả nhóm.");
      }
    }
    const org = sqlite.prepare("SELECT metadata FROM organization WHERE id = ?").get(actor.workspaceId) as { metadata: string | null } | undefined;
    let raw: Record<string, unknown> = {};
    try { raw = org?.metadata ? (JSON.parse(org.metadata) as Record<string, unknown>) : {}; } catch { raw = {}; }
    const next = { ...raw, ...body };
    sqlite.prepare("UPDATE organization SET metadata = ? WHERE id = ?").run(JSON.stringify(next), actor.workspaceId);
    auditTeam(sqlite, actor, request, {
      action: "workspace.settings_changed", targetType: "workspace", targetId: actor.workspaceId,
      summary: "Đổi cài đặt không gian", payload: body,
    });
    return { ok: true, flags: parseFlags(JSON.stringify(next)) };
  });

  server.get("/api/workspace/service-keys", async (request) => {
    const actor = need(request);
    const rows = sqlite.prepare(
      `SELECT k.id, k.reference_id AS holderId, k.name, k.start, k.prefix, k.enabled, k.created_at AS createdAt, k.last_request AS lastRequest,
              k.expires_at AS expiresAt, u.name AS ownerName
         FROM apikey k JOIN member m ON m.user_id = k.reference_id AND m.organization_id = ?
         JOIN user u ON u.id = k.reference_id
        WHERE m.role LIKE '%owner%' OR m.role LIKE '%admin%' ORDER BY k.created_at DESC`,
    ).all(actor.workspaceId) as Array<{
      id: string; holderId: string; name: string | null; start: string | null; prefix: string | null; enabled: number | null;
      createdAt: number; lastRequest: number | null; expiresAt: number | null; ownerName: string;
    }>;
    return {
      keys: rows.map((row) => ({
        id: row.id, name: row.name ?? "", preview: `${row.prefix ?? ""}${row.start ?? ""}…`, ownerName: row.ownerName,
        enabled: row.enabled !== 0, isLocalService: row.name === LOCAL_SERVICE_KEY_NAME,
        canRevoke: canRevokeKey(actor, row.holderId, row.name),
        createdAt: new Date(row.createdAt).toISOString(),
        lastUsedAt: row.lastRequest ? new Date(row.lastRequest).toISOString() : null,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      })),
    };
  });

  server.delete("/api/workspace/service-keys/:id", async (request) => {
    const actor = need(request);
    const { id } = request.params as { id: string };
    const row = sqlite.prepare(
      `SELECT k.name, k.reference_id AS holderId FROM apikey k JOIN member m ON m.user_id = k.reference_id AND m.organization_id = ?
        WHERE k.id = ? AND (m.role LIKE '%owner%' OR m.role LIKE '%admin%')`,
    ).get(actor.workspaceId, id) as { name: string | null; holderId: string } | undefined;
    if (!row) throw new AppError(404, "NOT_FOUND", "Không tìm thấy khoá.");
    if (!canRevokeKey(actor, row.holderId, row.name)) {
      const local = row.name === LOCAL_SERVICE_KEY_NAME;
      auditTeam(sqlite, actor, request, {
        action: "apikey.revoke_denied", targetType: "apikey", targetId: id, summary: `Bị từ chối thu hồi khoá ${row.name ?? ""}`.trim(), outcome: "denied",
      });
      throw new AppError(403, "FORBIDDEN", local
        ? "Chỉ chủ không gian mới được thu hồi khoá dịch vụ trên máy (MCP, operator, Hermes dùng khoá này)."
        : "Bạn chỉ được thu hồi khoá của chính mình. Khoá của người khác do chủ không gian thu hồi.");
    }
    sqlite.prepare("UPDATE apikey SET enabled = 0, updated_at = ? WHERE id = ?").run(Date.now(), id);
    auditTeam(sqlite, actor, request, {
      action: "apikey.revoked", targetType: "apikey", targetId: id, summary: `Thu hồi khoá ${row.name ?? ""}`.trim(),
    });
    return { ok: true };
  });
}
