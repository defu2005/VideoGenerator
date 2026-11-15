import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { resolveTrustedAgent } from "../supervision/identity.js";
import { buildFleetBundle, fleetHeartbeat, fleetOverview, fleetSettings, saveFleetDraft, saveFleetSettings } from "../fleet/service.js";

export function registerFleetRoutes(app: FastifyInstance, sqlite: Database.Database, secretValues: readonly string[] = []) {
  function agent(request: FastifyRequest, hermesOnly = false) {
    const identity = resolveTrustedAgent({ sqlite, keyId: request.actor?.keyId, headers: request.headers as Record<string, string | undefined> });
    if (request.actor?.kind !== "apikey" || !identity.trusted || (hermesOnly && identity.kind !== "hermes")) throw new AppError(403, "FLEET_MACHINE_KEY_REQUIRED", "Cần khóa máy đã gắn đúng loại agent.");
    return identity;
  }
  const userOnly = (request: FastifyRequest) => {
    if (request.actor?.kind !== "user" || !request.actor.isInstanceOwner) throw new AppError(403, "FLEET_USER_ONLY", "Chỉ chủ app đăng nhập qua giao diện được quản lý đội Hermes.");
  };
  app.get("/api/agents/bundle", async (request) => { agent(request, true); return buildFleetBundle(sqlite, { secretValues }); });
  app.post("/api/agents/instances/heartbeat", async (request) => fleetHeartbeat(sqlite, agent(request, true), request.body));
  app.post("/api/agents/skills/drafts", async (request) => saveFleetDraft(sqlite, agent(request), request.body));
  app.get("/api/operator/fleet", async (request) => { userOnly(request); return fleetOverview(sqlite); });
  app.get("/api/settings/hermes-fleet", async (request) => { userOnly(request); return { settings: fleetSettings(sqlite) }; });
  app.put("/api/settings/hermes-fleet", async (request) => { userOnly(request); return { settings: saveFleetSettings(sqlite, request.body) }; });
}
