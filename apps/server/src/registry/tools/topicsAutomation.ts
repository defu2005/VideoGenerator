// TASK-085: topicsAutomation tool group (registry entries 25-36, same order). Moved verbatim.
import { ApproveTopicsBodySchema, CreateProjectInputSchema, ModelAdvisorProposeBodySchema, NotificationSettingsSchema, ProfileAutomationInputSchema, ProfileTopicInputSchema, SuggestTopicsBodySchema, MarketCodeSchema } from "@vg/shared";
import type { ProfileAutomationInput } from "@vg/shared";
import { z } from "zod";
import { getMarketInfo } from "../../knowledge/markets.js";
import { proposeModelRoutes } from "../../services/modelAdvisor.js";
import { setAutomationPaused, getAutomationPaused } from "../../services/automationSettings.js";
import { getNotificationSettings, saveNotificationSettings } from "../../settings/notifications.js";
import type { AssistantToolDef } from "./define.js";
import { defineTool } from "./define.js";
import { emptyObject } from "./shared.js";

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
  direction: z.string().max(4000).optional(),
  market: MarketCodeSchema.nullable().optional(),
}).strict().refine(({ direction, market }) => direction !== undefined || market !== undefined, {
  message: "Cần nhập hướng nội dung hoặc thị trường.",
});

const marketPackArgs = z.object({ code: MarketCodeSchema }).strict();

const setProfileAutomationArgs = z.object({
  profileId: z.string().uuid(),
  automation: ProfileAutomationInputSchema,
}).strict();

export const topicsAutomationToolDefs: AssistantToolDef[] = [
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
    name: "get_market_pack",
    description: "Xem dữ kiện thị trường.",
    risk: "read",
    argsSchema: marketPackArgs,
    summarize: () => "Đọc dữ kiện thị trường",
    execute: async (args, ctx) => getMarketInfo(ctx.sqlite, marketPackArgs.parse(args).code),
  }),
  defineTool({
    name: "update_profile_direction",
    description: "Đổi định hướng hoặc thị trường.",
    risk: "confirm",
    argsSchema: updateProfileDirectionArgs,
    summarize: (args) => {
      const parsed = updateProfileDirectionArgs.parse(args);
      const fields = [
        parsed.direction === undefined ? null : `hướng nội dung (${parsed.direction.slice(0, 60)}…)`,
        parsed.market === undefined ? null : `thị trường (${parsed.market ?? "bỏ chọn"})`,
      ];
      return `Đổi ${fields.filter(Boolean).join(" và ")} của hồ sơ`;
    },
    execute: async (args, ctx) => {
      const { profileId, ...update } = updateProfileDirectionArgs.parse(args);
      return ctx.profiles.updateProfile(profileId, update);
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
];
