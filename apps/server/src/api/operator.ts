import { OperatorSettingsUpdateSchema, StandingOrderInputSchema } from "@vg/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { OperatorService } from "../operator/service.js";
import type Database from "better-sqlite3";
import { deleteProfileMemory, listProfileMemories, saveProfileMemory } from "../operator/profileContext.js";
import { AppError } from "../lib/errors.js";
import { currentDuty, listInstances } from "../supervision/duty.js";
import { listEscalations } from "../supervision/escalations.js";
import { listLiveLeases } from "../supervision/leases.js";
import { getOperatorPause } from "../supervision/pause.js";
import { acceptToolProposal, checkToolProposalDone, dismissToolProposal, listAcceptedToolProposals, listDoneToolProposals, listInProgressToolProposals, listToolProposals, startToolProposal, ToolProposalTaskRef } from "../operator/toolProposals.js";
import { draftProposal, type DraftRunner } from "../operator/proposalDraft.js";
import { LlmError } from "../providers/llm/types.js";
import { computerUseStatus, saveComputerUseSettings, stopComputerUse } from "../computerUse/service.js";
import { collectOperatorEvents, listOperatorEvents, listOperatorEventRules, OperatorEventRule, operatorEventTrace, saveOperatorEventRule } from "../operator/events.js";

const IdParams = z.object({ id: z.string().min(1).max(80) }).strict();

const MemoryParams = z.object({ profileId: z.string().uuid(), id: z.string().uuid() }).strict();
const MemoryBody = z.object({ text: z.string().trim().min(1).max(4000) }).strict();

