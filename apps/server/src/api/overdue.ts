import { OverdueDecisionActionSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { AppError } from "../lib/errors.js";
import { getOverdueJob, listOverdueChecks, listOverdueJobs } from "../jobs/overdueStore.js";

const Params = z.object({ id: z.string().min(1) }).strict();
const DecisionBody = z.object({
  action: OverdueDecisionActionSchema,
  reason: z.string().min(1).max(600).optional(),
  extendMs: z.number().int().positive().optional(),
}).strict();

const DEFAULT_REASON: Record<string, string> = {
  wait: "Bạn chọn chờ thêm cho bước này.",
  abort_retry: "Bạn chọn dừng bước này và thử lại.",
  abort_fail: "Bạn chọn dừng hẳn bước này.",
  ask_user: "Bạn đã xem và để bước này chạy tiếp.",
};

/** TASK-125: history of overdue checks, and the user's own decision (same code path as the Hermes tool). */
export function registerOverdueRoutes(
  app: FastifyInstance,
  deps: { sqlite: Database.Database; orchestrator: Pick<PipelineOrchestrator, "decideOverdue"> },
): void {
  app.get("/api/jobs/:id/overdue-checks", async (request) => {
    const { id } = Params.parse(request.params);
    const job = getOverdueJob(deps.sqlite, id);
    return { job, checks: listOverdueChecks(deps.sqlite, id) };
  });

  // The running job of a project that is past its expected time, for the pipeline page (project permissions apply).
  app.get("/api/projects/:id/overdue", async (request) => {
    const { id } = Params.parse(request.params);
    const job = listOverdueJobs(deps.sqlite).find((item) => item.projectId === id) ?? null;
    return { job, checks: job ? listOverdueChecks(deps.sqlite, job.jobId) : [] };
  });

  app.post("/api/jobs/:id/overdue-decision", async (request) => {
    const { id } = Params.parse(request.params);
    const body = DecisionBody.parse(request.body);
    if (!getOverdueJob(deps.sqlite, id)) {
      throw new AppError(409, "JOB_NOT_OVERDUE", "Bước này không còn quá thời gian dự kiến.");
    }
    const result = deps.orchestrator.decideOverdue(id, {
      action: body.action,
      reason: body.reason ?? DEFAULT_REASON[body.action]!,
      ...(body.extendMs !== undefined ? { extendMs: body.extendMs } : {}),
      source: "user",
      actor: "user",
    });
    if (!result.ok) throw new AppError(409, "OVERDUE_DECISION_REFUSED", result.message);
    return result;
  });
}
