import type { AssistantPendingAction } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { AssistantToolContext } from "../assistant/tools.js";
import { ALWAYS_CONFIRM_TOOLS, ASSISTANT_TOOLS, summarizeTool } from "../assistant/tools.js";
import { logToolAudit } from "./audit.js";
import { effectiveRisk, hardBlockMessage, shouldCreatePending, type ToolSource } from "./policy.js";

export type RegistryInvokeResult =
  | { kind: "result"; result: unknown; summary: string; risk: string }
  | { kind: "pending"; pendingActionId: string; summaryVi: string; risk: string }
  | { kind: "refused"; message: string; risk: string };

export async function invokeRegistryTool(input: {
  name: string;
  args: unknown;
  source: ToolSource;
  ctx: AssistantToolContext;
  autoConfirm?: boolean;
  runId?: string | null;
  createPending: (pending: { tool: string; args: unknown; summary: string }) => Pick<AssistantPendingAction, "id" | "summary">;
}): Promise<RegistryInvokeResult> {
  const blocked = hardBlockMessage(input.name, input.args);
  const tool = ASSISTANT_TOOLS[input.name];
  const risk = effectiveRisk(tool?.risk);
  if (blocked) {
    logToolAudit(input.ctx.sqlite, {
      source: input.source,
      tool: input.name,
      args: input.args,
      risk,
      decision: "refused",
      summary: blocked,
      runId: input.runId,
    });
    return { kind: "refused", message: blocked, risk };
  }
  if (!tool) {
    throw new AppError(400, "UNKNOWN_TOOL", `Công cụ không tồn tại: ${input.name}`);
  }
  let parsed: unknown;
  try {
    parsed = tool.argsSchema.parse(input.args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tham số không hợp lệ";
    throw new AppError(400, "INVALID_TOOL_ARGS", message);
  }
  const summary = summarizeTool(input.name, parsed);
  if (shouldCreatePending({
    name: input.name,
    args: parsed,
    risk: tool.risk,
    source: input.source,
    autoConfirm: input.autoConfirm === true,
    alwaysConfirm: ALWAYS_CONFIRM_TOOLS.has(input.name),
  })) {
    const pending = input.createPending({ tool: input.name, args: parsed, summary });
    logToolAudit(input.ctx.sqlite, {
      source: input.source,
      tool: input.name,
      args: parsed,
      risk,
      decision: "pending",
      summary,
      pendingActionId: pending.id,
      runId: input.runId,
    });
    return { kind: "pending", pendingActionId: pending.id, summaryVi: pending.summary, risk };
  }
  const result = await tool.execute(parsed, input.ctx);
  logToolAudit(input.ctx.sqlite, {
    source: input.source,
    tool: input.name,
    args: parsed,
    risk,
    decision: "executed",
    summary,
    runId: input.runId,
  });
  return { kind: "result", result, summary, risk };
}
