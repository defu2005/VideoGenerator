import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../lib/config.js";
import type Database from "better-sqlite3";
import {
  exportSkillReports,
  listAgents,
  listSkillReports,
  openSkillClaims,
  releaseSkillClaim,
  setUserVerdict,
  skillReportDetail,
  skillReportSummary,
} from "../reports/skillReportService.js";

const VerdictBody = z.object({
  metrics: z.array(z.object({ name: z.string(), actual: z.number().nullable() }).strict()).max(12),
  verdict: z.enum(["dung", "sai", "chua_ro"]),
  lesson: z.string().max(4000).optional(),
}).strict();

export function registerSkillReportRoutes(app: FastifyInstance, sqlite: Database.Database, config: AppConfig): void {
  app.get("/api/skill-reports/meta", async () => ({ environment: config.VG_ENVIRONMENT }));

  app.get("/api/skill-reports", async (request) => {
    const query = z.object({
      skill: z.string().optional(),
      profileId: z.string().uuid().optional(),
      agentKind: z.string().optional(),
      environment: z.string().optional(),
      status: z.string().optional(),
      verdict: z.string().optional(),
      due: z.enum(["1", "true"]).optional(),
    }).strict().parse(request.query);
    const items = listSkillReports(sqlite, { ...query, due: Boolean(query.due) });
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const overlap = sqlite.prepare(
      `SELECT DISTINCT profile_name AS profileName, app_environment AS environment
       FROM skill_reports
       WHERE source = 'import' AND created_at >= ? AND profile_name IS NOT NULL AND app_environment <> ?`,
    ).all(since, config.VG_ENVIRONMENT) as Array<{ profileName: string; environment: string }>;
    return { items, overlap, environment: config.VG_ENVIRONMENT };
  });

  app.get("/api/skill-reports/summary", async () => ({ items: skillReportSummary(sqlite) }));

  app.get("/api/skill-reports/export", async (request, reply) => {
    const { since } = z.object({ since: z.string().optional() }).strict().parse(request.query);
    const body = exportSkillReports(sqlite, since);
    return reply.type("application/x-ndjson").send(body);
  });

  app.get("/api/skill-reports/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    return skillReportDetail(sqlite, id);
  });

  app.post("/api/skill-reports/:id/verdict", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    const body = VerdictBody.parse(request.body);
    return setUserVerdict(sqlite, { id, ...body });
  });

  app.get("/api/agents", async () => ({
    items: listAgents(sqlite),
    claims: openSkillClaims(sqlite),
  }));

  app.post("/api/skill-reports/claims/:id/release", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(request.params);
    return releaseSkillClaim(sqlite, id);
  });
}
