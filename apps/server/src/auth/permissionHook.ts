import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import { isAuthAllowlisted } from "./guard.js";
import { can, scopeFor } from "./policy.js";
import { findRule, loadResource } from "./routePermissions.js";
import { runInRequestContext, setContextActor } from "./requestContext.js";

export type RegisteredRoute = { method: string; url: string };

/** Records every /api route and checks the actor against the route map before the handler runs. */
export function registerPermissionHook(server: FastifyInstance, sqlite: Database.Database): { routes: RegisteredRoute[] } {
  const routes: RegisteredRoute[] = [];
  server.addHook("onRoute", (route) => {
    if (!route.url.startsWith("/api/")) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      routes.push({ method, url: route.url });
    }
  });

  server.addHook("preHandler", async (request) => {
    const actor = request.actor;
    if (!actor) return;
    setContextActor(actor);
    const template = request.routeOptions.url ?? "";
    if (!template.startsWith("/api/")) return;
    request.scope = scopeFor(actor);
    if (isAuthAllowlisted(request.method, template)) return;

    // Required two-factor: an owner or admin without it can reach the account routes (allowlisted above) and /api/me, nothing else.
    if (actor.kind === "user" && actor.flags?.requireTwoFactor && (actor.role === "owner" || actor.role === "admin") && template !== "/api/me") {
      const row = sqlite.prepare("SELECT two_factor_enabled AS tf FROM user WHERE id = ?").get(actor.userId) as { tf: number | null } | undefined;
      if (row?.tf !== 1) {
        throw new AppError(403, "TWO_FACTOR_REQUIRED", "Không gian này bắt buộc xác thực hai bước cho chủ sở hữu và quản trị viên. Hãy bật ở trang Tài khoản của tôi.");
      }
    }

    const rule = findRule(request.method, template);
    // A route nobody mapped is owner-only until someone maps it (the coverage test keeps this list empty).
    if (!rule) {
      const unmapped = can(actor, "secrets.write");
      if (!unmapped.ok) throw new AppError(unmapped.status, unmapped.status === 404 ? "NOT_FOUND" : "FORBIDDEN", unmapped.reason);
      return;
    }
    if (rule.action === null) return;
    const resource = loadResource(sqlite, rule.resource, (request.params ?? {}) as Record<string, unknown>);
    const decision = can(actor, rule.action, resource
      ? { workspaceId: resource.workspaceId, profileId: resource.profileId }
      : undefined);
    if (!decision.ok) {
      throw new AppError(decision.status, decision.status === 404 ? "NOT_FOUND" : "FORBIDDEN", decision.reason);
    }
  });
  return { routes };
}
