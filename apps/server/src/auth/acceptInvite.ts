import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "./auditLog.js";
import type { VideoAgentAuth } from "./instance.js";
import { replaceGrants, INVITE_GRANTS_PREFIX } from "./teamRoutes.js";
import { roleOf } from "./workspaces.js";

const INVALID = "Lời mời không hợp lệ hoặc đã hết hạn.";
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60_000;

type InviteRow = { id: string; organizationId: string; email: string; role: string | null; inviterId: string; expiresAt: number };

function findPending(sqlite: Database.Database, id: string): InviteRow | undefined {
  return sqlite.prepare(
    `SELECT id, organization_id AS organizationId, email, role, inviter_id AS inviterId, expires_at AS expiresAt
       FROM invitation WHERE id = ? AND status = 'pending' AND expires_at > ?`,
  ).get(id, Date.now()) as InviteRow | undefined;
}

type StoredGrant = { profileId: string; role?: "editor" | "reviewer" | "publisher" | "viewer" };

function storedGrants(sqlite: Database.Database, invitationId: string): StoredGrant[] {
  const row = sqlite.prepare("SELECT value FROM verification WHERE identifier = ?").get(`${INVITE_GRANTS_PREFIX}${invitationId}`) as { value: string } | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value) as StoredGrant[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * One synchronous transaction: claim the invitation, add the member, apply the channel grants, audit.
 * Two submits at once: the second finds the invitation no longer pending and gets 409.
 * With `newUser` it also creates the user and password account in the same transaction.
 */
export function acceptInvitation(sqlite: Database.Database, input: {
  invitationId: string;
  userId: string;
  newUser?: { name: string; email: string; passwordHash: string };
  requestId?: string;
}): { workspaceId: string; role: string } {
  const run = sqlite.transaction(() => {
    const invite = findPending(sqlite, input.invitationId);
    if (!invite) throw new AppError(409, "INVITE_USED", INVALID);
    const claimed = sqlite.prepare("UPDATE invitation SET status = 'accepted' WHERE id = ? AND status = 'pending'").run(invite.id);
    if (claimed.changes !== 1) throw new AppError(409, "INVITE_USED", INVALID);
    const now = Date.now();
    if (input.newUser) {
      sqlite.prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?, ?, ?, 1, ?, ?, 'member')")
        .run(input.userId, input.newUser.name, input.newUser.email, now, now);
      sqlite.prepare(
        "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)",
      ).run(randomUUID(), input.userId, input.userId, input.newUser.passwordHash, now, now);
    }
    const role = roleOf(invite.role);
    sqlite.prepare("INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), invite.organizationId, input.userId, role, now);
    const grants = role === "owner" || role === "admin" ? [] : storedGrants(sqlite, invite.id);
    if (grants.length > 0) replaceGrants(sqlite, invite.organizationId, input.userId, grants, invite.inviterId);
    sqlite.prepare("DELETE FROM verification WHERE identifier = ?").run(`${INVITE_GRANTS_PREFIX}${invite.id}`);
    writeAudit(sqlite, {
      workspaceId: invite.organizationId,
      actor: { kind: "user", userId: input.userId },
      action: "member.joined", targetType: "member", targetId: input.userId, outcome: "ok", source: "api",
      summary: `Tham gia với vai trò ${role}`, payload: { role, invitationId: invite.id, channels: grants.length },
      requestId: input.requestId ?? null,
    });
    return { workspaceId: invite.organizationId, role };
  });
  return run();
}

function bodyOf(request: FastifyRequest): Record<string, unknown> {
  return request.body && typeof request.body === "object" && !Array.isArray(request.body) ? (request.body as Record<string, unknown>) : {};
}

export function registerAcceptInviteRoutes(server: FastifyInstance, input: { auth: VideoAgentAuth; sqlite: Database.Database }): void {
  const hits = new Map<string, number[]>();
  const guardRate = (request: FastifyRequest) => {
    const now = Date.now();
    const recent = (hits.get(request.ip) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
    recent.push(now);
    hits.set(request.ip, recent);
    if (recent.length > RATE_LIMIT) throw new AppError(429, "RATE_LIMITED", "Thử quá nhiều lần. Hãy đợi vài phút rồi thử lại.");
  };

  server.get("/api/setup/invite/:id", async (request) => {
    guardRate(request);
    const { id } = request.params as { id: string };
    const invite = findPending(input.sqlite, id);
    if (!invite) throw new AppError(404, "INVITE_INVALID", INVALID);
    const org = input.sqlite.prepare("SELECT name FROM organization WHERE id = ?").get(invite.organizationId) as { name: string } | undefined;
    const exists = input.sqlite.prepare("SELECT 1 FROM user WHERE lower(email) = ?").get(invite.email.toLowerCase());
    return {
      email: invite.email, role: roleOf(invite.role), workspaceName: org?.name ?? "",
      accountExists: Boolean(exists), expiresAt: new Date(invite.expiresAt).toISOString(),
    };
  });

  server.post("/api/setup/accept-invite", async (request, reply) => {
    guardRate(request);
    const data = bodyOf(request);
    const id = typeof data.id === "string" ? data.id : "";
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    const invite = id ? findPending(input.sqlite, id) : undefined;
    if (!invite) throw new AppError(404, "INVITE_INVALID", INVALID);
    if (name.length < 1 || name.length > 80 || password.length < 8 || password.length > 128) {
      throw new AppError(400, "VALIDATION_ERROR", "Nhập tên và mật khẩu (ít nhất 8 ký tự).");
    }
    const email = invite.email.toLowerCase();
    if (input.sqlite.prepare("SELECT 1 FROM user WHERE lower(email) = ?").get(email)) {
      throw new AppError(409, "ACCOUNT_EXISTS", "Email này đã có tài khoản. Hãy đăng nhập rồi mở lại liên kết mời.");
    }
    const ctx = await input.auth.$context;
    const passwordHash = await ctx.password.hash(password);
    try {
      acceptInvitation(input.sqlite, {
        invitationId: id,
        userId: randomUUID(),
        newUser: { name, email, passwordHash },
        requestId: String(request.id),
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      request.log.error({ err: error }, "accept-invite failed");
      throw new AppError(409, "INVITE_USED", INVALID);
    }
    // Sign in through the normal path so the session cookie is exactly what a login gives.
    const response = await input.auth.api.signInEmail({
      body: { email, password },
      headers: fromNodeHeaders(request.headers),
      asResponse: true,
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) void reply.header("set-cookie", cookies);
    return reply.code(201).send({ ok: true });
  });

  server.post("/api/setup/invite/:id/join", async (request, reply) => {
    guardRate(request);
    const { id } = request.params as { id: string };
    const session = await input.auth.api.getSession({ headers: fromNodeHeaders(request.headers) }).catch(() => null);
    if (!session?.user?.id) throw new AppError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");
    const invite = findPending(input.sqlite, id);
    if (!invite) throw new AppError(404, "INVITE_INVALID", INVALID);
    if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new AppError(403, "INVITE_OTHER_ACCOUNT", "Lời mời này dành cho tài khoản khác. Hãy đăng xuất rồi mở lại liên kết.");
    }
    const already = input.sqlite.prepare("SELECT 1 FROM member WHERE organization_id = ? AND user_id = ?").get(invite.organizationId, session.user.id);
    if (already) throw new AppError(409, "ALREADY_MEMBER", "Bạn đã ở trong không gian này.");
    const result = acceptInvitation(input.sqlite, { invitationId: id, userId: session.user.id, requestId: String(request.id) });
    input.sqlite.prepare("UPDATE session SET active_organization_id = ? WHERE id = ?").run(result.workspaceId, session.session.id);
    return reply.code(200).send({ ok: true });
  });
}
