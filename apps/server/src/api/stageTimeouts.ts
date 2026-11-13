import {
  ProjectSchema,
  baselineStageTimeouts,
  isPlannedTimeoutStage,
  timeoutBriefFromSettings,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { AppError } from "../lib/errors.js";
import { ensureStageTimeoutPlan } from "../pipeline/stageTimeoutPlan.js";
import { touchFromOwner } from "../operator/autopilot.js";
import { stageTimeoutMinutes, writeStageTimeoutStages } from "../pipeline/stageTimeoutOverrides.js";

const Params = z.object({ id: z.string().uuid() }).strict();
const OverrideBody = z.object({
  stage: z.string(),
  timeoutSec: z.number().positive().nullable(),
}).strict();

export function registerStageTimeoutRoutes(
  app: FastifyInstance,
  deps: { sqlite: Database.Database; registry: LlmProviderRegistry; jobs: JobRepository },
): void {
  app.post("/api/projects/:id/stage-timeouts/recompute", async (request) => {
    const { id } = Params.parse(request.params);
    const project = deps.jobs.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    if (deps.jobs.getActiveJob(id)) {
      throw new AppError(409, "JOB_RUNNING", "Đang có bước chạy. Thời gian mới áp dụng ở lượt sau.");
    }
    await ensureStageTimeoutPlan({
      project,
      sqlite: deps.sqlite,
      registry: deps.registry,
      signal: AbortSignal.timeout(30_000),
      force: true,
      log: (message) => request.log.warn(message),
    });
    const next = deps.jobs.getProject(id);
    if (!next) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    return ProjectSchema.parse(next);
  });

  app.patch("/api/projects/:id/stage-timeouts", async (request) => {
    const { id } = Params.parse(request.params);
    const body = OverrideBody.parse(request.body);
    if (!isPlannedTimeoutStage(body.stage)) {
      throw new AppError(400, "UNKNOWN_STAGE", "Bước này không có thời gian tối đa riêng.");
    }
    const stage = body.stage;
    const project = deps.jobs.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án.");
    touchFromOwner(request.headers, deps.sqlite, `project:${id}:timeouts`);
    const brief = timeoutBriefFromSettings(project.settings, project.topic);
    const baseline = baselineStageTimeouts(brief);
    if (body.timeoutSec === null) {
      writeStageTimeoutStages(deps.sqlite, project, (stages) => {
        stages[stage] = {
          timeoutMs: baseline[stage],
          reason: "Ước lượng theo thời lượng và phong cách.",
          source: "baseline",
        };
      });
    } else {
      const { stages } = stageTimeoutMinutes(project, { [stage]: body.timeoutSec / 60 });
      writeStageTimeoutStages(deps.sqlite, project, (next) => {
        Object.assign(next, stages);
      });
    }
    const next = deps.jobs.getProject(id);
    return ProjectSchema.parse(next);
  });
}
