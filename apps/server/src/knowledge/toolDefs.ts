import {
  CHANGE_CATEGORIES, KnowledgeFilterSchema, KnowledgeIdSchema, KnowledgeImportSchema, KnowledgeProposalInputSchema,
} from "@vg/shared";
import { z } from "zod";
import type { AssistantToolDef } from "../assistant/tools.js";
import { ChangeInbox } from "./changeInbox.js";
import { KnowledgeService } from "./service.js";
import { AccountHealth } from "./accountHealth.js";
import { DriftMonitor } from "./driftMonitor.js";

export const knowledgeToolDefs: AssistantToolDef[] = [
  {
    name: "get_account_health", description: "Đọc độ phủ trạng thái, checklist và các lần đối chiếu tài khoản/video.", risk: "read",
    argsSchema: z.object({}).strict(), summarize: () => "Đọc checklist tài khoản",
    execute: async (_args, ctx) => ({ accounts: new AccountHealth(ctx.sqlite).checklist() }),
  },
  {
    name: "get_metric_series", description: "Đọc chuỗi chỉ số hằng ngày và phiên bản tri thức để điều tra lệch chỉ số.", risk: "read",
    argsSchema: z.object({ accountId: z.string().optional() }).strict(), summarize: () => "Đọc chuỗi chỉ số",
    execute: async (args, ctx) => {
      const { accountId } = z.object({ accountId: z.string().optional() }).parse(args);
      return { series: new DriftMonitor(ctx.sqlite).series().filter(x => !accountId || x.accountId === accountId),
        manualObservations: (JSON.parse(new ChangeInbox(ctx.sqlite).setting("change.manualMetrics") ?? "[]") as Array<{ accountId: string }>).filter(x => !accountId || x.accountId === accountId) };
    },
  },
  {
    name: "list_knowledge", description: "Liệt kê tri thức bên ngoài đang áp dụng.", risk: "read",
    argsSchema: KnowledgeFilterSchema, summarize: () => "Liệt kê tri thức",
    execute: async (args, ctx) => new KnowledgeService(ctx.sqlite).list(KnowledgeFilterSchema.parse(args)),
  },
  {
    name: "get_knowledge", description: "Đọc một mục tri thức, lịch sử và nơi sử dụng.", risk: "read",
    argsSchema: z.object({ id: KnowledgeIdSchema }).strict(), summarize: () => "Đọc một mục tri thức",
    execute: async (args, ctx) => new KnowledgeService(ctx.sqlite).inspect(z.object({ id: KnowledgeIdSchema }).parse(args).id),
  },
  {
    name: "list_stale_knowledge", description: "Liệt kê tri thức đã cũ.", risk: "read",
    argsSchema: KnowledgeFilterSchema, summarize: () => "Liệt kê tri thức đã cũ",
    execute: async (args, ctx) => new KnowledgeService(ctx.sqlite).list({ ...KnowledgeFilterSchema.parse(args), freshness: "stale" }),
  },
  {
    name: "list_change_catalog", description: "Đọc danh mục thay đổi bên ngoài.", risk: "read",
    argsSchema: z.object({}).strict(), summarize: () => "Đọc danh mục thay đổi",
    execute: async () => CHANGE_CATEGORIES,
  },
  {
    name: "propose_knowledge_change", description: "Tạo đề xuất sửa tri thức để app phân loại rủi ro.", risk: "confirm",
    argsSchema: KnowledgeProposalInputSchema, summarize: () => "Tạo đề xuất tri thức",
    execute: async (args, ctx) => {
      const { entry, reason } = KnowledgeProposalInputSchema.parse(args);
      return new KnowledgeService(ctx.sqlite).propose(entry, reason, "tool");
    },
  },
  {
    name: "import_knowledge", description: "Nhập dữ liệu tri thức để xem đề xuất hoặc làm mới nguồn.", risk: "confirm",
    argsSchema: KnowledgeImportSchema, summarize: () => "Nhập dữ liệu tri thức",
    execute: async (args, ctx) => {
      const { entries, label } = KnowledgeImportSchema.parse(args);
      return new KnowledgeService(ctx.sqlite).import(entries, label);
    },
  },
  {
    name: "list_change_events", description: "Đọc hộp thay đổi bên ngoài.", risk: "read",
    argsSchema: z.object({ status: z.string().max(40).optional(), severity: z.string().max(40).optional() }).strict(),
    summarize: () => "Đọc thay đổi bên ngoài",
    execute: async (args, ctx) => ({ events: new ChangeInbox(ctx.sqlite).list(z.object({ status: z.string().optional(), severity: z.string().optional() }).parse(args)) }),
  },
  {
    name: "resolve_change_event", description: "Đánh dấu một thay đổi đã xử lý và nhấc giữ.", risk: "confirm",
    argsSchema: z.object({ id: z.uuid() }).strict(),
    summarize: () => "Đóng một thay đổi",
    execute: async (args, ctx) => new ChangeInbox(ctx.sqlite).resolve(z.object({ id: z.uuid() }).parse(args).id),
  },
  {
    name: "report_change", description: "Ghi một thay đổi bạn thấy ở ngoài.", risk: "confirm",
    argsSchema: z.object({ category: z.string().min(1).max(20), summary: z.string().min(1).max(500), url: z.string().url().optional() }).strict(),
    summarize: () => "Báo một thay đổi",
    execute: async (args, ctx) => new ChangeInbox(ctx.sqlite).report(z.object({
      category: z.string(), summary: z.string(), url: z.string().optional(),
    }).parse(args)),
  },
];
