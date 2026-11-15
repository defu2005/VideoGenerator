import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getKeyProfile, resolveTrustedAgent } from "../supervision/identity.js";
import { AppError } from "../lib/errors.js";
import { touchInstance } from "../supervision/duty.js";
import type { AgentStageService } from "../agents/stageService.js";
import type { AgentVisualToolkit } from "../agents/visualToolkit.js";
import { StageClaimSchema, StageCompleteSchema, StageHeartbeatSchema, StageReleaseSchema, VisualImageSchema, VisualSelectSchema, VisualSubmitSchema, VisualVerdictSchema } from "../agents/toolDefs.js";

export function registerAgentStageRoutes(app: FastifyInstance, sqlite: Database.Database, stages: AgentStageService, visuals: AgentVisualToolkit) {
  const agent = (request: FastifyRequest) => {
    const keyId = request.actor?.kind === "apikey" ? request.actor.keyId : null;
    const profile = getKeyProfile(sqlite, keyId);
    if (!profile || profile.instanceName === "unknown") throw new AppError(403, "STAGE_AGENT_KEY_REQUIRED", "Khóa máy cần tên instance cố định trước khi nhận stage.");
    const resolved = resolveTrustedAgent({ sqlite, keyId, headers: request.headers as Record<string, string | undefined>, warn: (data, message) => request.log.warn(data, message) });
    touchInstance(sqlite, resolved, { tool: true, workspaceId: request.actor?.workspaceId });
    return resolved;
  };
  const id = (request: FastifyRequest) => z.object({ id: z.uuid() }).parse(request.params).id;
  app.post("/api/stage-agents/claim", async (request) => stages.claim(agent(request), StageClaimSchema.parse(request.body ?? {})));
  app.post("/api/stage-agents/jobs/:id/heartbeat", async (request) => {
    const a = StageHeartbeatSchema.omit({ jobId: true }).parse(request.body);
    return stages.heartbeat(agent(request), id(request), a.leaseId, a.progress, a.note);
  });
  app.post("/api/stage-agents/jobs/:id/complete", async (request) => {
    const a = StageCompleteSchema.omit({ jobId: true }).parse(request.body);
    return stages.complete(agent(request), id(request), a.leaseId, a.summary, a.usage);
  });
  app.post("/api/stage-agents/jobs/:id/release", async (request) => {
    const a = StageReleaseSchema.omit({ jobId: true }).parse(request.body);
    return stages.release(agent(request), id(request), a.leaseId, a.reason);
  });
  app.post("/api/stage-agents/jobs/:id/take-back", async (request) => stages.takeBack(id(request)));
  app.post("/api/stage-agents/jobs/:id/candidates", async (request) => {
    const a = VisualSubmitSchema.omit({ jobId: true }).parse(request.body);
    return visuals.submit(agent(request), id(request), a.leaseId, a.sceneId, a.items);
  });
  app.post("/api/stage-agents/jobs/:id/verdict", async (request) => {
    const a = VisualVerdictSchema.omit({ jobId: true }).parse(request.body);
    return visuals.recordVerdict(agent(request), id(request), a.leaseId, a.candidateId, { verdict: a.verdict, subjectMatch: a.subjectMatch, reason: a.reason, model: a.model });
  });
  app.post("/api/stage-agents/jobs/:id/select", async (request) => {
    const a = VisualSelectSchema.omit({ jobId: true }).parse(request.body);
    return visuals.select(agent(request), id(request), a.leaseId, a.sceneId, a.candidateId);
  });
  app.get("/api/stage-agents/candidates/:id/image", async (request) => {
    const a = VisualImageSchema.omit({ candidateId: true }).parse({ maxSide: (request.query as { maxSide?: string }).maxSide ? Number((request.query as { maxSide: string }).maxSide) : undefined });
    return visuals.image(id(request), a.maxSide);
  });
}
