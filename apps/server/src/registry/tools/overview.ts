// TASK-085: overview tool group (registry entries 11-24, same order). Moved verbatim.
import { CreateRevenueEntryBodySchema, ListPublicationsQuerySchema, PlatformIdSchema, enumerateSlots, localDateString, addLocalDays } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { getAppLlmSettings } from "../../providers/llm/settings.js";
import { getNotificationTimezone, getNotificationSettings } from "../../settings/notifications.js";
import type { AssistantToolDef } from "./define.js";
import { defineTool } from "./define.js";
import { emptyObject } from "./shared.js";

export function periodToRange(days: number, now: Date, timezone: string): { from: string; to: string } {
  const to = localDateString(now, timezone);
  return { from: addLocalDays(to, 1 - days), to };
}

const listTopicsArgs = z.object({
  profileId: z.string().uuid(),
  status: z.enum(["PENDING", "APPROVED", "IN_PRODUCTION", "DONE", "REJECTED", "FAILED"]).optional(),
}).strict();

const listPublicationsArgs = z.object({
  status: z.enum(["QUEUED", "SCHEDULED", "UPLOADING", "PUBLISHED", "FAILED", "CANCELLED"]).optional(),
  profileId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict();

const publishCalendarArgs = z.object({
  profileId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(30).default(7),
}).strict();

const usageSummaryArgs = z.object({
  period: z.enum(["today", "7d", "30d"]).default("7d"),
  groupBy: z.enum(["day", "provider", "model", "project"]).default("provider"),
}).strict();

const analyticsOverviewArgs = z.object({
  period: z.enum(["7d", "28d", "90d"]).default("7d"),
  profileId: z.string().uuid().optional(),
  platform: PlatformIdSchema.optional(),
}).strict();

const videoMetricsArgs = z.object({
  publicationId: z.string().uuid(),
}).strict();

const financeSummaryArgs = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
  profileId: z.string().uuid().optional(),
}).strict();

const monthlyReportArgs = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
}).strict();

const addRevenueEntryArgs = CreateRevenueEntryBodySchema;

const listAccountsArgs = z.object({ profileId: z.string().uuid() }).strict();

