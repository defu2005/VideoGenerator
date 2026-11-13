import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { AutonomyBudgetSchema, AutonomySettingsSchema, DEFAULT_AUTONOMY_BUDGET, GoalSpecSchema } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { autonomySettings, effectiveAutonomy, repairSettingsFor, saveAutonomySettings } from "../operator/autonomy.js";
import { readAutonomyBudget, saveAutonomyBudget } from "../operator/autonomyBudget.js";
import {
  applyGoalToAutomation, buildDigest, createUserRequest, listGoals, listOpenRequests, preferenceBlock,
  raiseCode, saveGoal, savePreference, setDrain, stopAutonomy,
} from "../operator/autopilot.js";
import { listSupervisorState } from "../operator/supervisor.js";
import { undoAudit } from "../operator/undo.js";
import { activeRepairs, listRepairLog, repairSummarySuffix, reopenShelved } from "../operator/qualityRepair.js";

const scopeSchema = z.object({ scope: z.union([z.literal("app"), z.string().uuid()]) });
const local = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function registerAutonomyRoutes(app: FastifyInstance, sqlite: Database.Database, webOrigin: string): void {
  function scope(params: unknown): string | undefined {
    const { scope } = scopeSchema.parse(params);
    if (scope === "app") return undefined;
    if (!sqlite.prepare("SELECT 1 FROM profiles WHERE id = ? AND archived_at IS NULL").get(scope)) {
      throw new AppError(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ.");
    }
    return scope;
  }

  app.get("/api/autonomy/:scope", async (request) => {
    const id = scope(request.params);
    return {
      settings: autonomySettings(sqlite, id), effective: effectiveAutonomy(sqlite, { profileId: id }),
      repair: repairSettingsFor(sqlite, id ?? null),
    };
  });

  const projectIdSchema = z.object({ id: z.string().uuid() });
  app.get("/api/projects/:id/quality-repairs", async (request) => {
    const { id } = projectIdSchema.parse(request.params);
    return { ...listRepairLog(sqlite, id), summary: repairSummarySuffix(sqlite, id).replace(/^ · /, "") };
  });
  app.get("/api/quality-repairs/active", async () => ({ items: activeRepairs(sqlite) }));

  function requireLocalOwner(request: FastifyRequest): void {
    const origin = request.headers.origin;
    const isLocalUi = typeof origin === "string" && URL.canParse(origin)
      && (origin === webOrigin || local.has(new URL(origin).hostname));
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)
        || !isLocalUi || request.headers["sec-fetch-site"] !== "same-origin"
        || request.headers["x-vg-tool-source"] !== undefined) {
      throw new AppError(403, "OWNER_UI_REQUIRED", "Chỉ chủ app mới đổi quyền từ giao diện cục bộ.");
    }
  }

  app.post("/api/projects/:id/quality-repairs/reopen", async (request) => {
    requireLocalOwner(request);
    const { id } = projectIdSchema.parse(request.params);
    return reopenShelved(sqlite, id);
  });

  app.post("/api/autonomy/:scope", async (request) => {
    requireLocalOwner(request);
    const id = scope(request.params);
    const settings = AutonomySettingsSchema.parse(request.body);
    saveAutonomySettings(sqlite, settings, id);
    return { settings, effective: effectiveAutonomy(sqlite, { profileId: id }) };
  });

  function budgetResponse(id?: string) {
    const overrides = readAutonomyBudget(sqlite, id);
    const app = { ...DEFAULT_AUTONOMY_BUDGET, ...readAutonomyBudget(sqlite) };
    return { overrides, app, effective: { ...app, ...overrides } };
  }

  app.get("/api/autonomy/:scope/budget", async (request) => budgetResponse(scope(request.params)));
  app.get("/api/autonomy/:scope/supervisor", async (request) => listSupervisorState(sqlite, scope(request.params)));
  app.post("/api/autonomy/:scope/budget", async (request) => {
    requireLocalOwner(request);
    const id = scope(request.params);
    saveAutonomyBudget(sqlite, AutonomyBudgetSchema.partial().parse(request.body), id);
    return budgetResponse(id);
  });

  app.get("/api/autonomy/:scope/goals", async (request) => ({ goals: listGoals(sqlite, scope(request.params) ?? null) }));
  app.post("/api/autonomy/:scope/goals", async (request) => {
    requireLocalOwner(request);
    const body = z.object({ text: z.string().min(1).max(2000), spec: GoalSpecSchema }).parse(request.body);
    const saved = saveGoal(sqlite, { profileId: scope(request.params), text: body.text, spec: body.spec, source: "web" });
    return saved;
  });
  app.post("/api/autonomy/:scope/plan", async (request) => {
    requireLocalOwner(request);
    const id = scope(request.params);
    if (!id) throw new AppError(400, "PROFILE_REQUIRED", "Kế hoạch ngày gắn với một hồ sơ.");
    return applyGoalToAutomation(sqlite, id);
  });
  app.get("/api/autonomy/:scope/preferences", async (request) => ({
    script: preferenceBlock(sqlite, scope(request.params) ?? null, "script"),
    tts: preferenceBlock(sqlite, scope(request.params) ?? null, "tts"),
  }));
  app.post("/api/autonomy/:scope/preferences", async (request) => {
    requireLocalOwner(request);
    const body = z.object({
      rule: z.string().min(1).max(300),
      quote: z.string().min(1).max(2000),
      scope: z.array(z.enum(["script", "tts", "render", "thumbnail", "metadata", "publish", "comments", "routing"])).min(1),
    }).parse(request.body);
    const profileId = scope(request.params);
    const guideline = profileId
      ? sqlite.prepare("SELECT guidelines FROM profiles WHERE id = ?").get(profileId) as { guidelines: string } | undefined
      : undefined;
    return savePreference(sqlite, { profileId, ...body, guideline: guideline?.guidelines ?? "" });
  });
  app.get("/api/operator/requests", async () => ({ requests: listOpenRequests(sqlite) }));
  app.post("/api/operator/requests", async (request) => {
    requireLocalOwner(request);
    const body = z.object({
      profileId: z.string().uuid().optional(),
      kind: z.enum(["needs_key", "reconnect_account", "platform_app", "budget", "approve", "info"]),
      title: z.string().min(1), whyVi: z.string().min(1), actionUrl: z.string().min(1), dedupeKey: z.string().min(1),
    }).parse(request.body);
    return createUserRequest(sqlite, { ...body, checkKind: body.kind });
  });
  app.get("/api/operator/digest", async () => buildDigest(sqlite));
  app.post("/api/autonomy/stop", async (request) => {
    requireLocalOwner(request);
    stopAutonomy(sqlite);
    return { level: "assist" };
  });
  app.post("/api/autonomy/raise-code", async (request) => {
    requireLocalOwner(request);
    return { code: raiseCode(sqlite) };
  });
  app.get("/api/operator/journal", async (request) => {
    const query = z.object({
      tool: z.string().optional(),
      origin: z.string().optional(),
    }).parse(request.query);
    const rows = sqlite.prepare(`SELECT id, tool, decision, summary, origin, reason, undo, created_at AS createdAt
      FROM operator_tool_audit
      WHERE (? IS NULL OR tool = ?) AND (? IS NULL OR origin = ?)
      ORDER BY created_at DESC LIMIT 50`).all(query.tool ?? null, query.tool ?? null, query.origin ?? null, query.origin ?? null);
    return {
      rows: (rows as Array<{ undo: string | null }>).map((row) => ({
        ...row,
        undo: row.undo ? JSON.parse(row.undo) as unknown : null,
      })),
    };
  });
  app.post("/api/operator/journal/:id/undo", async (request) => {
    requireLocalOwner(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return undoAudit(sqlite, id);
  });
  app.post("/api/operator/drain", async (request) => {
    requireLocalOwner(request);
    const body = z.object({ draining: z.boolean() }).parse(request.body);
    const state = setDrain(sqlite, body.draining);
    const running = sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'RUNNING'").get() as { n: number };
    return { ...state, running: running.n, idle: running.n === 0 };
  });
}
