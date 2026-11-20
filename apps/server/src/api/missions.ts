import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { fixedKeyAgent } from "../supervision/identity.js";
import { currentDuty, isOnDuty } from "../supervision/duty.js";
import {
  attachMissionProject, cancelMission, createMission, getMission, listMissions, MISSION_STATES, moveMissionByAgent, setMissionPlan,
  MAX_PLAN_STEPS, type MissionState,
} from "../missions/missions.js";
import { resumeMissionByUser } from "../missions/checkpoints.js";
import { missionPreview } from "../missions/preview.js";

// TASK-129c slice 1: user routes (create, list, read, cancel) and the owner's tools (plan, project, move).
export function registerMissionRoutes(app: FastifyInstance, sqlite: Database.Database) {
  const userOnly = (request: FastifyRequest) => {
    if (request.actor?.kind !== "user" || !request.actor.isInstanceOwner) throw new AppError(403, "MISSION_USER_ONLY", "Chỉ chủ app đăng nhập qua giao diện được tạo mission.");
    const id = currentWorkspaceId(sqlite);
    if (!id) throw new AppError(403, "MISSION_NO_WORKSPACE", "Chưa chọn workspace.");
    return id;
  };
  const createArgs = z.object({
    command: z.string().trim().min(1).max(2000),
    channelProfileId: z.string().max(80).nullable().optional(),
    projectIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    autonomyLevel: z.enum(["off", "assist", "supervised", "autonomous"]).optional(),
    deadline: z.string().max(40).nullable().optional(),
    budgetUsd: z.number().min(0).max(10_000).nullable().optional(),
  }).strict();
  const planArgs = z.object({
    steps: z.array(z.record(z.string(), z.unknown())).max(MAX_PLAN_STEPS),
  }).strict();
  const attachArgs = z.object({ projectId: z.string().min(1).max(80) }).strict();
  const moveArgs = z.object({ to: z.enum(MISSION_STATES) }).strict();
  const missionId = (request: FastifyRequest) => z.object({ id: z.string().min(1).max(80) }).parse(request.params).id;

  app.get("/api/missions", async (request) => ({ missions: listMissions(sqlite, userOnly(request)) }));
  app.post("/api/missions", async (request, reply) => {
    const workspaceId = userOnly(request);
    const input = createArgs.parse(request.body ?? {});
    const duty = currentDuty(sqlite);
    const mission = createMission(sqlite, workspaceId, { ...input, channelProfileId: input.channelProfileId ?? null }, {
      createdBy: "user", owner: duty?.instance ?? null,
    });
    return reply.code(201).send({ mission });
  });
  // The detail view also lists the checkpoints (2h, 24h, 72h, 7d, ping) with their metrics and report, read back from the same rows.
  app.get("/api/missions/:id", async (request) => {
    const workspaceId = userOnly(request);
    const id = missionId(request);
    const mission = getMission(sqlite, workspaceId, id);
    const rows = sqlite.prepare("SELECT kind, at, metrics, report FROM mission_checkpoints WHERE mission_id = ? ORDER BY at").all(id) as Array<{ kind: string; at: string; metrics: string | null; report: string | null }>;
    const parse = (value: string | null) => {
      if (!value) return null;
      try { return JSON.parse(value) as unknown; } catch { return value; }
    };
    const preview = missionPreview(sqlite, mission);
    return { mission, preview, checkpoints: rows.map((r) => ({ kind: r.kind, at: r.at, metrics: parse(r.metrics), report: parse(r.report) })) };
  });
  app.post("/api/missions/:id/cancel", async (request) => ({ mission: cancelMission(sqlite, userOnly(request), missionId(request)) }));
  // Only the user clears a gate (waiting_user → producing); agents have no route to it.
  app.post("/api/missions/:id/resume", async (request) => ({ mission: resumeMissionByUser(sqlite, userOnly(request), missionId(request)) }));

  // Owner tools: only the instance that holds the mission may write (checked in the service, 403 otherwise).
  // Machine keys need a fixed instance name; workspace fails closed.
  const agentWorkspace = (request: FastifyRequest) => {
    const actor = request.actor;
    const identity = fixedKeyAgent(sqlite, actor?.kind === "apikey" ? actor.keyId : null);
    const workspaceId = currentWorkspaceId(sqlite) ?? "";
    if (!workspaceId) throw new AppError(403, "MISSION_NO_WORKSPACE", "Chưa chọn workspace.");
    return { identity, workspaceId };
  };
  // Write routes also need the caller to hold duty (heartbeat fresh); a stale instance gets 403 here.
  const dutyWorkspace = (request: FastifyRequest) => {
    const scoped = agentWorkspace(request);
    if (!isOnDuty(sqlite, scoped.identity.instance)) throw new AppError(403, "MISSION_NOT_ON_DUTY", "Instance không đang trực nên không ghi được mission.");
    return scoped;
  };
  app.get("/api/mission-agents/:id", async (request) => {
    const { workspaceId } = agentWorkspace(request);
    return { mission: getMission(sqlite, workspaceId, missionId(request)) };
  });
  app.put("/api/mission-agents/:id/plan", async (request) => {
    const { identity, workspaceId } = dutyWorkspace(request);
    const { steps } = planArgs.parse(request.body ?? {});
    return { mission: setMissionPlan(sqlite, workspaceId, missionId(request), identity.instance, steps) };
  });
  app.post("/api/mission-agents/:id/projects", async (request) => {
    const { identity, workspaceId } = dutyWorkspace(request);
    const { projectId } = attachArgs.parse(request.body ?? {});
    return { mission: attachMissionProject(sqlite, workspaceId, missionId(request), identity.instance, projectId) };
  });
  app.post("/api/mission-agents/:id/move", async (request) => {
    const { identity, workspaceId } = dutyWorkspace(request);
    const { to } = moveArgs.parse(request.body ?? {});
    return { mission: moveMissionByAgent(sqlite, workspaceId, missionId(request), identity.instance, to as MissionState) };
  });
}
