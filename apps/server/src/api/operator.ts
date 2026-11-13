import { OperatorSettingsUpdateSchema, StandingOrderInputSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OperatorService } from "../operator/service.js";
import type Database from "better-sqlite3";
import { deleteProfileMemory, listProfileMemories, saveProfileMemory } from "../operator/profileContext.js";
import { AppError } from "../lib/errors.js";
import { currentDuty, listInstances } from "../supervision/duty.js";
import { listEscalations } from "../supervision/escalations.js";
import { listLiveLeases } from "../supervision/leases.js";
import { getOperatorPause } from "../supervision/pause.js";
import { dismissToolProposal, listToolProposals } from "../operator/toolProposals.js";
import { computerUseStatus, saveComputerUseSettings, stopComputerUse } from "../computerUse/service.js";
import { collectOperatorEvents, listOperatorEvents, listOperatorEventRules, OperatorEventRule, operatorEventTrace, saveOperatorEventRule } from "../operator/events.js";

const IdParams = z.object({ id: z.string().min(1).max(80) }).strict();

const MemoryParams = z.object({ profileId: z.string().uuid(), id: z.string().uuid() }).strict();
const MemoryBody = z.object({ text: z.string().trim().min(1).max(4000) }).strict();

export function registerOperatorRoutes(app: FastifyInstance, operator: OperatorService, sqlite: Database.Database): void {
  app.get("/api/operator/overview", async () => operator.overview());
  app.get("/api/operator/supervision", async () => {
    const now = new Date();
    return {
      duty: currentDuty(sqlite, now),
      instances: listInstances(sqlite, now),
      escalations: listEscalations(sqlite, { limit: 25 }),
      actions: sqlite.prepare(`
        SELECT id, tool, summary, decision, created_at, agent_name, agent_model
        FROM operator_tool_audit
        WHERE agent_kind = 'hermes'
        ORDER BY created_at DESC LIMIT 25
      `).all(),
      leases: listLiveLeases(sqlite, now),
      pause: getOperatorPause(sqlite, now),
    };
  });
  app.get("/api/operator/events", async () => {
    collectOperatorEvents(sqlite);
    return { items: listOperatorEvents(sqlite) };
  });
  app.get("/api/operator/event-rules", async () => ({ items: listOperatorEventRules(sqlite) }));
  app.put("/api/operator/event-rules", async (request) => {
    saveOperatorEventRule(sqlite, OperatorEventRule.parse(request.body));
    return { ok: true };
  });
  app.get("/api/operator/events/:id", async (request) => {
    const { id } = z.object({ id: z.string().min(1).max(160) }).strict().parse(request.params);
    return operatorEventTrace(sqlite, id);
  });
  app.get("/api/operator/computer-use", async () => computerUseStatus(sqlite));
  app.put("/api/operator/computer-use", async (request) => {
    saveComputerUseSettings(sqlite, request.body);
    return computerUseStatus(sqlite);
  });
  app.post("/api/operator/computer-use/stop", async () => {
    stopComputerUse(sqlite);
    return computerUseStatus(sqlite);
  });
  app.get("/api/operator/tool-proposals", async () => ({ items: listToolProposals(sqlite) }));
  app.get("/api/operator/skills", async () => ({
    items: operator.skillVersions(),
    repo: operator.repoSkillSummaries(),
    repoRejected: operator.repoSkillRejections(),
  }));
  app.get("/api/operator/skills/repo/:name", async (request) => {
    const { name } = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/) }).strict().parse(request.params);
    const skill = operator.readRepoSkill(name);
    return { name: skill.name, area: skill.area, risk: skill.risk, tools: skill.tools, markdown: skill.markdown };
  });
  app.put("/api/operator/skills/:name/draft", async (request) => {
    const { name } = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/) }).strict().parse(request.params);
    const { markdown } = z.object({ markdown: z.string().min(1).max(12_000) }).strict().parse(request.body);
    return operator.saveSkillEdit(name, markdown);
  });
  app.get("/api/operator/learning-report", async () => operator.learningReport());
  app.post("/api/operator/skills/:name/versions/:version/activate", async (request) => {
    const { name, version } = z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), version: z.coerce.number().int().positive(),
    }).strict().parse(request.params);
    operator.activateSkill(name, version);
    return { ok: true };
  });
  app.post("/api/operator/tool-proposals/:id/dismiss", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    dismissToolProposal(sqlite, id);
    return { ok: true };
  });

  app.post("/api/operator/runs/:id/resume", async (request) => {
    const { id } = IdParams.parse(request.params);
    const result = operator.resumeWorkflow(id);
    if (result.status === "refused") throw new AppError(409, "OPERATOR_RESUME_REFUSED", result.message);
    return result;
  });

  app.get("/api/operator/profiles/:profileId/memory", async (request) => {
    const { profileId } = MemoryParams.pick({ profileId: true }).parse(request.params);
    return { items: listProfileMemories(sqlite, profileId) };
  });

  app.post("/api/operator/profiles/:profileId/memory", async (request, reply) => {
    const { profileId } = MemoryParams.pick({ profileId: true }).parse(request.params);
    return reply.code(201).send(saveProfileMemory(sqlite, profileId, MemoryBody.parse(request.body).text));
  });

  app.put("/api/operator/profiles/:profileId/memory/:id", async (request) => {
    const { profileId, id } = MemoryParams.parse(request.params);
    return saveProfileMemory(sqlite, profileId, MemoryBody.parse(request.body).text, id);
  });

  app.delete("/api/operator/profiles/:profileId/memory/:id", async (request) => {
    const { profileId, id } = MemoryParams.parse(request.params);
    deleteProfileMemory(sqlite, profileId, id);
    return { ok: true };
  });

  app.get("/api/operator/conversations/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const runId = z.object({ runId: z.string().uuid().optional() }).parse(request.query).runId;
    return {
      id,
      messages: operator.listMessages(id),
      run: runId ? operator.getRun(runId) ?? null : null,
    };
  });

  app.post("/api/operator/conversations/:id/messages", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = z.object({ text: z.string().trim().min(1).max(8000) }).strict().parse(request.body);
    return operator.submit({ conversationId: id, prompt: body.text, kind: "chat", origin: "user" });
  });

  app.post("/api/operator/conversations/:id/stop", async (request) => {
    IdParams.parse(request.params);
    operator.stopActive();
    return { ok: true };
  });

  app.post("/api/operator/conversations/:id/new-session", async (request) => {
    const { id } = IdParams.parse(request.params);
    operator.newSession(id);
    return { ok: true };
  });

  app.put("/api/operator/settings", async (request) => {
    const body = OperatorSettingsUpdateSchema.parse(request.body);
    return operator.saveSettings(body);
  });

  app.get("/api/operator/orders", async () => ({ items: operator.listOrders() }));

  app.post("/api/operator/orders", async (request) => {
    const body = StandingOrderInputSchema.parse(request.body);
    return operator.saveStandingOrder(body);
  });

  app.put("/api/operator/orders/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    const body = StandingOrderInputSchema.parse(request.body);
    return operator.saveStandingOrder({ ...body, id });
  });

  app.delete("/api/operator/orders/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    operator.deleteOrder(id);
    return { ok: true };
  });

  app.post("/api/operator/skills/promote", async (request) => {
    const body = z.object({ path: z.string().min(1).max(300) }).strict().parse(request.body);
    return operator.promoteSkill(body.path);
  });

  app.post("/api/operator/open", async () => operator.openInCursor());
}