export const overviewToolDefs: AssistantToolDef[] = [
  defineTool({
    name: "list_topics",
    description: "Hàng đợi chủ đề của một hồ sơ.",
    risk: "read",
    argsSchema: listTopicsArgs,
    summarize: () => "Xem chủ đề",
    execute: async (args, ctx) => {
      const { profileId, status } = listTopicsArgs.parse(args);
      return ctx.topics.listTopics(profileId, status ? { status } : {});
    },
  }),
  defineTool({
    name: "automation_status",
    description: "Trạng thái tự động hóa toàn app và từng hồ sơ.",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem trạng thái tự động hóa",
    execute: async (_args, ctx) => ctx.automation.getStatus(),
  }),
  defineTool({
    name: "list_publications",
    description: "Danh sách lượt đăng (lọc trạng thái, hồ sơ, khoảng thời gian).",
    risk: "read",
    argsSchema: listPublicationsArgs,
    summarize: () => "Xem lượt đăng",
    execute: async (args, ctx) => {
      const parsed = listPublicationsArgs.parse(args);
      const base = ListPublicationsQuerySchema.parse({
        status: parsed.status,
        profileId: parsed.profileId,
      });
      const { items } = ctx.publish.listGlobal(base);
      const filtered = items.filter((item) => {
        const when = item.scheduledFor ?? item.createdAt;
        if (parsed.from && when < parsed.from) return false;
        if (parsed.to && when > parsed.to) return false;
        return true;
      });
      return { items: filtered };
    },
  }),
  defineTool({
    name: "publish_calendar",
    description: "Lịch đăng N ngày tới: slot tự động hóa + lượt đăng đã lên lịch.",
    risk: "read",
    argsSchema: publishCalendarArgs,
    summarize: (args) => {
      const parsed = publishCalendarArgs.parse(args);
      return `Xem lịch đăng ${parsed.days} ngày tới`;
    },
    execute: async (args, ctx) => {
      const { profileId, days } = publishCalendarArgs.parse(args);
      const now = new Date();
      const profileIds = profileId
        ? [profileId]
        : (await ctx.profiles.listProfiles({ includeArchived: false })).items.map((item) => item.id);
      const calendars: unknown[] = [];
      for (const pid of profileIds) {
        const profile = await ctx.profiles.getProfile(pid);
        if (!profile) {
          if (profileId) throw new AppError(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ");
          continue;
        }
        const automation = profile.automation;
        const plannedSlots = enumerateSlots(now, automation, days).map((slot) => ({
          at: slot.at.toISOString(),
          localDate: slot.localDate,
          kind: "automation_slot" as const,
        }));
        const pubs = ctx.publish.listGlobal({ profileId: pid }).items
          .filter((p) => p.scheduledFor && p.status !== "CANCELLED" && p.status !== "PUBLISHED")
          .map((p) => ({
            at: p.scheduledFor!,
            publicationId: p.id,
            projectTitle: p.projectTitle,
            status: p.status,
            kind: "publication" as const,
          }));
        const topics = await ctx.topics.listTopics(pid);
        const topicSlots = topics.items
          .filter((t) => t.scheduledFor)
          .map((t) => ({
            at: t.scheduledFor!,
            topicId: t.id,
            topic: t.topic,
            status: t.status,
            kind: "topic" as const,
          }));
        calendars.push({
          profileId: pid,
          profileName: profile.name,
          automationEnabled: automation.enabled,
          slots: [...plannedSlots, ...pubs, ...topicSlots].sort((a, b) => a.at.localeCompare(b.at)),
        });
      }
      return { days, profiles: calendars };
    },
  }),
  defineTool({
    name: "usage_summary",
    description: "Mức dùng LLM (hôm nay / 7 ngày / 30 ngày), theo nhóm.",
    risk: "read",
    argsSchema: usageSummaryArgs,
    summarize: (args) => {
      const parsed = usageSummaryArgs.parse(args);
      return `Xem mức dùng ${parsed.period}`;
    },
    execute: async (args, ctx) => {
      const parsed = usageSummaryArgs.parse(args);
      const days = parsed.period === "today" ? 1 : parsed.period === "7d" ? 7 : 30;
      const range = periodToRange(days, new Date(), getNotificationTimezone(ctx.sqlite));
      return ctx.usage.getAppUsage({
        from: range.from,
        to: range.to,
        groupBy: parsed.groupBy,
      });
    },
  }),
  defineTool({
    name: "dashboard_stats",
    description: "Số liệu tổng quan dashboard (dự án, lỗi gần đây, tự động hóa).",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem số liệu dashboard",
    execute: async (_args, ctx) => {
      const stats = await ctx.projects.dashboardStats();
      return { ...stats, automation: ctx.automation.dashboardCard() };
    },
  }),
  defineTool({
    name: "analytics_overview",
    description: "Thống kê nền tảng (lượt xem, tương tác, top/bottom video) theo khoảng thời gian.",
    risk: "read",
    argsSchema: analyticsOverviewArgs,
    summarize: (args) => {
      const parsed = analyticsOverviewArgs.parse(args);
      return `Xem thống kê ${parsed.period}`;
    },
    execute: async (args, ctx) => {
      if (!ctx.analytics) throw new AppError(503, "ANALYTICS_UNAVAILABLE", "Thống kê chưa sẵn sàng");
      const parsed = analyticsOverviewArgs.parse(args);
      const days = parsed.period === "90d" ? 90 : parsed.period === "28d" ? 28 : 7;
      const { from, to } = periodToRange(days, new Date(), getNotificationTimezone(ctx.sqlite));
      return ctx.analytics.getOverview({
        from,
        to,
        profileId: parsed.profileId,
        platform: parsed.platform,
      });
    },
  }),
  defineTool({
    name: "video_metrics",
    description: "Chuỗi số liệu theo thời gian của một publication đã đăng.",
    risk: "read",
    argsSchema: videoMetricsArgs,
    summarize: () => "Xem số liệu video",
    execute: async (args, ctx) => {
      if (!ctx.analytics) throw new AppError(503, "ANALYTICS_UNAVAILABLE", "Thống kê chưa sẵn sàng");
      const { publicationId } = videoMetricsArgs.parse(args);
      return ctx.analytics.getPublicationSeries(publicationId);
    },
  }),
  defineTool({
    name: "finance_summary",
    description: "Tóm tắt doanh thu, chi phí, lợi nhuận theo khoảng thời gian.",
    risk: "read",
    argsSchema: financeSummaryArgs,
    summarize: (args) => {
      const parsed = financeSummaryArgs.parse(args);
      return `Xem doanh thu ${parsed.period}`;
    },
    execute: async (args, ctx) => {
      if (!ctx.finance) throw new AppError(503, "FINANCE_UNAVAILABLE", "Doanh thu chưa sẵn sàng");
      const parsed = financeSummaryArgs.parse(args);
      const days = parsed.period === "90d" ? 90 : parsed.period === "30d" ? 30 : 7;
      const { from, to } = periodToRange(days, new Date(), getNotificationTimezone(ctx.sqlite));
      return ctx.finance.getSummary({ from, to, profileId: parsed.profileId });
    },
  }),
  defineTool({
    name: "monthly_report",
    description: "Xem báo cáo doanh thu theo tháng (YYYY-MM).",
    risk: "read",
    argsSchema: monthlyReportArgs,
    summarize: (args) => {
      const parsed = monthlyReportArgs.parse(args);
      return parsed.month ? `Xem báo cáo tháng ${parsed.month}` : "Xem danh sách báo cáo tháng";
    },
    execute: async (args, ctx) => {
      if (!ctx.finance) throw new AppError(503, "FINANCE_UNAVAILABLE", "Doanh thu chưa sẵn sàng");
      const parsed = monthlyReportArgs.parse(args);
      if (!parsed.month) return ctx.finance.listReports();
      try {
        return ctx.finance.getReport(parsed.month);
      } catch {
        return ctx.finance.generateMonthlyReport(parsed.month, { force: false });
      }
    },
  }),
  defineTool({
    name: "add_revenue_entry",
    description: "Thêm một mục doanh thu thủ công (cần xác nhận).",
    risk: "confirm",
    argsSchema: addRevenueEntryArgs,
    summarize: (args) => {
      const parsed = addRevenueEntryArgs.parse(args);
      return `Thêm doanh thu ${parsed.amount} ${parsed.currency} (${parsed.kind})`;
    },
    execute: async (args, ctx) => {
      if (!ctx.finance) throw new AppError(503, "FINANCE_UNAVAILABLE", "Doanh thu chưa sẵn sàng");
      const parsed = addRevenueEntryArgs.parse(args);
      return ctx.finance.createRevenue(parsed);
    },
  }),
  defineTool({
    name: "get_llm_settings",
    description: "Cài đặt định tuyến LLM cấp app (không có secret).",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem cài đặt LLM",
    execute: async (_args, ctx) => getAppLlmSettings(ctx.sqlite) ?? {},
  }),
  defineTool({
    name: "list_accounts",
    description: "Tài khoản nền tảng của hồ sơ ? chỉ trạng thái kết nối, không token.",
    risk: "read",
    argsSchema: listAccountsArgs,
    summarize: () => "Xem tài khoản đã kết nối",
    execute: async (args, ctx) => {
      const { profileId } = listAccountsArgs.parse(args);
      const accounts = await ctx.profiles.listAccounts(profileId);
      return {
        items: accounts.map((a) => ({
          id: a.id,
          platform: a.platform,
          displayName: a.displayName,
          handle: a.handle,
          format: a.format,
          enabled: a.enabled,
          connection: a.connection,
          connectionError: a.connectionError,
          lastCheckedAt: a.lastCheckedAt,
        })),
      };
    },
  }),
  defineTool({
    name: "notification_settings",
    description: "Cài đặt thông báo (Telegram bật/tắt, sự kiện) ? không token bot.",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem cài đặt thông báo",
    execute: async (_args, ctx) => {
      const settings = getNotificationSettings(ctx.sqlite);
      return {
        events: settings.events,
        dailySummaryTime: settings.dailySummaryTime,
        timezone: settings.timezone,
        quietHours: settings.quietHours,
        telegram: {
          enabled: settings.telegram.enabled,
          chatIdConfigured: settings.telegram.chatId != null,
          botUsername: settings.telegram.botUsername,
        },
      };
    },
  }),
];
