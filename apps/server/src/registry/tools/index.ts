// TASK-085: registry tool list, order unchanged (groups, then module spreads). Tail moved verbatim.
import type { AssistantToolRisk } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { logToolAudit } from "../../registry/audit.js";
import { hardBlockMessage } from "../../registry/policy.js";
import type { ToolSource } from "../../registry/policy.js";
import { knowledgeToolDefs } from "../../knowledge/toolDefs.js";
import { stageToolDefs } from "../../learning/stageToolDefs.js";
import { originalityToolDefs } from "../../originality/toolDefs.js";
import { providerIntelToolDefs } from "../../providerIntel/toolDefs.js";
import { styleToolDefs } from "../../style/toolDefs.js";
import { supervisionToolDefs } from "../../supervision/toolDefs.js";
import { mailboxToolDefs } from "../../supervision/mailbox.js";
import { fleetToolDefs } from "../../fleet/toolDefs.js";
import { researchToolDefs } from "../../research/toolDefs.js";
import { agentStageToolDefs } from "../../agents/toolDefs.js";
import { previewToolDefs } from "../../preview/toolDefs.js";
import { storageToolDefs } from "../../storage/toolDefs.js";
import { continuityToolDefs } from "../../continuity/toolDefs.js";
import type { AssistantToolContext, AssistantToolDef } from "./define.js";
import { growthToolDefs } from "./growth.js";
import { operatorToolDefs } from "./operator.js";
import { overviewToolDefs } from "./overview.js";
import { pipelineActionsToolDefs } from "./pipelineActions.js";
import { projectsToolDefs } from "./projects.js";
import { skillsToolDefs } from "./skills.js";
import { systemToolDefs } from "./system.js";
import { topicsAutomationToolDefs } from "./topicsAutomation.js";

const toolDefs: AssistantToolDef[] = [
  ...projectsToolDefs,
  ...overviewToolDefs,
  ...topicsAutomationToolDefs,
  ...pipelineActionsToolDefs,
  ...growthToolDefs,
  ...operatorToolDefs,
  ...skillsToolDefs,
  ...systemToolDefs,
  ...providerIntelToolDefs,
  ...styleToolDefs,
  ...supervisionToolDefs,
  ...mailboxToolDefs(),
  ...fleetToolDefs,
  ...researchToolDefs,
  ...agentStageToolDefs,
  ...knowledgeToolDefs,
  ...stageToolDefs,
  ...originalityToolDefs,
  ...previewToolDefs,
  ...continuityToolDefs,
  ...storageToolDefs,
];
export const ASSISTANT_TOOLS: Record<string, AssistantToolDef> = Object.fromEntries(
  toolDefs.map((tool) => [tool.name, tool]),
);

export const ALWAYS_CONFIRM_TOOLS = new Set<string>([
  "delete_project", "delete_topic", "propose_knowledge_change", "import_knowledge", "resolve_change_event", "report_change",
]);

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
    // A nested object that repeats a sibling field with the same signature
    // (create_project: settings.platform vs platform) only costs prompt space.
    for (const value of Object.values(out)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const nested = value as Record<string, unknown>;
      for (const [key, sig] of Object.entries(nested)) {
        if (key in out && JSON.stringify(out[key]) === JSON.stringify(sig)) delete nested[key];
      }
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
  meta: { source?: ToolSource; runId?: string | null } = {},
): Promise<unknown> {
  const tool = ASSISTANT_TOOLS[name];
  const source = meta.source ?? "assistant";
  const blocked = hardBlockMessage(name, args);
  if (blocked) {
    logToolAudit(ctx.sqlite, {
      source,
      tool: name,
      args,
      risk: tool?.risk ?? "confirm",
      decision: "refused",
      summary: blocked,
      runId: meta.runId,
    });
    throw new AppError(403, "TOOL_BLOCKED", blocked);
  }
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
  const result = await tool.execute(parsed, ctx);
  logToolAudit(ctx.sqlite, {
    source,
    tool: name,
    args: parsed,
    risk: tool.risk,
    decision: "executed",
    summary: summarizeTool(name, parsed),
    runId: meta.runId,
  });
  return result;
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
