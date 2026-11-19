import type Database from "better-sqlite3";
import { fromNodeHeaders } from "better-auth/node";
import { membershipsOf, pickMembership } from "./workspaces.js";
import { apiKeyWorkspace } from "./keyWorkspace.js";
import { writeAudit } from "./auditLog.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requestIsHttps } from "./origins.js";
import type { VideoAgentAuth } from "./instance.js";

const SKIP_HEADERS = new Set(["set-cookie", "content-length", "transfer-encoding", "connection"]);

function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function withSecureCookie(cookie: string, secure: boolean): string {
  if (!secure || /;\s*secure\b/i.test(cookie)) return cookie;
  return `${cookie}; Secure`;
}

async function sendAuthResponse(request: FastifyRequest, reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.code(response.status);
  const secure = requestIsHttps(request);
  response.headers.forEach((value, key) => {
    if (SKIP_HEADERS.has(key.toLowerCase())) return;
    reply.header(key, value);
  });
  for (const cookie of response.headers.getSetCookie()) {
    reply.header("set-cookie", withSecureCookie(cookie, secure));
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength === 0) return reply.send();
  return reply.send(body);
}

export function registerAuthHandler(server: FastifyInstance, auth: VideoAgentAuth, sqlite: Database.Database, trustedOrigins: string[]): void {
  server.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        const keyPath = url.pathname.replace(/\/+$/, "");
        if (request.method === "POST" && ["/api/auth/api-key/create", "/api/auth/api-key/update", "/api/auth/api-key/bind"].includes(keyPath)) {
          if (request.headers.origin && !trustedOrigins.includes(request.headers.origin)) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Nguồn yêu cầu không hợp lệ." } });
          const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
          if (!session?.user?.id) return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Bạn cần đăng nhập." } });
          const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId;
          const membership = pickMembership(membershipsOf(sqlite, session.user.id), active);
          if ("status" in membership) return reply.code(membership.status).send({ error: membership });
          const body = (request.body ?? {}) as Record<string, unknown>;
          if (keyPath.endsWith("/bind")) {
            const key = sqlite.prepare("SELECT metadata FROM apikey WHERE id=? AND reference_id=?").get(String(body.keyId ?? ""), session.user.id) as { metadata: string | null } | undefined;
            if (!key) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Không tìm thấy khóa." } });
            if (apiKeyWorkspace(key.metadata)) return reply.code(409).send({ error: { code: "APIKEY_ALREADY_BOUND", message: "Khóa đã gắn không gian." } });
            const metadata = key.metadata ? JSON.parse(key.metadata) : {};
            sqlite.prepare("UPDATE apikey SET metadata=?, updated_at=? WHERE id=?").run(JSON.stringify({ ...metadata, workspaceId: membership.workspaceId }), Date.now(), body.keyId);
            writeAudit(sqlite, { workspaceId: membership.workspaceId, actor: { kind: "user", userId: session.user.id }, action: "apikey.workspace_bound", targetType: "apikey", targetId: String(body.keyId), outcome: "ok", source: "api" });
            return reply.send({ ok: true });
          }
          // Bind on the server; clients cannot choose or change the workspace through plugin metadata.
          const { metadata: _metadata, ...safeBody } = body;
          request.body = keyPath.endsWith("/create")
            ? { ...safeBody, metadata: { workspaceId: membership.workspaceId } }
            : safeBody;
        }

        const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== undefined && request.body !== null;
        const response = await auth.handler(new Request(url, {
          method: request.method,
          headers: toWebHeaders(request),
          body: hasBody ? JSON.stringify(request.body) : undefined,
        }));
        return await sendAuthResponse(request, reply, response);
      } catch {
        return reply.code(500).send({
          error: { code: "AUTH_ERROR", message: "Không xử lý được yêu cầu đăng nhập." },
        });
      }
    },
  });
}
