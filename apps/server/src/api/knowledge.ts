import {
  CHANGE_CATEGORIES, KnowledgeDecisionSchema, KnowledgeFilterSchema, KnowledgeIdSchema,
  KnowledgeImportSchema, KnowledgeProposalInputSchema, KnowledgeRollbackSchema,
} from "@vg/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { z } from "zod";
import { ChangeInbox } from "../knowledge/changeInbox.js";
import { AccountHealth } from "../knowledge/accountHealth.js";
import { DriftMonitor } from "../knowledge/driftMonitor.js";
import type { KnowledgeService } from "../knowledge/service.js";
import { AppError } from "../lib/errors.js";
import { isBlockedHostname } from "../services/imageStore.js";

const id = z.object({ id: KnowledgeIdSchema });
const proposalId = z.object({ id: z.uuid() });
const changeId = z.object({ id: z.uuid() });
const changeQuery = z.object({ status: z.string().max(40).optional(), severity: z.string().max(40).optional() });
const reportBody = z.object({ category: z.string().min(1).max(20), summary: z.string().min(1).max(500), url: z.string().url().optional() }).strict();
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const localIps = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function registerKnowledgeRoutes(app: FastifyInstance, knowledge: KnowledgeService, webOrigin: string, sqlite?: Database.Database): void {
  function owner(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (!localIps.has(request.ip) || typeof origin !== "string" || !URL.canParse(origin)
        || (origin !== webOrigin && !localHosts.has(new URL(origin).hostname))
        || request.headers["sec-fetch-site"] !== "same-origin"
        || request.headers["x-vg-tool-source"] !== undefined) {
      throw new AppError(403, "OWNER_UI_REQUIRED", "Mở giao diện cục bộ để thay đổi tri thức.");
    }
  }
  const changes = sqlite ? new ChangeInbox(sqlite) : null;
  app.get("/api/knowledge/health", async () => ({
    accounts: sqlite ? new AccountHealth(sqlite).checklist() : [],
    delivery: changes?.setting("change.webhookUrl") ? "polling+webhook" : "polling",
    webhook: changes?.setting("change.webhookUrl") ? "Đã ghi URL webhook. Cần cấu hình cùng URL trong TikTok Developer Portal; polling vẫn hoạt động." : "Chưa cấu hình webhook HTTPS công khai; trạng thái chỉ có qua webhook cần kiểm tra thủ công.",
    settings: { offline: changes?.setting("change.offline") === "true", eco: changes?.setting("change.eco") === "true", webhookUrl: changes?.setting("change.webhookUrl") ?? "" },
  }));
  app.post("/api/knowledge/health/checks", async request => {
    owner(request);
    if (!sqlite) throw new AppError(503, "CHANGES_UNAVAILABLE", "Chưa gắn bộ kiểm tra.");
    return new AccountHealth(sqlite).manual(request.body);
  });
  app.post("/api/knowledge/health/settings", async request => {
    owner(request);
    if (!changes) throw new AppError(503, "CHANGES_UNAVAILABLE", "Chưa gắn bộ kiểm tra.");
    const input = z.object({ offline: z.boolean(), eco: z.boolean(), webhookUrl: z.union([z.literal(""), z.url().refine(value => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
        && !isBlockedHostname(url.hostname.replace(/^\[|\]$/g, "")) && url.pathname === "/api/knowledge/webhooks/tiktok";
    }, "Dùng URL HTTPS công khai kết thúc bằng /api/knowledge/webhooks/tiktok.")]).optional() }).strict().parse(request.body);
    changes.putSetting("change.offline", String(input.offline)); changes.putSetting("change.eco", String(input.eco));
    if (input.webhookUrl !== undefined) changes.putSetting("change.webhookUrl", input.webhookUrl);
    return input;
  });
  app.get("/api/knowledge/metrics", async () => ({ series: sqlite ? new DriftMonitor(sqlite).series() : [],
    manualObservations: JSON.parse(changes?.setting("change.manualMetrics") ?? "[]") }));
  app.post("/api/knowledge/metrics", async request => {
    owner(request);
    if (!sqlite) throw new AppError(503, "CHANGES_UNAVAILABLE", "Chưa gắn bộ kiểm tra.");
    new DriftMonitor(sqlite).recordManual(request.body);
    return { recorded: true };
  });
  app.get("/api/knowledge/changes", async (request) => ({ events: changes?.list(changeQuery.parse(request.query)) ?? [] }));
  app.post("/api/knowledge/changes/report", async (request) => {
    owner(request);
    if (!changes) throw new AppError(503, "CHANGES_UNAVAILABLE", "Hộp thay đổi chưa gắn.");
    return changes.report(reportBody.parse(request.body));
  });
  app.post("/api/knowledge/changes/:id/resolve", async (request) => {
    owner(request);
    if (!changes) throw new AppError(503, "CHANGES_UNAVAILABLE", "Hộp thay đổi chưa gắn.");
    return changes.resolve(changeId.parse(request.params).id);
  });
  app.post("/api/knowledge/changes/:id/continue", async (request) => {
    owner(request);
    if (!changes) throw new AppError(503, "CHANGES_UNAVAILABLE", "Hộp thay đổi chưa gắn.");
    return changes.continueEvent(changeId.parse(request.params).id);
  });
  app.get("/api/knowledge", async (request) => ({ entries: knowledge.list(KnowledgeFilterSchema.parse(request.query)) }));
  app.get("/api/knowledge/catalog", async () => ({ categories: CHANGE_CATEGORIES }));
  app.get("/api/knowledge/proposals", async () => ({ proposals: knowledge.proposals() }));
  app.get("/api/knowledge/history", async () => ({ entries: knowledge.revisedEntries() }));
  app.get("/api/knowledge/:id", async (request) => knowledge.inspect(id.parse(request.params).id));
  app.post("/api/knowledge/import", async (request) => {
    owner(request);
    const { entries, label } = KnowledgeImportSchema.parse(request.body);
    return knowledge.import(entries, label);
  });
  app.post("/api/knowledge/proposals", async (request) => {
    owner(request);
    const { entry, reason } = KnowledgeProposalInputSchema.parse(request.body);
    return knowledge.propose(entry, reason);
  });
  for (const [action, decision] of [["accept", "accepted"], ["reject", "rejected"]] as const) {
    app.post(`/api/knowledge/proposals/:id/${action}`, async (request) => {
      owner(request);
      const { reason } = KnowledgeDecisionSchema.parse(request.body ?? {});
      return knowledge.decide(proposalId.parse(request.params).id, decision, reason);
    });
  }
  app.post("/api/knowledge/:id/rollback", async (request) => {
    owner(request);
    const { revision, reason } = KnowledgeRollbackSchema.parse(request.body);
    return knowledge.rollback(id.parse(request.params).id, revision, reason);
  });
}
