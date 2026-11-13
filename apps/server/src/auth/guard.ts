import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import type { AuthActor } from "./actor.js";
import type { VideoAgentAuth } from "./instance.js";
import { buildActor, membershipsOf, pickMembership } from "./workspaces.js";
import type Database from "better-sqlite3";

const UNAUTHORIZED = new AppError(401, "UNAUTHORIZED", "Bạn cần đăng nhập.");

export function isAuthAllowlisted(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  if (path === "/api/health") return true;
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return true;
  if (path === "/api/setup" || path.startsWith("/api/setup/")) return true;
  if (method === "GET" && /^\/api\/oauth\/[^/]+\/callback$/.test(path)) return true;
  if (method === "GET" && path === "/api/settings/llm-providers/openrouter/callback") return true;
  if (method === "POST" && path === "/api/knowledge/webhooks/tiktok") return true;
  if (path.startsWith("/api/nodes/agent/")) return true; // worker nodes: authenticated by node token in the route
  return false;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveWorkspace(sqlite: Database.Database, input: {
  kind: AuthActor["kind"];
  userId: string;
  keyId?: string;
  requested?: string | null;
}): AuthActor {
  const picked = pickMembership(membershipsOf(sqlite, input.userId), input.requested);
  if ("status" in picked) throw new AppError(picked.status, picked.code, picked.message);
  return buildActor(sqlite, { kind: input.kind, userId: input.userId, keyId: input.keyId, membership: picked });
}

export function registerAuthGuard(server: FastifyInstance, input: {
  auth: VideoAgentAuth;
  sqlite: Database.Database;
  testActor?: AuthActor;
}): void {
  server.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/")) return;
    if (process.env.NODE_ENV !== "production" && input.testActor) {
      request.actor = input.testActor;
      return;
    }
    if (isAuthAllowlisted(request.method, path)) return;

    const presented = headerValue(request.headers["x-api-key"]);
    if (presented !== undefined) {
      const key = presented.trim();
      if (!key) throw UNAUTHORIZED;
      let valid = false;
      let userId: string | undefined;
      let keyId: string | undefined;
      try {
        const result = await input.auth.api.verifyApiKey({ body: { key } });
        valid = result.valid === true && Boolean(result.key?.referenceId);
        userId = result.key?.referenceId;
        keyId = result.key?.id;
      } catch {
        valid = false;
      }
      if (!valid || !userId) throw UNAUTHORIZED;
      const requested = headerValue(request.headers["x-workspace-id"])?.trim() || undefined;
      request.actor = resolveWorkspace(input.sqlite, { kind: "apikey", userId, keyId, requested });
      return;
    }

    try {
      const session = await input.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session?.user?.id) throw UNAUTHORIZED;
      const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
      const actor = resolveWorkspace(input.sqlite, { kind: "user", userId: session.user.id, requested: active });
      if (!active) {
        input.sqlite.prepare("UPDATE session SET active_organization_id = ? WHERE id = ?")
          .run(actor.workspaceId, session.session.id);
      }
      request.actor = actor;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw UNAUTHORIZED;
    }
  });
}
