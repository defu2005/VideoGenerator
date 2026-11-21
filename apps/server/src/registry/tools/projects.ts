// TASK-085: projects tool group (registry entries 1-10, same order). Moved verbatim.
import { PLANNED_TIMEOUT_STAGES, baselineStageTimeouts, isPlannedTimeoutStage, timeoutBriefFromSettings, ProfileListQuerySchema, ProjectListQuerySchema, ProjectStatusSchema, DecideOverdueArgsSchema } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { requireProject } from "../../services/projectService.js";
import { stageTimeoutMinutes, writeStageTimeoutStages } from "../../pipeline/stageTimeoutOverrides.js";
import type { AssistantToolDef } from "./define.js";
import { defineTool } from "./define.js";
import { projectIdArgs } from "./shared.js";

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

export const projectsToolDefs: AssistantToolDef[] = [
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
    name: "list_overdue_jobs",
    description: "Liệt kê các bước đang chạy quá thời gian dự kiến: dự án, bước, đã chạy bao lâu, lần kiểm tra gần nhất và có bao nhiêu việc đang xếp hàng sau nó.",
    risk: "read",
    argsSchema: z.object({}).strict(),
    summarize: () => "Xem các bước chạy quá giờ",
    execute: async (_args, ctx) => {
      const { listOverdueJobs } = await import("../../jobs/overdueStore.js");
      return { jobs: listOverdueJobs(ctx.sqlite) };
    },
  }),
  defineTool({
    name: "get_overdue_checks",
    description: "Đọc lịch sử các lần kiểm tra của một bước chạy quá giờ: sự kiện (tiến độ, file ghi, tiến trình con, dòng log cuối) và quyết định từng lần.",
    risk: "read",
    argsSchema: z.object({ jobId: z.string().min(1) }).strict(),
    summarize: () => "Xem lịch sử kiểm tra quá giờ",
    execute: async (args, ctx) => {
      const { jobId } = z.object({ jobId: z.string().min(1) }).strict().parse(args);
      const { getOverdueJob, listOverdueChecks } = await import("../../jobs/overdueStore.js");
      return { job: getOverdueJob(ctx.sqlite, jobId), checks: listOverdueChecks(ctx.sqlite, jobId) };
    },
  }),
  defineTool({
    name: "decide_overdue",
    description: "Quyết định cho một bước chạy quá giờ: wait (chờ thêm, extendMs từ 5 phút đến 2 lần giới hạn), abort_retry (dừng và chạy lại), abort_fail (dừng hẳn), ask_user (báo người dùng). reason bắt buộc, tiếng Việt, nêu nguyên nhân. Dự án được bảo vệ chỉ cho wait và ask_user.",
    risk: "confirm",
    argsSchema: DecideOverdueArgsSchema,
    summarize: (args) => {
      const parsed = DecideOverdueArgsSchema.parse(args);
      return `Quyết định bước quá giờ: ${parsed.action}`;
    },
    execute: async (args, ctx) => {
      const parsed = DecideOverdueArgsSchema.parse(args);
      const { getOverdueJob } = await import("../../jobs/overdueStore.js");
      if (!getOverdueJob(ctx.sqlite, parsed.jobId)) {
        throw new AppError(409, "JOB_NOT_OVERDUE", "Bước này không còn quá thời gian dự kiến, không cần quyết định.");
      }
      const result = ctx.orchestrator.decideOverdue(parsed.jobId, {
        action: parsed.action,
        reason: parsed.reason,
        ...(parsed.extendMs !== undefined ? { extendMs: parsed.extendMs } : {}),
        source: "hermes",
        actor: ctx.agent?.name ?? "hermes",
      });
      if (!result.ok) throw new AppError(409, "OVERDUE_DECISION_REFUSED", result.message);
      return { ok: true, message: result.message };
    },
  }),
  defineTool({
    name: "get_stage_timeouts",
    description: "Đọc thời gian chờ từng bước, số cảnh và lúc ghi kế hoạch. get_pipeline không có các số này.",
    risk: "read",
    argsSchema: projectIdArgs,
    summarize: () => "Xem thời gian chờ từng bước",
    execute: async (args, ctx) => {
      const { projectId } = projectIdArgs.parse(args);
      const project = await requireProject(ctx.projects, projectId);
      const brief = timeoutBriefFromSettings(project.settings, project.topic);
      const baseline = baselineStageTimeouts(brief);
      const planned = project.settings.stageTimeouts;
      const sceneCount = Number((ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM scenes WHERE project_id = ?").get(projectId) as { n: number }).n);
      const stages = Object.fromEntries(PLANNED_TIMEOUT_STAGES.map((stage) => {
        const entry = planned?.stages[stage];
        const timeoutMs = entry?.timeoutMs ?? baseline[stage];
        return [stage, {
          timeoutMs,
          minutes: timeoutMs / 60_000,
          source: entry?.source ?? "baseline",
          reason: entry?.reason ?? "Ước lượng theo thời lượng và phong cách.",
        }];
      }));
      return {
        projectId,
        sceneCount,
        plannedAt: planned ? project.updatedAt : null,
        source: planned?.source ?? "baseline",
        summary: planned?.summary ?? "Chưa có kế hoạch đã lưu.",
        stages,
      };
    },
  }),
  defineTool({
    name: "update_stage_timeouts",
    description: "Đề xuất tăng thời gian chờ sau hai lần quá giờ. Lấy số từ get_pipeline. Chỉ tạo thao tác chờ duyệt.",
    risk: "confirm",
    argsSchema: z.object({
      projectId: z.string().uuid(),
      stages: z.record(z.string(), z.number().positive()).superRefine((value, issue) => {
        const names = Object.keys(value);
        if (names.length < 1 || names.length > 11) {
          issue.addIssue({ code: "custom", message: "Chỉ nhận từ 1 đến 11 bước." });
        }
        for (const name of names) {
          if (!isPlannedTimeoutStage(name)) {
            issue.addIssue({ code: "custom", message: `Bước không có thời gian tối đa riêng: ${name}.` });
          }
        }
      }),
    }).strict(),
    summarize: (args) => {
      const parsed = z.object({ stages: z.record(z.string(), z.number()) }).parse(args);
      const names = Object.keys(parsed.stages);
      return `Đổi thời gian chờ ${names.join(", ")}`;
    },
    execute: async (args, ctx) => {
      const parsed = z.object({
        projectId: z.string().uuid(),
        stages: z.record(z.string(), z.number().positive()),
      }).strict().parse(args);
      const project = await requireProject(ctx.projects, parsed.projectId);
      const { clamped } = stageTimeoutMinutes(project, parsed.stages);
      writeStageTimeoutStages(ctx.sqlite, project, (stages) => {
        for (const [stage, value] of Object.entries(clamped)) {
          stages[stage] = { timeoutMs: value.timeoutMs, reason: "Bạn chọn.", source: "user" };
        }
      });
      const next = await ctx.projects.getProject(parsed.projectId);
      return { project: next, clamped };
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
];
