// TASK-085: pipelineActions tool group (registry entries 37-50, same order). Moved verbatim.
import { CreatePublicationsBodySchema, LlmSettingsSchema, ModelAdvisorApplyBodySchema, PipelineStageSchema, scriptGateDecision, renderGateOk, autopilotVisibility } from "@vg/shared";
import type { LlmSettings } from "@vg/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { profileTopics } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { saveAppLlmSettings } from "../../providers/llm/settings.js";
import { applyModelRoutes } from "../../services/modelAdvisor.js";
import { requireProject } from "../../services/projectService.js";
import { effectiveAutonomy } from "../../operator/autonomy.js";
import { executeRepairRenderStage, executeRepairScene, executeRepairScript, repairRenderStageArgs, repairSceneArgs, repairScriptArgs } from "../../operator/repairActions.js";
import { createUserRequest, sensitivePublish } from "../../operator/autopilot.js";
import { accountPublishFailures, projectPublishFailures, recordHeld, renderGateInputs, scriptGateInputs } from "../../operator/qualityGates.js";
import { previewRenderEstimate } from "../../services/composeBridge.js";
import type { AssistantToolDef } from "./define.js";
import { defineTool } from "./define.js";
import { projectIdArgs } from "./shared.js";

const applyModelsArgs = ModelAdvisorApplyBodySchema;

const runPipelineArgs = z.object({
  projectId: z.string().uuid(),
  stage: PipelineStageSchema.optional(),
  confirmOverwrite: z.boolean().optional(),
}).strict();

const approveGateArgs = z.object({
  projectId: z.string().uuid(),
  gate: PipelineStageSchema,
  reason: z.string().max(500).optional(),
}).strict();

const publishProjectArgs = z.object({
  projectId: z.string().uuid(),
  body: CreatePublicationsBodySchema,
  reason: z.string().max(500).optional(),
}).strict();

const cancelPublicationArgs = z.object({ publicationId: z.string().uuid() }).strict();

const updateLlmSettingsArgs = z.object({ settings: LlmSettingsSchema }).strict();

const deleteTopicArgs = z.object({
  profileId: z.string().uuid(),
  topicId: z.string().uuid(),
}).strict();

const deleteProjectArgs = projectIdArgs;

