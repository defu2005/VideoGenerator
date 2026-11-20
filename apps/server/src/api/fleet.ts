import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { fixedKeyAgent, resolveTrustedAgent } from "../supervision/identity.js";
import { z } from "zod";
import { inbox, MAILBOX_BODY_MAX, threadForUser, threadList, userPostToThread } from "../supervision/mailbox.js";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { listAgentAssignments, requireAssignmentUser, saveAgentAssignment } from "../agents/assignments.js";
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
  app.get("/api/agents/bundle", async (request) => buildFleetBundle(sqlite, { secretValues, instance: agent(request, true).instance }));
  app.post("/api/agents/instances/heartbeat", async (request) => fleetHeartbeat(sqlite, agent(request, true), request.body));
  // TASK-129a step 4: ids and kinds only, so the sidecar can wake without reading bodies. Bodies stay behind agent_inbox.
  // Recipient comes from the key's fixed instance name; workspace fails closed ("" matches no rows).
  app.get("/api/agents/mailbox/peek", async (request) => {
    const actor = request.actor;
    const identity = fixedKeyAgent(sqlite, actor?.kind === "apikey" ? actor.keyId : null);
    const workspaceId = currentWorkspaceId(sqlite) ?? "";
    const messages = inbox(sqlite, workspaceId, identity.instance, { limit: 50, newest: true })
      .map((row) => ({ id: row.id, kind: row.kind, fromInstance: row.fromInstance, createdAt: row.createdAt }));
    return { messages };
  });
  app.post("/api/agents/skills/drafts", async (request) => saveFleetDraft(sqlite, agent(request), request.body));
  app.get("/api/operator/fleet", async (request) => { userOnly(request); return fleetOverview(sqlite); });
  // TASK-129a step 6: the user reads every thread of the workspace and posts into one. Fails closed without a workspace.
  const userWorkspace = (request: FastifyRequest) => {
    userOnly(request);
    const id = currentWorkspaceId(sqlite);
    if (!id) throw new AppError(403, "MAILBOX_NO_WORKSPACE", "Chưa chọn workspace.");
    return id;
  };
  const threadPostArgs = z.object({
    // Byte limit (8 KB) is enforced by sendMessage as 422; this cap only bounds the parse.
    to: z.string().min(1).max(120), body: z.string().min(1).max(MAILBOX_BODY_MAX * 4), projectId: z.string().max(80).nullable().optional(),
  }).strict();
  app.get("/api/operator/fleet/threads", async (request) => ({ threads: threadList(sqlite, userWorkspace(request)) }));
  app.get<{ Params: { threadId: string } }>("/api/operator/fleet/threads/:threadId", async (request) => {
    const workspaceId = userWorkspace(request);
    return { messages: threadForUser(sqlite, workspaceId, request.params.threadId.slice(0, 80)) };
  });
  app.post<{ Params: { threadId: string } }>("/api/operator/fleet/threads/:threadId/messages", async (request, reply) => {
    const workspaceId = userWorkspace(request);
    const input = threadPostArgs.parse(request.body);
    const message = userPostToThread(sqlite, workspaceId, { threadId: request.params.threadId.slice(0, 80), ...input });
    return reply.code(201).send({ message });
  });
  app.get("/api/settings/hermes-fleet", async (request) => { userOnly(request); return { settings: fleetSettings(sqlite) }; });
  app.put("/api/settings/hermes-fleet", async (request) => { userOnly(request); return { settings: saveFleetSettings(sqlite, request.body) }; });
  app.get("/api/settings/agent-assignments", async ({ actor }) => {
    requireAssignmentUser(actor);
    return { assignments: listAgentAssignments(sqlite, actor.workspaceId) };
  });
  app.post("/api/settings/agent-assignments", async ({ actor, body }, reply) => {
    return reply.code(201).send(saveAgentAssignment(sqlite, actor, body));
  });
  app.put<{ Params: { id: string } }>("/api/settings/agent-assignments/:id", async ({ actor, body, params }) => {
    return saveAgentAssignment(sqlite, actor, body, params.id);
  });
}
