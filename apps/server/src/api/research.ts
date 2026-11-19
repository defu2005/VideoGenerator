import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { selfImprovementBudgetStatus, selfImprovementSettings, saveSelfImprovementSettings } from "../operator/autonomyBudget.js";
import { RunResearchSchema } from "../research/service.js";
import type { ResearchHub } from "../research/runtime.js";

export function registerResearchRoutes(app: FastifyInstance, db: Database.Database, hub: ResearchHub) {
  function userOnly(request: FastifyRequest) {
    if (request.actor?.kind !== "user") throw new AppError(403, "RESEARCH_USER_ONLY", "Chỉ người dùng đăng nhập được khởi chạy thủ công hoặc đổi ngân sách.");
  }
  app.get("/api/research", async () => ({ runs: hub.service().list(), skills: hub.skills().map(({ name, description, research }) => ({ name, description, research })),
    settings: selfImprovementSettings(db), budget: selfImprovementBudgetStatus(db), runtimes: hub.runtimes() }));
  app.get("/api/research/runs/:id", async (request) => hub.service().get(z.object({ id: z.uuid() }).parse(request.params).id));
  app.post("/api/research/runs", async (request) => { userOnly(request); return hub.service().run({ ...RunResearchSchema.parse(request.body), trigger: "user" }, { manual: true }); });
  app.put("/api/research/settings", async (request) => {
    userOnly(request);
    const body = request.body as { runtime?: unknown } | undefined;
    if (body?.runtime !== undefined && !hub.runtimes().some((runtime) => runtime.id === body.runtime)) throw new AppError(400, "RESEARCH_RUNTIME_UNAVAILABLE", "Agent được chọn không có khả năng nghiên cứu web.");
    return { settings: saveSelfImprovementSettings(db, request.body) };
  });
}
