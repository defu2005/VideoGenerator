import {
  ApproveTopicsBodySchema,
  CreateProjectInputSchema,
  CreatePublicationsBodySchema,
  LlmSettingsSchema,
  ListPublicationsQuerySchema,
  ModelAdvisorApplyBodySchema,
  ModelAdvisorProposeBodySchema,
  NotificationSettingsSchema,
  PipelineStageSchema,
  ProfileAutomationInputSchema,
  ProfileListQuerySchema,
  ProfileTopicInputSchema,
  ProjectListQuerySchema,
  ProjectStatusSchema,
  SuggestTopicsBodySchema,
  enumerateSlots,
  localDateString,
  type AssistantToolRisk,
  type LlmSettings,
  type ProfileAutomationInput,
} from "@vg/shared";
import type Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/client.js";
import { profileTopics } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../lib/config.js";
import { getAppLlmSettings, saveAppLlmSettings } from "../providers/llm/settings.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { applyModelRoutes, proposeModelRoutes } from "../services/modelAdvisor.js";
import type { AutomationService } from "../services/automationService.js";
import { setAutomationPaused, getAutomationPaused } from "../services/automationSettings.js";
import type { ProfileService } from "../services/profileService.js";
import type { ProjectService } from "../services/projectService.js";
import type { TopicService } from "../services/topicService.js";
import type { UsageService } from "../services/usageService.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { PublishService } from "../publishing/publishService.js";
import type { SceneService } from "../services/sceneService.js";
import { requireProject } from "../services/projectService.js";
import {
  getNotificationSettings,
  saveNotificationSettings,
} from "../settings/notifications.js";

const emptyObject = z.object({}).strict();

export type AssistantToolContext = {
  db: AppDatabase;
  sqlite: Database.Database;
  config: AppConfig;
  profiles: ProfileService;
  projects: ProjectService;
  topics: TopicService;
  automation: AutomationService;
  orchestrator: PipelineOrchestrator;
  publish: PublishService;
  usage: UsageService;
  registry: LlmProviderRegistry;
  scenes: SceneService;
  signal?: AbortSignal;
};

type AssistantToolDef = {
  name: string;
  description: string;
  risk: AssistantToolRisk;
  argsSchema: z.ZodTypeAny;
  summarize: (args: unknown) => string;
  execute: (args: unknown, ctx: AssistantToolContext) => Promise<unknown>;
};

function periodToRange(period: "today" | "7d" | "30d", now: Date): { from: string; to: string } {
  const to = localDateString(now, "Asia/Ho_Chi_Minh");
  const end = new Date(`${to}T12:00:00.000Z`);
  const start = new Date(end);
  if (period === "7d") start.setUTCDate(start.getUTCDate() - 6);
  else if (period === "30d") start.setUTCDate(start.getUTCDate() - 29);
  const from = localDateString(start, "Asia/Ho_Chi_Minh");
  return { from, to };
}

const listProfilesArgs = z.object({
  includeArchived: z.boolean().optional(),
}).strict();

const getProfileArgs = z.object({ profileId: z.string().uuid() }).strict();

const listProjectsArgs = z.object({
  q: z.string().optional(),
  status: ProjectStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
}).strict();

const projectIdArgs = z.object({ projectId: z.string().uuid() }).strict();

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

const listAccountsArgs = z.object({ profileId: z.string().uuid() }).strict();

const createProjectArgs = CreateProjectInputSchema;

const addTopicArgs = z.object({
  profileId: z.string().uuid(),
  topic: ProfileTopicInputSchema,
}).strict();

const suggestTopicsArgs = z.object({
  profileId: z.string().uuid(),
  hint: z.string().optional(),
  count: z.number().int().min(1).max(20).optional(),
}).strict();

const approveTopicsArgs = z.object({
  profileId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1),
}).strict();

const rejectTopicsArgs = approveTopicsArgs;

const proposeModelsArgs = ModelAdvisorProposeBodySchema;

const applyModelsArgs = ModelAdvisorApplyBodySchema;

const updateNotificationTogglesArgs = z.object({
  events: z.object({
    attention: z.boolean().optional(),
    published: z.boolean().optional(),
    waitingApproval: z.boolean().optional(),
    dailySummary: z.boolean().optional(),
  }).strict(),
}).strict();

const updateProfileDirectionArgs = z.object({
  profileId: z.string().uuid(),
  direction: z.string().max(4000),
}).strict();

const setProfileAutomationArgs = z.object({
  profileId: z.string().uuid(),
  automation: ProfileAutomationInputSchema,
}).strict();

