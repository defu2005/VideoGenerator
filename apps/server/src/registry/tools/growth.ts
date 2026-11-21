// TASK-085: growth tool group (registry entries 51-64, same order). Moved verbatim.
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { clearLlmCooldown, readQuotaStatus } from "../../providers/llm/quota.js";
import type { AssistantToolDef } from "./define.js";
import { defineTool } from "./define.js";
import { emptyObject } from "./shared.js";

const profileInsightsArgs = z.object({ profileId: z.string().uuid() }).strict();

const quotaRefArgs = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
}).strict();

const applyInsightArgs = z.object({
  profileId: z.string().uuid(),
  insightId: z.string().uuid(),
  fields: z.array(z.enum([
    "directionAddendum",
    "preferredDuration",
    "publishTimes",
    "topicAngles",
    "avoid",
  ])).min(1),
}).strict();

export const growthToolDefs: AssistantToolDef[] = [
  defineTool({
    name: "profile_insights",
    description: "Đọc bài học hiệu suất mới nhất của một hồ sơ.",
    risk: "read",
    argsSchema: profileInsightsArgs,
    summarize: () => "Xem bài học hồ sơ",
    execute: async (args, ctx) => {
      if (!ctx.learning) throw new AppError(503, "LEARNING_UNAVAILABLE", "Bài học chưa sẵn sàng");
      const { profileId } = profileInsightsArgs.parse(args);
      return ctx.learning.getView(profileId);
    },
  }),
  defineTool({
    name: "run_insight",
    description: "Phân tích hiệu suất hồ sơ ngay (tối đa một lần mỗi giờ).",
    risk: "safe",
    argsSchema: profileInsightsArgs,
    summarize: () => "Phân tích bài học ngay",
    execute: async (args, ctx) => {
      if (!ctx.learning) throw new AppError(503, "LEARNING_UNAVAILABLE", "Bài học chưa sẵn sàng");
      const { profileId } = profileInsightsArgs.parse(args);
      return ctx.learning.run(profileId, "manual", ctx.signal);
    },
  }),
  defineTool({
    name: "apply_insight",
    description: "Áp dụng một hoặc vài đề xuất trong bài học vào hồ sơ.",
    risk: "confirm",
    argsSchema: applyInsightArgs,
    summarize: () => "Áp dụng bài học",
    execute: async (args, ctx) => {
      if (!ctx.learning) throw new AppError(503, "LEARNING_UNAVAILABLE", "Bài học chưa sẵn sàng");
      const parsed = applyInsightArgs.parse(args);
      return ctx.learning.apply(parsed.profileId, parsed.insightId, parsed.fields);
    },
  }),
  defineTool({
    name: "get_llm_quota_status",
    description: "Xem hạn mức model miễn phí, mức đã dùng và thời gian chờ.",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem quota LLM",
    execute: async (_args, ctx) => readQuotaStatus(ctx.sqlite),
  }),
  defineTool({
    name: "get_llm_health",
    description: "Xem thời gian nghỉ vì quota/rate limit và lịch sử chuyển model. Đổi route qua cài đặt model.",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem sức khoẻ nhà cung cấp AI",
    execute: async (_args, ctx) => ctx.registry.failover.snapshot(),
  }),
  defineTool({
    name: "clear_llm_cooldown",
    description: "Xoá thời gian chờ của một model LLM.",
    risk: "confirm",
    argsSchema: quotaRefArgs,
    summarize: (args) => {
      const parsed = quotaRefArgs.parse(args);
      return `Xoá chờ ${parsed.provider}/${parsed.model}`;
    },
    execute: async (args, ctx) => {
      const parsed = quotaRefArgs.parse(args);
      clearLlmCooldown(ctx.sqlite, parsed.provider, parsed.model);
      return { ok: true, ...parsed };
    },
  }),
  defineTool({
    name: "list_clips",
    description: "Xem các đoạn Shorts đã đề xuất và dự án clip con của một video dài.",
    risk: "read",
    argsSchema: z.object({ projectId: z.string().uuid() }).strict(),
    summarize: () => "Xem danh sách Shorts",
    execute: async (args, ctx) => {
      if (!ctx.clips) throw new AppError(503, "CLIPS_UNAVAILABLE", "Cắt Shorts chưa sẵn sàng");
      const { projectId } = z.object({ projectId: z.string().uuid() }).parse(args);
      return ctx.clips.view(projectId);
    },
  }),
  defineTool({
    name: "list_comments",
    description: "Đọc hộp thư bình luận trên video đã đăng.",
    risk: "read",
    argsSchema: z.object({
      profileId: z.string().uuid().optional(),
      platform: z.enum(["youtube", "tiktok", "instagram_reels", "facebook_reels"]).optional(),
      status: z.enum(["new", "read", "replied", "hidden", "spam", "ignored"]).optional(),
      classification: z.enum(["question", "praise", "complaint", "request", "spam", "toxic", "other"]).optional(),
    }).strict(),
    summarize: () => "Xem bình luận",
    execute: async (args, ctx) => {
      if (!ctx.comments) throw new AppError(503, "COMMENTS_UNAVAILABLE", "Hộp thư bình luận chưa sẵn sàng");
      const parsed = z.object({
        profileId: z.string().uuid().optional(),
        platform: z.enum(["youtube", "tiktok", "instagram_reels", "facebook_reels"]).optional(),
        status: z.enum(["new", "read", "replied", "hidden", "spam", "ignored"]).optional(),
        classification: z.enum(["question", "praise", "complaint", "request", "spam", "toxic", "other"]).optional(),
      }).strict().parse(args);
      return ctx.comments.list(parsed);
    },
  }),
  defineTool({
    name: "reply_comment",
    description: "Gửi câu trả lời cho một bình luận (cần xác nhận).",
    risk: "confirm",
    argsSchema: z.object({
      commentId: z.string().uuid(),
      text: z.string().trim().min(1).max(300),
    }).strict(),
    summarize: () => "Trả lời bình luận",
    execute: async (args, ctx) => {
      if (!ctx.comments) throw new AppError(503, "COMMENTS_UNAVAILABLE", "Hộp thư bình luận chưa sẵn sàng");
      const parsed = z.object({
        commentId: z.string().uuid(),
        text: z.string().trim().min(1).max(300),
      }).strict().parse(args);
      await ctx.comments.reply(parsed.commentId, parsed.text, "user", ctx.signal);
      return { ok: true, commentId: parsed.commentId };
    },
  }),
  defineTool({
    name: "hide_comment",
    description: "Ẩn một bình luận (cần xác nhận).",
    risk: "confirm",
    argsSchema: z.object({ commentId: z.string().uuid() }).strict(),
    summarize: () => "Ẩn bình luận",
    execute: async (args, ctx) => {
      if (!ctx.comments) throw new AppError(503, "COMMENTS_UNAVAILABLE", "Hộp thư bình luận chưa sẵn sàng");
      const { commentId } = z.object({ commentId: z.string().uuid() }).parse(args);
      await ctx.comments.hide(commentId, ctx.signal);
      return { ok: true, commentId };
    },
  }),
  defineTool({
    name: "make_shorts",
    description: "Đề xuất và xuất Shorts từ một video dài đã render (cần xác nhận).",
    risk: "confirm",
    argsSchema: z.object({
      projectId: z.string().uuid(),
      count: z.number().int().min(1).max(8).optional(),
    }).strict(),
    summarize: (args) => {
      const parsed = z.object({ projectId: z.string().uuid(), count: z.number().int().optional() }).parse(args);
      return parsed.count ? `Cắt ${parsed.count} Shorts` : "Cắt Shorts từ video dài";
    },
    execute: async (args, ctx) => {
      if (!ctx.clips) throw new AppError(503, "CLIPS_UNAVAILABLE", "Cắt Shorts chưa sẵn sàng");
      const parsed = z.object({
        projectId: z.string().uuid(),
        count: z.number().int().min(1).max(8).optional(),
      }).strict().parse(args);
      await ctx.clips.propose(parsed.projectId, { count: parsed.count }, ctx.signal);
      const view = ctx.clips.view(parsed.projectId);
      const ids = view.proposals.filter((item) => item.selected && item.status === "proposed").map((item) => item.id);
      if (!ids.length) return view;
      return ctx.clips.exportClips(parsed.projectId, ids);
    },
  }),
  defineTool({
    name: "trend_ideas",
    description: "Đọc ý tưởng xu hướng đã ghép với các hồ sơ.",
    risk: "read",
    argsSchema: emptyObject,
    summarize: () => "Xem xu hướng",
    execute: async (_args, ctx) => {
      if (!ctx.trends) throw new AppError(503, "TRENDS_UNAVAILABLE", "Xu hướng chưa sẵn sàng");
      return { items: ctx.trends.listToday(8) };
    },
  }),
  defineTool({
    name: "add_trend_topic",
    description: "Thêm một ý tưởng xu hướng vào hàng chờ chủ đề.",
    risk: "safe",
    argsSchema: z.object({
      profileId: z.string().uuid(),
      idea: z.object({
        title: z.string().min(1).max(500),
        angle: z.string().min(1).max(500),
        whyNow: z.string().min(1).max(500),
        sourceTitles: z.array(z.string().min(1)).min(1).max(8),
        urgency: z.enum(["today", "this_week", "evergreen"]),
        fitScore: z.number().min(0).max(100),
        sensitive: z.boolean(),
      }).strict(),
    }).strict(),
    summarize: (args) => {
      const parsed = z.object({ idea: z.object({ title: z.string() }) }).parse(args);
      return `Thêm xu hướng «${parsed.idea.title.slice(0, 80)}»`;
    },
    execute: async (args, ctx) => {
      if (!ctx.trends) throw new AppError(503, "TRENDS_UNAVAILABLE", "Xu hướng chưa sẵn sàng");
      const parsed = z.object({ profileId: z.string().uuid(), idea: z.unknown() }).parse(args);
      return ctx.trends.addIdea(parsed.profileId, { idea: parsed.idea });
    },
  }),
  defineTool({
    name: "make_translation",
    description: "Tạo bản dịch (lồng tiếng hoặc phụ đề) của một video đã xong.",
    risk: "confirm",
    argsSchema: z.object({
      projectId: z.string().uuid(),
      language: z.string().trim().min(2).max(16),
    }).strict(),
    summarize: (args) => {
      const parsed = z.object({ language: z.string() }).parse(args);
      return `Tạo bản dịch ${parsed.language}`;
    },
    execute: async (args, ctx) => {
      if (!ctx.translations) throw new AppError(503, "TRANSLATIONS_UNAVAILABLE", "Bản dịch chưa sẵn sàng");
      const parsed = z.object({
        projectId: z.string().uuid(),
        language: z.string().trim().min(2).max(16),
      }).strict().parse(args);
      return ctx.translations.start(parsed.projectId, parsed.language, ctx.signal ?? new AbortController().signal);
    },
  }),
];