// TASK-074c-3c-2: the draft runner (the model) and the target root are injected by the server wiring. Without them the draft route refuses.
// TASK-074c-6e: tasksRoot is the folder of TASK-….done files. Without it the check-done route refuses.
export function registerOperatorRoutes(
  app: FastifyInstance, operator: OperatorService, sqlite: Database.Database, proposalDraft?: { runner: DraftRunner; root: string }, tasksRoot?: string,
): void {
  // TASK-074b-4: only a signed-in user may write a user_edit draft or activate a skill by hand. An API key bound to an
  // owner would otherwise pass operator.use and skip the behaviour gate, which exempts user_edit drafts.
  const userOnly = (request: FastifyRequest) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_SKILL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được sửa hoặc kích hoạt skill.");
  };
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
  app.get("/api/operator/tool-proposals", async () => ({ items: listToolProposals(sqlite, app.log) }));
  // TASK-074c-4b-2: reading is not a decision, so there is no user-only check here. Accepting stays user-only.
  app.get("/api/operator/tool-proposals/accepted", async () => ({ items: listAcceptedToolProposals(sqlite, app.log) }));
  // TASK-074c-6b: read-only, no user-only check, same as the accepted list.
  app.get("/api/operator/tool-proposals/in-progress", async () => ({ items: listInProgressToolProposals(sqlite, app.log) }));
  // TASK-074c-6g: read-only, no user-only check, same as the other lists. The done rows are the first reader of task_ref.
  app.get("/api/operator/tool-proposals/done", async () => ({ items: listDoneToolProposals(sqlite, app.log) }));
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
    userOnly(request);
    const { name } =z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/) }).strict().parse(request.params);
    const { markdown, baseVersion } = z.object({ markdown: z.string().min(1).max(12_000), baseVersion: z.number().int().positive().optional() }).strict().parse(request.body);
    return operator.saveSkillEdit(name, markdown, baseVersion);
  });
  app.get("/api/operator/learning-report", async () => operator.learningReport());
  app.post("/api/operator/skills/:name/versions/:version/activate", async (request) => {
    userOnly(request);
    const { name, version } = z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), version: z.coerce.number().int().positive(),
    }).strict().parse(request.params);
    operator.activateSkill(name, version);
    return { ok: true };
  });
  // TASK-074b-3b: eval only stores a result; shadow only records routing matches. Neither runs a skill.
  app.post("/api/operator/skills/:name/versions/:version/behaviour-eval", async (request) => {
    const { name, version } = z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), version: z.coerce.number().int().positive(),
    }).strict().parse(request.params);
    return operator.runSkillBehaviourEval(name, version);
  });
  app.post("/api/operator/skills/:name/versions/:version/shadow", async (request) => {
    const { name, version } = z.object({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/), version: z.coerce.number().int().positive(),
    }).strict().parse(request.params);
    operator.setShadowSkill(name, version);
    return { ok: true };
  });
  app.delete("/api/operator/skills/:name/shadow", async (request) => {
    const { name } = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/) }).strict().parse(request.params);
    return { ok: true, cleared: operator.clearShadowSkill(name) };
  });
  // TASK-074c-6k: dismissing is the human's decision, like accept, so an API key (e.g. the MCP key) must not dismiss.
  app.post("/api/operator/tool-proposals/:id/dismiss", async (request) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_TOOL_PROPOSAL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được bỏ đề xuất.");
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    dismissToolProposal(sqlite, id);
    return { ok: true };
  });
  // TASK-074c-4b-1: accepting is the human's decision, so the operator must not be able to accept its own request.
  app.post("/api/operator/tool-proposals/:id/accept", async (request) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_TOOL_PROPOSAL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được chấp nhận đề xuất.");
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    acceptToolProposal(sqlite, id);
    return { ok: true };
  });
  // TASK-074c-6a: starting work is the human's call too. Only a drafted accepted row moves (the store checks that).
  app.post("/api/operator/tool-proposals/:id/start", async (request) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_TOOL_PROPOSAL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được đánh dấu đang làm.");
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    startToolProposal(sqlite, id);
    return { ok: true };
  });
  // TASK-074c-6e: the user confirms a task is done. Only an in_progress tool row moves, and only when its .done file exists under tasksRoot.
  app.post("/api/operator/tool-proposals/:id/check-done", async (request) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_TOOL_PROPOSAL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được xác nhận task đã xong.");
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    if (!tasksRoot) throw new AppError(503, "OPERATOR_TASKS_ROOT_UNAVAILABLE", "Chưa cấu hình thư mục task.");
    const { task } = z.object({ task: ToolProposalTaskRef }).strict().parse(request.body);
    checkToolProposalDone(sqlite, id, task, tasksRoot);
    return { ok: true };
  });
  // TASK-074c-3c-2: drafting spends the model budget, so it is the human's call too. The absolute path never leaves the server.
  app.post("/api/operator/tool-proposals/:id/draft", async (request) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "OPERATOR_TOOL_PROPOSAL_USER_ONLY", "Chỉ người dùng đăng nhập qua giao diện được soạn bản nháp.");
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    if (!proposalDraft) throw new AppError(503, "OPERATOR_PROPOSAL_DRAFT_UNAVAILABLE", "Chưa cấu hình nơi soạn bản nháp.");
    // An LLM failure becomes a coded error with a fixed message. The runner's text never reaches the body; the row stays accepted with its number.
    const result = await draftProposal(sqlite, id, proposalDraft).catch((error: unknown): never => {
      if (!(error instanceof LlmError)) throw error;
      request.log.warn({ err: error, code: error.code }, "Proposal draft LLM failure");
      if (error.code === "AUTONOMY_BUDGET_WAIT") {
        throw new AppError(429, "OPERATOR_PROPOSAL_DRAFT_BUDGET_WAIT", "Hạn mức chi của hệ thống đã hết. Chờ kỳ ngân sách mới rồi soạn lại.", { retryAt: error.retryAt ?? null });
      }
      throw new AppError(502, "OPERATOR_PROPOSAL_DRAFT_LLM_FAILED", "Model không soạn được bản nháp. Thử lại sau.");
    });
    if (result.status === "drafted") return { status: "drafted", impNumber: result.impNumber };
    return result;
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
