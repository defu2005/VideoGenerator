import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AssistantService } from "../assistant/service.js";
import { getToolCatalogForPrompt } from "../assistant/tools.js";
import { invokeRegistryTool } from "../registry/invoke.js";

const InvokeBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  args: z.unknown().optional(),
}).strict();

export function registerRegistryRoutes(app: FastifyInstance, assistant: AssistantService): void {
  app.get("/api/registry/tools", async () => ({
    tools: getToolCatalogForPrompt().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      properties: tool.args,
    })),
  }));

  app.post("/api/registry/invoke", async (request, reply) => {
    const body = InvokeBodySchema.parse(request.body);
    const header = request.headers["x-vg-tool-source"];
    const source = header === "operator" ? "operator" : "mcp";
    const title = source === "operator" ? "Hệ thống operator" : "Hệ thống MCP";
    const result = await invokeRegistryTool({
      name: body.name,
      args: body.args ?? {},
      source,
      ctx: assistant.toolContext(),
      createPending: ({ tool, args, summary }) => assistant.createCallerPending(title, tool, args, summary),
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
