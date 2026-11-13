import { fromNodeHeaders } from "better-auth/node";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "./auditLog.js";
import type { VideoAgentAuth } from "./instance.js";

/** Better Auth routes the web must never reach: the plugin's own member/org endpoints skip the last-owner rule and the audit. */
const BLOCKED = [/^\/api\/auth\/organization(\/|$)/, /^\/api\/auth\/delete-user(\/|$)/, /^\/api\/auth\/change-email$/];

const AUDITED: Array<{ path: RegExp; action: string; summary: string }> = [
  { path: /^\/api\/auth\/change-password$/, action: "account.password_changed", summary: "Đổi mật khẩu" },
  { path: /^\/api\/auth\/update-user$/, action: "account.profile_changed", summary: "Đổi thông tin cá nhân" },
  { path: /^\/api\/auth\/two-factor\/enable$/, action: "account.2fa_setup_started", summary: "Bắt đầu bật xác thực hai bước" },
  { path: /^\/api\/auth\/two-factor\/disable$/, action: "account.2fa_disabled", summary: "Tắt xác thực hai bước" },
  { path: /^\/api\/auth\/two-factor\/verify-totp$/, action: "account.2fa_verified", summary: "Xác nhận mã xác thực hai bước" },
  { path: /^\/api\/auth\/two-factor\/generate-backup-codes$/, action: "account.backup_codes_regenerated", summary: "Tạo lại mã dự phòng" },
  { path: /^\/api\/auth\/api-key\/create$/, action: "apikey.created", summary: "Tạo khoá API" },
  { path: /^\/api\/auth\/api-key\/delete$/, action: "apikey.revoked", summary: "Xoá khoá API" },
  { path: /^\/api\/auth\/api-key\/update$/, action: "apikey.updated", summary: "Sửa khoá API" },
  { path: /^\/api\/auth\/revoke-session$/, action: "account.session_revoked", summary: "Đăng xuất một phiên" },
  { path: /^\/api\/auth\/revoke-sessions$/, action: "account.session_revoked", summary: "Đăng xuất mọi phiên" },
  { path: /^\/api\/auth\/revoke-other-sessions$/, action: "account.session_revoked", summary: "Đăng xuất các phiên khác" },
];

type Pending = { userId: string; workspaceId: string | null; action: string; summary: string };

/** Must be registered before the /api/auth proxy so the blocking hook runs for it. */
export function registerAccountHooks(server: FastifyInstance, input: { auth: VideoAgentAuth; sqlite: Database.Database }): void {
  const pending = new WeakMap<FastifyRequest, Pending>();

  server.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/auth/")) return;
    if (BLOCKED.some((pattern) => pattern.test(path))) throw new AppError(404, "NOT_FOUND", "Không tìm thấy.");
    if (request.method !== "POST") return;
    const match = AUDITED.find((item) => item.path.test(path));
    if (!match) return;
    try {
      const session = await input.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session?.user?.id) return;
      const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
      pending.set(request, { userId: session.user.id, workspaceId: active, action: match.action, summary: match.summary });
    } catch {
      // No session: nothing to audit; the endpoint itself will refuse.
    }
  });

  server.addHook("onResponse", async (request, reply) => {
    const entry = pending.get(request);
    if (!entry) return;
    try {
      writeAudit(input.sqlite, {
        workspaceId: entry.workspaceId,
        actor: { kind: "user", userId: entry.userId },
        action: entry.action,
        targetType: "account",
        targetId: entry.userId,
        outcome: reply.statusCode < 400 ? "ok" : reply.statusCode === 403 || reply.statusCode === 401 ? "denied" : "error",
        statusCode: reply.statusCode,
        source: "api",
        summary: entry.summary,
        requestId: String(request.id),
      });
    } catch (error) {
      request.log.error({ err: error }, "audit_log write failed");
    }
  });
}
