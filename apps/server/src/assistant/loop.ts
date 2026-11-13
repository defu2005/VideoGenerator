import type { AuthActor } from "../auth/actor.js";
import { can, FORBIDDEN_MESSAGE } from "../auth/policy.js";
import { TOOL_ACTIONS, toolResource } from "../auth/toolActions.js";
import {
  AssistantChatStepSchema,
  type AssistantMessage,
  type AssistantPendingAction,
  type AssistantToolActivity,
  type JobUsage,
  type Project,
} from "@vg/shared";
import type { FastifyBaseLogger } from "fastify";
import { LlmCache } from "../providers/llm/cache.js";
import { estimateLlmCost } from "../providers/llm/pricing.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import {
  ALWAYS_CONFIRM_TOOLS,
  ASSISTANT_TOOLS,
  getToolCatalogForPrompt,
  runTool,
  summarizeTool,
  type AssistantToolContext,
} from "./tools.js";
import { z } from "zod";
import { getAssistantSettings } from "../settings/assistant.js";
import { getNotificationTimezone } from "../settings/notifications.js";
import { logToolAudit } from "../registry/audit.js";
import { hardBlockMessage, shouldCreatePending } from "../registry/policy.js";
import type Database from "better-sqlite3";

const MAX_STEPS = 6;
const TOOL_RESULT_MAX = 3000;
const HISTORY_LIMIT = 20;

/**
 * The LLM may only skip confirmations when the user's own message asks for it.
 * This stops text inside tool results (topic titles, comments) from turning it on.
 */
const AUTO_CONFIRM_PHRASES = [
  /tự động hết/i,
  /tự động tất cả/i,
  /tự động toàn bộ/i,
  /không cần hỏi/i,
  /khỏi hỏi/i,
  /đừng hỏi/i,
  /làm luôn/i,
  /không cần xác nhận/i,
];

export function userAllowsAutoConfirm(userText: string): boolean {
  const text = userText.normalize("NFC");
  return AUTO_CONFIRM_PHRASES.some((re) => re.test(text));
}

export type AssistantLoopInput = {
  sqlite: Database.Database;
  config: AppConfig;
  registry: LlmProviderRegistry;
  toolCtx: AssistantToolContext;
  actor: AuthActor;
  history: AssistantMessage[];
  userText: string;
  profileSummaries: Array<{ id: string; name: string; platforms: string[] }>;
  signal?: AbortSignal;
  logger?: FastifyBaseLogger;
  onPersistToolMessage?: (payload: {
    tool: string;
    resultPreview: string;
    activity: AssistantToolActivity;
  }) => void;
  createPending: (input: {
    tool: string;
    args: unknown;
    summary: string;
    actor: AuthActor;
  }) => AssistantPendingAction;
  runPendingNow: (input: {
    tool: string;
    args: unknown;
  }) => Promise<{ activity: AssistantToolActivity; result: unknown }>;
};

export type AssistantLoopResult = {
  replyText: string;
  clarify?: AssistantMessage["content"]["clarify"];
  toolActivity: AssistantToolActivity[];
  pendingActions: AssistantPendingAction[];
  usageJobs: JobUsage[];
  messageUsage?: AssistantMessage["content"]["usage"];
  stopReason: "done" | "clarify" | "pending" | "error" | "step_limit";
};