const runPipelineArgs = z.object({
  projectId: z.string().uuid(),
  stage: PipelineStageSchema.optional(),
  confirmOverwrite: z.boolean().optional(),
}).strict();

const approveGateArgs = z.object({
  projectId: z.string().uuid(),
  gate: PipelineStageSchema,
}).strict();

const publishProjectArgs = z.object({
  projectId: z.string().uuid(),
  body: CreatePublicationsBodySchema,
}).strict();

const cancelPublicationArgs = z.object({ publicationId: z.string().uuid() }).strict();

const updateLlmSettingsArgs = z.object({ settings: LlmSettingsSchema }).strict();

const deleteTopicArgs = z.object({
  profileId: z.string().uuid(),
  topicId: z.string().uuid(),
}).strict();

const deleteProjectArgs = projectIdArgs;

function defineTool(def: AssistantToolDef): AssistantToolDef {
  return def;
}

const toolDefs: AssistantToolDef[] = [
  defineTool({
    name: "list_profiles",
    description: "Liệt kê các hồ sơ (profile) kèm số tài khoản và dự án.",
    risk: "read",
    argsSchema: listProfilesArgs,
    summarize: () => "Xem danh sách hồ sơ",
    execute: async (args, ctx) => {
      const parsed = listProfilesArgs.parse(args);
      return ctx.profiles.listProfiles(ProfileListQuerySchema.parse(parsed));
    },
  }),
  defineTool({
    name: "get_profile",
    description: "Xem chi tiết một hồ sơ (hướng nội dung, tự động hóa, tài khoản).",
    risk: "read",
    argsSchema: getProfileArgs,
    summarize: () => "Xem hồ sơ",
    execute: async (args, ctx) => {
      const { profileId } = getProfileArgs.parse(args);
      return ctx.profiles.getDetail(profileId);
    },
  }),
  defineTool({
    name: "list_projects",
    description: "Liệt kê dự án video (lọc theo tên hoặc trạng thái).",
    risk: "read",
    argsSchema: listProjectsArgs,
    summarize: () => "Xem danh sách dự án",
    execute: async (args, ctx) => {
      const parsed = listProjectsArgs.parse(args);
      return ctx.projects.listProjects(ProjectListQuerySchema.parse({
        q: parsed.q,
        status: parsed.status,
        page: parsed.page ?? 1,
        pageSize: parsed.pageSize ?? 20,
      }));
    },
  }),
  defineTool({
    name: "get_project",
    description: "Xem một dự án và tóm tắt pipeline.",
    risk: "read",
    argsSchema: projectIdArgs,
    summarize: () => "Xem dự án",
    execute: async (args, ctx) => {
      const { projectId } = projectIdArgs.parse(args);
      const project = await requireProject(ctx.projects, projectId);
      const pipeline = ctx.orchestrator.getPipeline(projectId);
      return { project, pipeline };
    },
  }),
  defineTool({
    name: "get_pipeline",
    description: "Trạng thái pipeline đầy đủ của một dự án.",
    risk: "read",
    argsSchema: projectIdArgs,
    summarize: () => "Xem pipeline",
    execute: async (args, ctx) => {
      const { projectId } = projectIdArgs.parse(args);
      await requireProject(ctx.projects, projectId);
      return ctx.orchestrator.getPipeline(projectId);
    },
  }),
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
      const range = periodToRange(parsed.period, new Date());
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
    name: "get_llm_settings",
    description: "Cài đặt định tuyến LLM cấp app (không có secret).",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem cài đặt LLM",
    execute: async (_args, ctx) => getAppLlmSettings(ctx.sqlite) ?? {},
  }),
  defineTool({
    name: "list_accounts",
    description: "Tài khoản nền tảng của hồ sơ — chỉ trạng thái kết nối, không token.",
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
    description: "Cài đặt thông báo (Telegram bật/tắt, sự kiện) — không token bot.",
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
  defineTool({
    name: "create_project",
    description: "Tạo dự án mới (không chạy pipeline).",
    risk: "safe",
    argsSchema: createProjectArgs,
    summarize: (args) => {
      const parsed = createProjectArgs.parse(args);
      return `Tạo dự án: ${parsed.topic.slice(0, 80)}`;
    },
    execute: async (args, ctx) => {
      const input = createProjectArgs.parse(args);
      return ctx.projects.createProject(input);
    },
  }),
  defineTool({
    name: "add_topic",
    description: "Thêm chủ đề vào hàng đợi hồ sơ.",
    risk: "safe",
    argsSchema: addTopicArgs,
    summarize: (args) => {
      const parsed = addTopicArgs.parse(args);
      return `Thêm chủ đề: ${parsed.topic.topic.slice(0, 80)}`;
    },
    execute: async (args, ctx) => {
      const { profileId, topic } = addTopicArgs.parse(args);
      return ctx.topics.addTopic(profileId, topic);
    },
  }),
  defineTool({
    name: "suggest_topics",
    description: "Gợi ý chủ đề bằng LLM và thêm vào hàng đợi.",
    risk: "safe",
    argsSchema: suggestTopicsArgs,
    summarize: () => "Gợi ý chủ đề mới",
    execute: async (args, ctx) => {
      const { profileId, hint, count } = suggestTopicsArgs.parse(args);
      return ctx.topics.suggestTopics(profileId, SuggestTopicsBodySchema.parse({ hint, count }), ctx.signal);
    },
  }),
  defineTool({
    name: "approve_topics",
    description: "Duyệt các chủ đề đang chờ.",
    risk: "safe",
    argsSchema: approveTopicsArgs,
    summarize: () => "Duyệt chủ đề",
    execute: async (args, ctx) => {
      const { profileId, ids } = approveTopicsArgs.parse(args);
      return ctx.topics.approveTopics(profileId, ApproveTopicsBodySchema.parse({ ids, status: "APPROVED" }));
    },
  }),
  defineTool({
    name: "reject_topics",
    description: "Từ chối các chủ đề.",
    risk: "safe",
    argsSchema: rejectTopicsArgs,
    summarize: () => "Từ chối chủ đề",
    execute: async (args, ctx) => {
      const { profileId, ids } = rejectTopicsArgs.parse(args);
      return ctx.topics.approveTopics(profileId, ApproveTopicsBodySchema.parse({ ids, status: "REJECTED" }));
    },
  }),
  defineTool({
    name: "pause_automation_all",
    description: "Dừng toàn bộ tự động hóa (kill switch).",
    risk: "safe",
    argsSchema: emptyObject,
    summarize: () => "Tạm dừng tự động hóa toàn app",
    execute: async (_args, ctx) => setAutomationPaused(ctx.sqlite, true),
  }),
  defineTool({
    name: "propose_models",
    description: "Đề xuất mô hình LLM (chưa áp dụng).",
    risk: "safe",
    argsSchema: proposeModelsArgs,
    summarize: () => "Đề xuất mô hình AI",
    execute: async (args, ctx) => proposeModelRoutes({
      registry: ctx.registry,
      sqlite: ctx.sqlite,
      projects: ctx.projects,
      profiles: ctx.profiles,
      ...ModelAdvisorProposeBodySchema.parse(args),
      signal: ctx.signal,
    }),
  }),
  defineTool({
    name: "update_notification_toggles",
    description: "Bật/tắt loại thông báo sự kiện.",
    risk: "safe",
    argsSchema: updateNotificationTogglesArgs,
    summarize: () => "Cập nhật bật/tắt thông báo",
    execute: async (args, ctx) => {
      const { events } = updateNotificationTogglesArgs.parse(args);
      const current = getNotificationSettings(ctx.sqlite);
      return saveNotificationSettings(ctx.sqlite, NotificationSettingsSchema.parse({
        ...current,
        events: { ...current.events, ...events },
      }));
    },
  }),
  defineTool({
    name: "update_profile_direction",
    description: "Đổi hướng nội dung (direction) của hồ sơ.",
    risk: "confirm",
    argsSchema: updateProfileDirectionArgs,
    summarize: (args) => {
      const parsed = updateProfileDirectionArgs.parse(args);
      return `Đổi hướng nội dung hồ sơ (${parsed.direction.slice(0, 60)}…)`;
    },
    execute: async (args, ctx) => {
      const { profileId, direction } = updateProfileDirectionArgs.parse(args);
      return ctx.profiles.updateProfile(profileId, { direction });
    },
  }),
  defineTool({
    name: "set_profile_automation",
    description: "Bật/tắt và cấu hình tự động hóa hồ sơ (videosPerDay, giờ đăng, …).",
    risk: "confirm",
    argsSchema: setProfileAutomationArgs,
    summarize: () => "Cập nhật tự động hóa hồ sơ",
    execute: async (args, ctx) => {
      const { profileId, automation } = setProfileAutomationArgs.parse(args);
      return ctx.profiles.updateProfile(profileId, { automation: automation as ProfileAutomationInput });
    },
  }),
  defineTool({
    name: "resume_automation_all",
    description: "Bật lại tự động hóa toàn app (tắt kill switch).",
    risk: "confirm",
    argsSchema: emptyObject,
    summarize: () => "Bật lại tự động hóa toàn app",
    execute: async (_args, ctx) => {
      if (!getAutomationPaused(ctx.sqlite)) return { paused: false };
      return setAutomationPaused(ctx.sqlite, false);
    },
  }),
  defineTool({
    name: "run_pipeline",
    description: "Chạy Generate All hoặc một giai đoạn pipeline.",
    risk: "confirm",
    argsSchema: runPipelineArgs,
    summarize: (args) => {
      const parsed = runPipelineArgs.parse(args);
      return parsed.stage
        ? `Chạy giai đoạn ${parsed.stage} cho dự án`
        : "Chạy toàn bộ pipeline (Generate All)";
    },
    execute: async (args, ctx) => {
      const { projectId, stage, confirmOverwrite } = runPipelineArgs.parse(args);
      await requireProject(ctx.projects, projectId);
      if ((stage === "SCENE_PLAN" || stage === undefined)
        && ctx.scenes.hasEditedScenes(projectId)
        && confirmOverwrite !== true) {
        throw new AppError(
          409,
          "SCENES_EDITED",
          "Kịch bản cảnh đã chỉnh sửa — cần confirmOverwrite để ghi đè.",
        );
      }
      return stage === undefined
        ? ctx.orchestrator.runAll(projectId)
        : ctx.orchestrator.runStage(projectId, stage);
    },
  }),
  defineTool({
    name: "approve_gate",
    description: "Duyệt cổng chờ người dùng trên pipeline.",
    risk: "confirm",
    argsSchema: approveGateArgs,
    summarize: (args) => {
      const parsed = approveGateArgs.parse(args);
      return `Duyệt cổng ${parsed.gate}`;
    },
    execute: async (args, ctx) => {
      const { projectId, gate } = approveGateArgs.parse(args);
      return ctx.orchestrator.approveGate(projectId, gate);
    },
  }),
  defineTool({
    name: "publish_project",
    description: "Tạo lượt đăng video lên tài khoản đã chọn.",
    risk: "confirm",
    argsSchema: publishProjectArgs,
    summarize: () => "Đăng video lên nền tảng",
    execute: async (args, ctx) => {
      const { projectId, body } = publishProjectArgs.parse(args);
      const items = await ctx.publish.createForProject(projectId, body);
      return { items };
    },
  }),
  defineTool({
    name: "cancel_publication",
    description: "Hủy một lượt đăng đang chờ hoặc lên lịch.",
    risk: "confirm",
    argsSchema: cancelPublicationArgs,
    summarize: () => "Hủy lượt đăng",
    execute: async (args, ctx) => {
      const { publicationId } = cancelPublicationArgs.parse(args);
      return ctx.publish.cancel(publicationId);
    },
  }),
  defineTool({
    name: "apply_models",
    description: "Áp dụng đề xuất mô hình LLM đã propose.",
    risk: "confirm",
    argsSchema: applyModelsArgs,
    summarize: () => "Áp dụng mô hình AI đề xuất",
    execute: async (args, ctx) => applyModelRoutes({
      registry: ctx.registry,
      sqlite: ctx.sqlite,
      projects: ctx.projects,
      profiles: ctx.profiles,
      ...ModelAdvisorApplyBodySchema.parse(args),
    }),
  }),
  defineTool({
    name: "update_llm_settings",
    description: "Lưu cài đặt định tuyến LLM cấp app.",
    risk: "confirm",
    argsSchema: updateLlmSettingsArgs,
    summarize: () => "Cập nhật cài đặt LLM app",
    execute: async (args, ctx) => {
      const { settings } = updateLlmSettingsArgs.parse(args);
      for (const route of [
        settings.default,
        ...Object.values(settings.tasks ?? {}),
      ]) {
        if (!route) continue;
        if (!ctx.registry.isSupportedProvider(route.provider)
          || (route.fallback && !ctx.registry.isSupportedProvider(route.fallback.provider))) {
          throw new AppError(400, "INVALID_LLM_PROVIDER", "Route LLM không hợp lệ.");
        }
      }
      saveAppLlmSettings(ctx.sqlite, settings as LlmSettings);
      return settings;
    },
  }),
  defineTool({
    name: "delete_topic",
    description: "Xóa vĩnh viễn một chủ đề khỏi hàng đợi.",
    risk: "confirm",
    argsSchema: deleteTopicArgs,
    summarize: () => "Xóa chủ đề",
    execute: async (args, ctx) => {
      const { profileId, topicId } = deleteTopicArgs.parse(args);
      const row = await ctx.db.select()
        .from(profileTopics)
        .where(and(eq(profileTopics.id, topicId), eq(profileTopics.profileId, profileId)))
        .get();
      if (!row) throw new AppError(404, "TOPIC_NOT_FOUND", "Không tìm thấy chủ đề");
      if (row.status === "IN_PRODUCTION") {
        throw new AppError(409, "TOPIC_LOCKED", "Chủ đề đang sản xuất, không thể xóa.");
      }
      await ctx.db.delete(profileTopics).where(eq(profileTopics.id, topicId)).run();
      return { ok: true, topicId };
    },
  }),
  defineTool({
    name: "delete_project",
    description: "Xóa vĩnh viễn dự án và dữ liệu liên quan.",
    risk: "confirm",
    argsSchema: deleteProjectArgs,
    summarize: () => "Xóa dự án",
    execute: async (args, ctx) => {
      const { projectId } = deleteProjectArgs.parse(args);
      const result = await ctx.projects.deleteProject(projectId);
      if (result === "not_found") throw new AppError(404, "PROJECT_NOT_FOUND", "Không tìm thấy dự án");
      if (result === "busy") throw new AppError(409, "PROJECT_BUSY", "Dự án đang chạy, không thể xóa.");
      return { ok: true, projectId };
    },
  }),
];

export const ASSISTANT_TOOLS: Record<string, AssistantToolDef> = Object.fromEntries(
  toolDefs.map((tool) => [tool.name, tool]),
);

export const ALWAYS_CONFIRM_TOOLS = new Set<string>(["delete_project", "delete_topic"]);

export function getToolCatalogForPrompt(): Array<{
  name: string;
  description: string;
  risk: AssistantToolRisk;
  args: Record<string, unknown>;
}> {
  return toolDefs.map((tool) => {
    const schema = z.toJSONSchema(tool.argsSchema) as JsonSchemaNode;
    const args = compactSchema(schema, 0);
    return {
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      args: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
    };
  });
}

type JsonSchemaNode = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};

