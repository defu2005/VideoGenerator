import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AssistantService } from "../assistant/service.js";
import { ASSISTANT_TOOLS, getToolCatalogForPrompt } from "../assistant/tools.js";
import { systemActorFor } from "../auth/workspaces.js";
import { invokeRegistryTool } from "../registry/invoke.js";
import type { OperatorService } from "../operator/service.js";
import { AppError } from "../lib/errors.js";
import { INTERNAL_OPERATOR, resolveTrustedAgent } from "../supervision/identity.js";
import { touchInstance } from "../supervision/duty.js";

const InvokeBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  args: z.unknown().optional(),
}).strict();

export function registerRegistryRoutes(app: FastifyInstance, assistant: AssistantService, operator: OperatorService): void {
  app.get("/api/registry/tools", async () => ({
    tools: getToolCatalogForPrompt().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      properties: tool.args,
      inputSchema: z.toJSONSchema(ASSISTANT_TOOLS[tool.name]!.argsSchema, { io: "input" }),
    })),
  }));

  app.post("/api/registry/invoke", async (request, reply) => {
    const body = InvokeBodySchema.parse(request.body);
    const header = request.headers["x-vg-tool-source"];
    const source = header === "operator" ? "operator" : header === "agent" ? "agent" : "mcp";
    const token = request.headers["x-vg-operator-invocation"];
    const managed = source === "operator" && request.headers["x-vg-operator-managed"] === "1";
    const invocation = managed && typeof token === "string" ? operator.resolveMcpInvocation(token) : undefined;
    if (managed && !invocation && ASSISTANT_TOOLS[body.name]?.risk !== "read") {
      throw new AppError(403, "OPERATOR_INVOCATION_REQUIRED", "Mở lượt Agent operator trong app để gọi công cụ có tác dụng phụ.");
    }
    const title = source === "operator" ? "Hệ thống operator" : source === "agent" ? "MCP có quyền thao tác" : "Hệ thống MCP";
    const ctx = assistant.toolContext();
    const caller = request.actor;
    const actor = source === "mcp" && caller ? caller : systemActorFor(ctx.sqlite, caller?.workspaceId);
    if (source === "operator") {
      ctx.agent = INTERNAL_OPERATOR;
    } else {
      const trusted = resolveTrustedAgent({
        sqlite: ctx.sqlite,
        keyId: (caller as any)?.keyId,
        headers: request.headers as Record<string, string | undefined>,
        warn: (data, msg) => request.log.warn(data, msg),
      });
      ctx.agent = trusted;
      touchInstance(ctx.sqlite, trusted, { tool: true });
    }
    const result = await invokeRegistryTool({
      name: body.name,
      args: body.args ?? {},
      source,
      ...invocation,
      ctx,
      actor,
      createPending: ({ tool, args, summary, actor: by }) => assistant.createCallerPending(title, tool, args, summary, by),
    });
    if (result.kind === "refused") {
      return reply.code(403).send({
        error: { code: "TOOL_BLOCKED", message: result.message },
      });
    }
    if (result.kind === "pending") {
      return { pendingActionId: result.pendingActionId, summaryVi: result.summaryVi };
    }
    return { result: result.result };
  });
}