function stubAssistantProject(): Project {
  const now = new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "assistant",
    description: "",
    topic: "assistant",
    mode: "ASSISTED",
    settings: {
      language: "vi",
      targetDurationSec: 120,
      wordsPerMinute: 150,
      aspectRatio: "16:9",
      platform: "youtube",
      style: "documentary",
      tone: "neutral",
      audience: "general",
      visualStyle: "photo",
      sceneDurationSec: 6,
      budget: { mode: "BALANCED" },
      subtitles: { enabled: true, maxCharsPerLine: 42 },
      music: { enabled: true, volume: 0.2 },
      userSet: [],
      stageExecutors: {},
      autoRender: false,
      guidelines: { platformPack: "auto", customRules: [] },
    },
    status: "DRAFT",
    stage: "RESEARCH",
    thumbnailPath: null,
    durationSec: null,
    version: 1,
    profileId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

function truncateJson(value: unknown, max = TOOL_RESULT_MAX): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [cắt bớt]`;
}

export function buildSystemPrompt(input: {
  now: Date;
  timezone: string;
  profiles: AssistantLoopInput["profileSummaries"];
}): string {
  const catalog = getToolCatalogForPrompt();
  const dateStr = input.now.toLocaleString("vi-VN", { timeZone: input.timezone });
  return [
    "Bạn là trợ lý điều khiển ứng dụng tạo video. Trả lời JSON theo schema AssistantChat.",
    "Luật:",
    "- Trả lời tiếng Việt, ngắn gọn.",
    "- Khi thiếu hồ sơ/dự án/giá trị quan trọng: dùng clarify, không đoán id.",
    "- Tra id bằng công cụ read trước khi ghi.",
    "- Tối đa 4 công cụ mỗi bước.",
    "- delete_project và delete_topic luôn cần người dùng xác nhận riêng.",
    "- Khi người dùng hỏi cách làm (làm sao, ở đâu, hướng dẫn): gọi search_user_guide và trả lời theo các mục tìm được, nêu tên mục.",
    `- Ngày giờ hiện tại (${input.now.toLocaleString("en-US", { timeZone: input.timezone })} ${input.timezone}): ${dateStr}`,
    "Hồ sơ:",
    JSON.stringify(input.profiles),
    "Danh mục công cụ (name, description, risk, args):",
    JSON.stringify(catalog),
  ].join("\n");
}

function historyForPrompt(history: AssistantMessage[]): string {
  const recent = history.slice(-HISTORY_LIMIT);
  return recent.map((msg) => {
    const role = msg.role;
    const text = msg.content.text?.trim() ?? "";
    const clarify = msg.content.clarify ? `[clarify: ${msg.content.clarify.question}]` : "";
    const tools = msg.content.toolActivity?.map((a: AssistantToolActivity) => `[${a.tool}: ${a.ok ? "ok" : "lỗi"}]`)?.join(" ") ?? "";
    return `${role}: ${text} ${clarify} ${tools}`.trim();
  }).join("\n");
}

export async function runAssistantLoop(input: AssistantLoopInput): Promise<AssistantLoopResult> {
  const settings = getAssistantSettings(input.sqlite);
  const cache = new LlmCache(input.sqlite, input.config.LLM_CACHE_ENABLED);
  const appRouting = getAppLlmSettings(input.sqlite);
  const routeProject = stubAssistantProject();
  const route = input.registry.resolveTask("assistantChat", routeProject, appRouting);

  const toolActivity: AssistantToolActivity[] = [];
  const pendingActions: AssistantPendingAction[] = [];
  const usageJobs: JobUsage[] = [];
  let replyParts: string[] = [];
  let clarify: AssistantLoopResult["clarify"];
  let stopReason: AssistantLoopResult["stopReason"] = "step_limit";
  /** After one validation error was fed back, the next validation error ends the loop. */
  let validationErrorUsed = false;
  let aggregatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    provider: "",
    model: "",
    cached: false,
  };

  const stepNotes: string[] = [];
  const now = new Date();
  const system = buildSystemPrompt({ now, timezone: getNotificationTimezone(input.sqlite), profiles: input.profileSummaries });

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const prompt = [
      "## Lịch sử",
      historyForPrompt(input.history),
      "",
      "## Bước hiện tại",
      `Tin nhắn người dùng: ${input.userText}`,
      stepNotes.length ? `Kết quả công cụ gần đây:\n${stepNotes.join("\n")}` : "",
    ].filter(Boolean).join("\n");

    let generated;
    try {
      generated = await generateRoutedStructured({
        registry: input.registry,
        route,
        task: "assistantChat",
        system,
        prompt,
        schema: AssistantChatStepSchema,
        schemaName: "AssistantChat",
        schemaVersion: "1",
        maxOutputTokens: route.maxOutputTokens ?? 4096,
        repairAttempts: 1,
        signal: input.signal ?? new AbortController().signal,
        cache,
        logger: input.logger,
      });
    } catch (error) {
      if (error instanceof LlmError) {
        throw new AppError(502, error.code, error.message, { retryable: error.retryable });
      }
      throw error;
    }

    const stepUsage = generated.usage;
    const costUsd = estimateLlmCost(input.config, generated.provider, generated.model, generated.usage);
    aggregatedUsage.inputTokens += stepUsage.inputTokens;
    aggregatedUsage.outputTokens += stepUsage.outputTokens;
    aggregatedUsage.costUsd += costUsd;
    aggregatedUsage.provider = generated.provider;
    aggregatedUsage.model = generated.model;
    aggregatedUsage.cached = aggregatedUsage.cached || generated.cached === true;

    usageJobs.push({
      llmCalls: stepUsage.llmCalls,
      inputTokens: stepUsage.inputTokens,
      outputTokens: stepUsage.outputTokens,
      costUsd,
      provider: generated.provider,
      model: generated.model,
      calls: stepUsage.calls,
    });

    const value = AssistantChatStepSchema.parse(generated.value);
    if (value.reply?.trim()) replyParts.push(value.reply.trim());

    if (value.clarify) {
      clarify = value.clarify;
      stopReason = "clarify";
      break;
    }

    const autoRunConfirm = settings.confirmMode === "auto"
      || (value.autoConfirm === true && userAllowsAutoConfirm(input.userText));
    const calls = value.calls ?? [];
    let createdPendingThisStep = false;
    let validationErrorThisStep = false;

    for (const call of calls) {
      const toolDef = ASSISTANT_TOOLS[call.tool];
      if (!toolDef) {
        if (!validationErrorUsed) {
          stepNotes.push(`Lỗi: công cụ «${call.tool}» không tồn tại. Thử lại một lần.`);
          validationErrorUsed = true;
          validationErrorThisStep = true;
          break;
        }
        replyParts = ["Không thực hiện được: công cụ không hợp lệ sau khi thử lại."];
        stopReason = "error";
        return buildResult();
      }
      const risk = toolDef.risk;
      const blocked = hardBlockMessage(call.tool, call.args);
      if (blocked) {
        toolActivity.push({
          tool: call.tool,
          summary: blocked,
          risk,
          ok: false,
          error: blocked,
        });
        replyParts.push(blocked);
        continue;
      }

      let parsedArgs: unknown;
      try {
        parsedArgs = toolDef.argsSchema.parse(call.args ?? {});
      } catch (error) {
        const message = error instanceof z.ZodError
          ? error.issues.map((i) => i.message).join("; ")
          : "Tham số không hợp lệ";
        if (!validationErrorUsed) {
          stepNotes.push(`Lỗi tham số ${call.tool}: ${message}`);
          validationErrorUsed = true;
          validationErrorThisStep = true;
          break;
        }
        replyParts = [`Không thực hiện được: tham số công cụ không hợp lệ (${call.tool}).`];
        stopReason = "error";
        return buildResult();
      }

      const needed = TOOL_ACTIONS[call.tool];
      const decision = needed
        ? can(input.actor, needed, toolResource(input.sqlite, parsedArgs))
        : { ok: false as const, status: 403 as const, reason: FORBIDDEN_MESSAGE };
      if (!decision.ok) {
        logToolAudit(input.sqlite, {
          source: "assistant", tool: call.tool, args: parsedArgs, risk, decision: "refused",
          summary: decision.reason, actor: input.actor,
        });
        toolActivity.push({ tool: call.tool, summary: decision.reason, risk, ok: false, error: decision.reason });
        replyParts.push(decision.reason);
        continue;
      }

      const needsConfirm = shouldCreatePending({
        name: call.tool,
        args: parsedArgs,
        risk,
        source: "assistant",
        autoConfirm: autoRunConfirm,
        alwaysConfirm: ALWAYS_CONFIRM_TOOLS.has(call.tool),
      });

      if (needsConfirm) {
        const summary = summarizeTool(call.tool, parsedArgs);
        const pending = input.createPending({
          tool: call.tool,
          args: parsedArgs,
          summary,
          actor: input.actor,
        });
        logToolAudit(input.sqlite, {
          actor: input.actor,
          source: "assistant",
          tool: call.tool,
          args: parsedArgs,
          risk,
          decision: "pending",
          summary,
          pendingActionId: pending.id,
        });
        pendingActions.push(pending);
        createdPendingThisStep = true;
        toolActivity.push({
          tool: call.tool,
          summary: pending.summary,
          risk,
          ok: true,
        });
        if (ALWAYS_CONFIRM_TOOLS.has(call.tool) && autoRunConfirm) {
          replyParts.push("Thao tác xóa luôn cần xác nhận vì không hoàn tác được.");
        }
        continue;
      }

      try {
        const result = risk === "confirm" && autoRunConfirm
          ? await input.runPendingNow({ tool: call.tool, args: parsedArgs })
          : {
            result: await runTool(call.tool, parsedArgs, input.toolCtx),
            activity: {
              tool: call.tool,
              summary: summarizeTool(call.tool, parsedArgs),
              risk,
              ok: true,
            } as AssistantToolActivity,
          };
        toolActivity.push(result.activity);
        const preview = truncateJson(result.result);
        stepNotes.push(`[${call.tool}] ${preview}`);
        input.onPersistToolMessage?.({
          tool: call.tool,
          resultPreview: preview,
          activity: result.activity,
        });
      } catch (error) {
        const message = error instanceof AppError ? error.message : (error instanceof Error ? error.message : String(error));
        toolActivity.push({
          tool: call.tool,
          summary: summarizeTool(call.tool, parsedArgs),
          risk,
          ok: false,
          error: message,
        });
        stepNotes.push(`Lỗi chạy ${call.tool}: ${message}`);
      }
    }

    if (validationErrorThisStep) {
      continue;
    }

    if (createdPendingThisStep) {
      stopReason = "pending";
      break;
    }

    if (value.done) {
      stopReason = "done";
      break;
    }

    if (!calls.length && value.done === false && step === MAX_STEPS - 1) {
      stopReason = "step_limit";
    }
  }

  return buildResult();

  function buildResult(): AssistantLoopResult {
    return {
      replyText: replyParts.join("\n\n").trim(),
      clarify,
      toolActivity,
      pendingActions,
      usageJobs,
      messageUsage: aggregatedUsage.inputTokens > 0 ? {
        inputTokens: aggregatedUsage.inputTokens,
        outputTokens: aggregatedUsage.outputTokens,
        costUsd: aggregatedUsage.costUsd,
        provider: aggregatedUsage.provider,
        model: aggregatedUsage.model,
        cached: aggregatedUsage.cached,
      } : undefined,
      stopReason,
    };
  }
}