/** Short type signature for the prompt: `{ "key": "string", "opt?": "a|b" }`, nested at most 2 levels. */
export function compactSchema(node: JsonSchemaNode, depth: number): unknown {
  if (node.enum) return node.enum.map(String).join("|");
  if (node.const !== undefined) return JSON.stringify(node.const);
  const variants = node.anyOf ?? node.oneOf;
  if (variants) {
    const parts = variants.filter((v) => v.type !== "null").map((v) => compactSchema(v, depth));
    const text = parts.map((p) => (typeof p === "string" ? p : "object")).join(" | ");
    return parts.length === 1 ? parts[0] : text;
  }
  const type = Array.isArray(node.type) ? node.type.filter((t) => t !== "null")[0] : node.type;
  if (type === "object" && node.properties) {
    if (depth >= 2) return "object";
    const required = new Set(node.required ?? []);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties)) {
      out[required.has(key) ? key : `${key}?`] = compactSchema(child, depth + 1);
    }
    return out;
  }
  if (type === "array") {
    const item = node.items ? compactSchema(node.items, depth + 1) : "any";
    return typeof item === "string" ? `${item}[]` : [item];
  }
  if (type === "number" || type === "integer") {
    const max = node.maximum !== undefined && node.maximum < 1e9 ? node.maximum : undefined;
    const min = node.minimum !== undefined && node.minimum > -1e9 ? node.minimum : undefined;
    const range = min !== undefined || max !== undefined ? `(${min ?? ""}..${max ?? ""})` : "";
    return `${type}${range}`;
  }
  if (type === "string" && node.maxLength !== undefined && node.maxLength < 1000) {
    return `string(≤${node.maxLength})`;
  }
  return type ?? "any";
}

export function getToolRisk(name: string): AssistantToolRisk | undefined {
  return ASSISTANT_TOOLS[name]?.risk;
}

export async function runTool(
  name: string,
  args: unknown,
  ctx: AssistantToolContext,
): Promise<unknown> {
  const tool = ASSISTANT_TOOLS[name];
  if (!tool) throw new AppError(400, "UNKNOWN_TOOL", `Công cụ không tồn tại: ${name}`);
  let parsed: unknown;
  try {
    parsed = tool.argsSchema.parse(args ?? {});
  } catch (error) {
    const message = error instanceof z.ZodError
      ? error.issues.map((i) => i.message).join("; ")
      : "Tham số không hợp lệ";
    throw new AppError(400, "INVALID_TOOL_ARGS", message);
  }
  return tool.execute(parsed, ctx);
}

export function summarizeTool(name: string, args: unknown): string {
  const tool = ASSISTANT_TOOLS[name];
  if (!tool) return `Thao tác: ${name}`;
  try {
    return tool.summarize(tool.argsSchema.parse(args ?? {}));
  } catch {
    return `Thao tác: ${name}`;
  }
}