export const pipelineActionsToolDefs: AssistantToolDef[] = [
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
          "Kịch bản cảnh đã chỉnh sửa ? cần confirmOverwrite để ghi đè.",
        );
      }
      const state = stage === undefined
        ? ctx.orchestrator.runAll(projectId)
        : ctx.orchestrator.runStage(projectId, stage);
      if (stage !== undefined && stage !== "RENDER") return state;
      const project = await requireProject(ctx.projects, projectId);
      const renderEstimate = await previewRenderEstimate({
        sqlite: ctx.sqlite,
        project,
        dataDir: ctx.config.DATA_DIR,
      });
      return renderEstimate ? { ...state, renderEstimate } : state;
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
      const parsed = approveGateArgs.parse(args);
      if (ctx.gated) {
        // TASK-121: with the `retries` grant a failed quality gate is repaired by the agent, not handed to the user.
        const repair = await import("../../operator/qualityRepair.js");
        const repairGate = repair.repairGateFor(parsed.gate);
        if (repairGate && repair.repairEnabled(ctx.sqlite, parsed.projectId)) {
          const outcome = await repair.runQualityRepair({ ctx }, parsed.projectId, repairGate);
          if (outcome.status === "repairing") {
            return { held: false, waiting: "repair", attempt: outcome.attempt, maxAttempts: outcome.maxAttempts, actions: outcome.actions };
          }
          if (outcome.status === "exhausted") return { held: true, exhausted: true, reason: outcome.reason, handled: outcome.handled };
          if (outcome.status === "passed") return ctx.orchestrator.approveGate(parsed.projectId, parsed.gate);
        }
      }
      if (ctx.gated && parsed.gate === "SCRIPT") {
        const input = scriptGateInputs(ctx.sqlite, parsed.projectId);
        const decision = scriptGateDecision(input);
        if (decision === "revise") {
          ctx.sqlite.prepare("UPDATE scripts SET revise_round = revise_round + 1 WHERE project_id = ?").run(parsed.projectId);
          try {
            await ctx.orchestrator.runStage(parsed.projectId, "SCRIPT");
          } catch {
            const project = await requireProject(ctx.projects, parsed.projectId);
            const why = "Không sửa lại được kịch bản.";
            recordHeld(ctx.sqlite, parsed.projectId, why);
            createUserRequest(ctx.sqlite, {
              profileId: project.profileId,
              kind: "approve",
              title: "Giữ cổng kịch bản",
              whyVi: why,
              actionUrl: `/projects/${parsed.projectId}/overview`,
              dedupeKey: `script-gate:${parsed.projectId}`,
              checkKind: "approve",
            });
            return { held: true, score: input.score, blockingFacts: input.blockingFacts };
          }
          return { held: false, waiting: "revision", reviseRound: input.reviseRound + 1 };
        }
        if (decision === "hold") {
          const project = await requireProject(ctx.projects, parsed.projectId);
          const why = input.score == null ? "Chưa có điểm chất lượng cho kịch bản." : "Kịch bản chưa đạt cổng chất lượng.";
          recordHeld(ctx.sqlite, parsed.projectId, why);
          createUserRequest(ctx.sqlite, {
            profileId: project.profileId,
            kind: "approve",
            title: "Giữ cổng kịch bản",
            whyVi: why,
            actionUrl: `/projects/${parsed.projectId}/overview`,
            dedupeKey: `script-gate:${parsed.projectId}`,
            checkKind: "approve",
          });
          return { held: true, score: input.score, blockingFacts: input.blockingFacts };
        }
      }
      if (ctx.gated && parsed.gate === "RENDER") {
        const input = renderGateInputs(ctx.sqlite, parsed.projectId);
        if (!renderGateOk(input)) {
          const why = `Giữ cổng render: ${input.failed.join(", ") || "chưa đạt"}.`;
          recordHeld(ctx.sqlite, parsed.projectId, why);
          const project = await requireProject(ctx.projects, parsed.projectId);
          createUserRequest(ctx.sqlite, {
            profileId: project.profileId,
            kind: "approve",
            title: "Giữ cổng render",
            whyVi: why,
            actionUrl: `/projects/${parsed.projectId}/overview`,
            dedupeKey: `render-gate:${parsed.projectId}`,
            checkKind: "approve",
          });
          return { held: true, failed: input.failed };
        }
      }
      return ctx.orchestrator.approveGate(parsed.projectId, parsed.gate);
    },
  }),
  defineTool({
    name: "repair_script",
    description: "Tự sửa kịch bản chưa đạt cổng chất lượng. Chỉ chạy với quyền retries.",
    risk: "confirm",
    argsSchema: repairScriptArgs,
    summarize: () => "Tự sửa kịch bản",
    execute: async (args, ctx) => executeRepairScript(repairScriptArgs.parse(args), ctx),
  }),
  defineTool({
    name: "get_script_draft",
    description: "Xem dàn ý câu chuyện (outline), các móc câu ứng viên (hooks), điểm chấm rubric và trạng thái loop của kịch bản.",
    risk: "read",
    argsSchema: z.object({ projectId: z.string().uuid() }).strict(),
    summarize: (args) => `Xem dàn ý & chấm điểm kịch bản dự án ${(args as { projectId: string }).projectId}`,
    execute: async (args, ctx) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).strict().parse(args);
      const { JobRepository } = await import("../../jobs/jobRepository.js");
      const { PipelineEventBus } = await import("../../jobs/eventBus.js");
      const { ScriptService } = await import("../../services/scriptService.js");
      const service = new ScriptService(ctx.sqlite, new JobRepository(ctx.sqlite, new PipelineEventBus()), ctx.orchestrator, ctx.config, ctx.registry);
      return service.get(projectId).draft;
    },
  }),
  defineTool({
    name: "switch_script_hook",
    description: "Đổi móc câu (hook) của kịch bản sang một ứng viên khác và viết lại câu mở đầu cảnh 1 để nối mạch.",
    risk: "confirm",
    argsSchema: z.object({ projectId: z.string().uuid(), hookId: z.string().min(1) }).strict(),
    summarize: (args) => `Đổi hook kịch bản sang candidate ${(args as { hookId: string }).hookId}`,
    execute: async (args, ctx) => {
      const { projectId, hookId } = z.object({ projectId: z.string().uuid(), hookId: z.string().min(1) }).strict().parse(args);
      const { JobRepository } = await import("../../jobs/jobRepository.js");
      const { PipelineEventBus } = await import("../../jobs/eventBus.js");
      const { ScriptService } = await import("../../services/scriptService.js");
      const service = new ScriptService(ctx.sqlite, new JobRepository(ctx.sqlite, new PipelineEventBus()), ctx.orchestrator, ctx.config, ctx.registry);
      return service.switchHook(projectId, hookId);
    },
  }),
  defineTool({
    name: "rescore_script",
    description: "Chấm lại kịch bản hiện tại theo thang điểm rubric 6 tiêu chí (cấu trúc, hook, độ chính xác, giọng đọc, hình ảnh, tính độc đáo).",
    risk: "confirm",
    argsSchema: z.object({ projectId: z.string().uuid() }).strict(),
    summarize: (args) => `Chấm lại kịch bản dự án ${(args as { projectId: string }).projectId}`,
    execute: async (args, ctx) => {
      const { projectId } = z.object({ projectId: z.string().uuid() }).strict().parse(args);
      const { JobRepository } = await import("../../jobs/jobRepository.js");
      const { PipelineEventBus } = await import("../../jobs/eventBus.js");
      const { ScriptService } = await import("../../services/scriptService.js");
      const service = new ScriptService(ctx.sqlite, new JobRepository(ctx.sqlite, new PipelineEventBus()), ctx.orchestrator, ctx.config, ctx.registry);
      return service.rescoreCritique(projectId);
    },
  }),
  defineTool({
    name: "repair_scene",
    description: "Tự sửa ảnh cảnh không đạt cổng. Bỏ qua cảnh người dùng đã chọn.",
    risk: "confirm",
    argsSchema: repairSceneArgs,
    summarize: () => "Tự sửa ảnh cảnh",
    execute: async (args, ctx) => executeRepairScene(repairSceneArgs.parse(args), ctx),
  }),
  defineTool({
    name: "repair_render_stage",
    description: "Chạy lại bước giọng, phụ đề, nhạc, timeline hoặc render để sửa video không đạt cổng.",
    risk: "confirm",
    argsSchema: repairRenderStageArgs,
    summarize: () => "Tự sửa video",
    execute: async (args, ctx) => executeRepairRenderStage(repairRenderStageArgs.parse(args), ctx),
  }),
  defineTool({
    name: "publish_project",
    description: "Tạo lượt đăng video lên tài khoản đã chọn.",
    risk: "confirm",
    argsSchema: publishProjectArgs,
    summarize: () => "Đăng video lên nền tảng",
    execute: async (args, ctx) => {
      const { projectId, body } = publishProjectArgs.parse(args);
      const project = await requireProject(ctx.projects, projectId);
      let next = body;
      if (ctx.gated) {
        const shared = projectPublishFailures(ctx.sqlite, projectId);
        const named: string[] = [];
        for (const accountId of body.accountIds) {
          const fails = accountPublishFailures(ctx.sqlite, accountId, body.scheduledFor ?? null);
          if (!fails.length) continue;
          const row = ctx.sqlite.prepare("SELECT display_name FROM platform_accounts WHERE id = ?").get(accountId) as
            | { display_name: string }
            | undefined;
          named.push(`${row?.display_name || accountId}: ${fails.join(", ")}`);
        }
        if (shared.length || named.length) {
          const parts = [...(shared.length ? [shared.join(", ")] : []), ...named];
          throw new AppError(409, "PUBLISH_GATE", `Chưa đăng được: ${parts.join("; ")}.`);
        }
      }
      if (ctx.autonomyRun) {
        const grant = effectiveAutonomy(ctx.sqlite, { profileId: project.profileId ?? undefined }).grants.publish;
        const asked = body.visibility ?? "public";
        const decided = sensitivePublish(project.topic, autopilotVisibility(grant, asked, false));
        if (decided.visibility === "never") throw new AppError(403, "PUBLISH_GRANT", "Quyền đăng không cho phép lượt này.");
        if (decided.request) {
          createUserRequest(ctx.sqlite, {
            profileId: project.profileId, kind: "approve", title: "Duyệt nội dung nhạy cảm",
            whyVi: "Chủ đề nhạy cảm chỉ đăng riêng tư.", actionUrl: `/projects/${projectId}/overview`,
            dedupeKey: `sensitive:${projectId}`, checkKind: "approve",
          });
        }
        next = { ...body, visibility: decided.visibility };
      }
      const items = await ctx.publish.createForProject(projectId, next);
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
