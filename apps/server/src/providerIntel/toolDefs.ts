import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { createUserRequest } from "../operator/autopilot.js";
import type { AssistantToolDef } from "../assistant/tools.js";
import {
  deleteAppCombo, omnirouteManage, patchOmnirouteProvider, readOmnirouteCombos, readOmnirouteHealth,
  readOmnirouteProviders, testOmnirouteProvider, upsertOmnirouteCombo,
} from "./omniroute.js";
import { providerIntel } from "./runtime.js";

const loose = z.object({}).passthrough();

function tool(
  name: string,
  description: string,
  risk: AssistantToolDef["risk"],
  execute: AssistantToolDef["execute"],
): AssistantToolDef {
  return {
    name,
    description,
    risk,
    argsSchema: loose,
    summarize: () => description,
    execute,
  };
}

const idArgs = z.object({ providerId: z.string().min(1).max(80) }).strict();

export const providerIntelToolDefs: AssistantToolDef[] = [
  tool("get_provider_intel_summary", "Tóm tắt nhà cung cấp.", "read", async () => providerIntel().summary()),
  tool("get_provider", "Đọc một hồ sơ nhà cung cấp.", "read", async (args) => providerIntel().getProvider(idArgs.parse(args).providerId)),
  tool("get_billing_risk", "Đọc rủi ro thanh toán.", "read", async (args) => {
    const provider = providerIntel().getProvider(idArgs.parse(args).providerId);
    return "billing" in provider ? provider.billing : { unverified: true, riskLevel: "CRITICAL" };
  }),
  tool("list_intel_changes", "Liệt kê thay đổi cần xem.", "read", async () => providerIntel().listChanges()),
  tool("list_offers", "Liệt kê ưu đãi.", "read", async () => providerIntel().page().offers),
  tool("get_omniroute_audit", "Đọc kiểm kê OmniRoute.", "read", async () => providerIntel().page().connections),
  tool("get_routing_proposals", "Đọc đề xuất định tuyến.", "read", async () => providerIntel().routingProposals()),
  tool("get_model_abilities", "Đọc năng lực model.", "read", async (args) => {
    const parsed = z.object({ modelId: z.string().min(1) }).parse(args);
    return providerIntel().modelAbilities(parsed.modelId);
  }),
  tool("get_model_scorecard", "Chấm model theo tác vụ.", "read", async (args) => {
    const parsed = z.object({
      taskId: z.string().min(1),
      budgetMode: z.enum(["ECO", "BALANCED", "QUALITY", "MAX", "CUSTOM"]).default("BALANCED"),
    }).parse(args);
    return providerIntel().scorecard(parsed.taskId as "script", parsed.budgetMode);
  }),
  tool("compare_models", "So sánh model theo tác vụ.", "read", async (args) => {
    const parsed = z.object({
      taskId: z.string().min(1).optional(),
      budgetMode: z.enum(["ECO", "BALANCED", "QUALITY", "MAX", "CUSTOM"]).default("BALANCED"),
      profileId: z.enum(["coding", "video", "agent", "embeddings"]).optional(),
    }).parse(args);
    if (parsed.taskId) return providerIntel().scorecard(parsed.taskId as "script", parsed.budgetMode);
    if (!parsed.profileId) throw new Error("Cần taskId hoặc profileId.");
    return providerIntel().recommend(parsed.profileId);
  }),
  tool("get_model_task_stats", "Đọc thống kê lần chạy thật.", "read", async () => providerIntel().taskStats()),
  tool("list_eval_suites", "Liệt kê bộ đánh giá.", "read", async () => providerIntel().page().suites),
  tool("get_eval_run", "Đọc một lần đánh giá.", "read", async (args) => providerIntel().getEvalRun(z.object({ runId: z.string().min(1) }).parse(args).runId)),
  tool("intel_fetch_page", "Lấy trang chính thức.", "read", async (args) => {
    const parsed = z.object({
      providerId: z.string().min(1),
      url: z.string().url(),
      pageKind: z.enum(["pricing", "docs", "tos", "privacy", "status", "changelog", "offer", "other"]),
    }).parse(args);
    return providerIntel().fetchPage(parsed.providerId, parsed.url, parsed.pageKind);
  }),
  tool("intel_submit_assessment", "Ghi nhận định có câu trích.", "read", async (args) => providerIntel().submitAssessment(z.object({
    providerId: z.string().min(1),
    pageId: z.string().min(1),
    fields: z.array(z.object({ path: z.string(), value: z.string(), quote: z.string() }).strict()).max(40),
  }).parse(args))),
  tool("intel_add_provider_stub", "Thêm nhà cung cấp chưa nghiên cứu.", "read", async (args) => providerIntel().addStub(z.object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    website: z.string().url(),
    categories: z.array(z.enum(["llm", "embedding", "rerank", "image", "video", "tts", "stt", "gpu", "cloud", "aggregator"])).min(1),
    discoveredFrom: z.string().optional(),
  }).parse(args))),
  tool("intel_set_offer", "Ghi ưu đãi có câu trích.", "read", async (args) => providerIntel().setOffer(z.object({
    providerId: z.string(),
    id: z.string(),
    kind: z.enum(["permanent_free", "monthly_free", "daily_free", "signup_credit", "promo_credit", "referral_credit", "startup_credit", "grant", "free_models_rate_limited", "chatbot_only_not_api"]),
    unit: z.enum(["usd", "tokens", "requests", "credits", "gpu_hours"]),
    appliesTo: z.enum(["api_inference", "cloud_other", "chat_ui"]),
    status: z.enum(["active", "expired", "unverified"]),
    expiresAt: z.string().nullable(),
    pageId: z.string(),
    quote: z.string(),
    amount: z.number(),
  }).parse(args))),
  tool("intel_run_job", "Chạy việc nhà cung cấp.", "read", async (args) => providerIntel().runJob(z.object({
    job: z.enum(["daily", "weekly", "monthly", "audit", "probes", "export"]),
  }).parse(args).job)),
  tool("intel_write_report", "Viết báo cáo nhà cung cấp.", "read", async (args) => {
    const parsed = z.object({
      kind: z.enum(["daily", "weekly", "changes", "full"]).default("weekly"),
      markdown: z.string().max(20_000).optional(),
    }).parse(args ?? {});
    return { markdown: providerIntel().writeReport(parsed.kind, parsed.markdown) };
  }),
  tool("intel_extract_page", "Trích fact từ trang đã lưu. Câu không khớp bị bỏ.", "read", async (args) => {
    const parsed = z.object({ pageId: z.string().min(1) }).parse(args);
    return providerIntel().extractStoredPage(parsed.pageId);
  }),
  tool("intel_submit_benchmark", "Ghi điểm benchmark có câu trích.", "read", async (args) => providerIntel().submitBenchmark(z.object({
    providerId: z.string(),
    modelId: z.string(),
    benchmark: z.string(),
    version: z.string(),
    score: z.number(),
    quote: z.string(),
    pageId: z.string(),
  }).parse(args))),
  tool("intel_next_research_batch", "Lấy batch cần nghiên cứu.", "read", async (args) => {
    const parsed = z.object({ limit: z.number().int().min(1).max(4).optional() }).parse(args ?? {});
    return providerIntel().nextResearchBatch(parsed.limit ?? 4);
  }),
  tool("intel_mark_researched", "Đánh dấu đã nghiên cứu.", "read", async (args) => {
    const parsed = z.object({
      providerId: z.string(),
      status: z.enum(["done", "failed", "todo"]),
      note: z.string().max(500).default(""),
    }).parse(args);
    return providerIntel().markResearched(parsed.providerId, parsed.status, parsed.note);
  }),
  tool("run_model_eval", "Chạy đánh giá model.", "read", async (args) => providerIntel().runEval(z.object({
    suiteIds: z.array(z.string()).min(1),
    modelIds: z.array(z.string()).min(1),
    models: z.array(z.object({
      id: z.string(),
      paid: z.boolean(),
      cookie: z.boolean(),
      quotaLeft: z.union([z.number(), z.literal("UNKNOWN"), z.literal("exhausted")]),
    }).strict()).min(1),
    approved: z.boolean().optional(),
    remainingRatio: z.number().optional(),
    projectId: z.string().optional(),
  }).parse(args))),
  tool("propose_route_change", "Đề xuất đổi định tuyến.", "confirm", async (args) => {
    const parsed = z.object({
      profileId: z.enum(["coding", "video", "agent", "embeddings"]),
      modelIds: z.array(z.string()),
    }).parse(args);
    return providerIntel().proposeRoute(parsed.profileId, parsed.modelIds);
  }),
  tool("apply_routing_proposal", "Áp dụng đề xuất định tuyến.", "confirm", async (args) => providerIntel().applyProposal(z.object({ proposalId: z.string().min(1) }).parse(args).proposalId)),
  tool("update_omniroute_combos", "Cập nhật combo OmniRoute.", "confirm", async (args) => {
    const parsed = z.object({
      profiles: z.array(z.object({ id: z.string(), models: z.array(z.string()) }).strict()),
      retestIds: z.array(z.string()).optional(),
    }).parse(args);
    return providerIntel().updateCombos(parsed.profiles, parsed.retestIds ?? []);
  }),
  tool("mark_change_reviewed", "Đánh dấu thay đổi đã xem.", "confirm", async (args) => providerIntel().markChangeReviewed(z.object({ changeId: z.string().min(1) }).parse(args).changeId)),
  tool("omniroute_health", "Đọc sức khoẻ model OmniRoute.", "read", async (_args, ctx) => readOmnirouteHealth(requireToken(ctx.sqlite))),
  tool("omniroute_list_providers", "Liệt kê kết nối OmniRoute, không gồm bí mật.", "read", async (_args, ctx) => readOmnirouteProviders(requireToken(ctx.sqlite))),
  tool("omniroute_test_provider", "Thử một kết nối OmniRoute.", "safe", async (args, ctx) => testOmnirouteProvider(requireToken(ctx.sqlite), z.object({ id: z.string().min(1) }).parse(args).id)),
  tool("omniroute_set_provider_state", "Bật, tắt hoặc đổi ưu tiên kết nối OmniRoute.", "confirm", async (args, ctx) => {
    const parsed = z.object({ id: z.string().min(1), patch: z.record(z.string(), z.unknown()) }).parse(args);
    return patchOmnirouteProvider(requireToken(ctx.sqlite), parsed.id, parsed.patch);
  }),
  tool("omniroute_list_combos", "Đọc combo OmniRoute.", "read", async (_args, ctx) => readOmnirouteCombos(requireToken(ctx.sqlite))),
  tool("omniroute_upsert_combo", "Tạo hoặc sửa combo OmniRoute.", "confirm", async (args, ctx) => {
    const parsed = z.object({ id: z.string().optional(), name: z.string().min(1), models: z.array(z.string()), knownModels: z.array(z.string()) }).parse(args);
    return upsertOmnirouteCombo(requireToken(ctx.sqlite), parsed, parsed.knownModels);
  }),
  tool("omniroute_delete_combo", "Xoá combo vg- do app tạo.", "confirm", async (args, ctx) => deleteAppCombo(requireToken(ctx.sqlite), z.object({ id: z.string(), name: z.string() }).parse(args))),
];

function requireToken(sqlite: import("better-sqlite3").Database) {
  let ctx;
  try { ctx = omnirouteManage(); } catch { throw new AppError(503, "OMNIROUTE", "Chưa nối OmniRoute."); }
  if (!ctx.token) {
    createUserRequest(sqlite, {
      kind: "needs_key", title: "Token quản trị OmniRoute", whyVi: "Cần token để đọc và sửa cổng OmniRoute.",
      actionUrl: "/settings/connections?provider=omniroute", dedupeKey: "omniroute-management-token", checkKind: "secret",
    });
    throw new AppError(400, "OMNIROUTE_TOKEN", "Thiếu token quản trị OmniRoute. Đã tạo yêu cầu Cần bạn.");
  }
  return ctx;
}
