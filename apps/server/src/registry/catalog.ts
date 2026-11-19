import { createHash } from "node:crypto";
import { z } from "zod";
import { ASSISTANT_TOOLS, getToolCatalogForPrompt } from "../assistant/tools.js";

export function registryCatalog() {
  return getToolCatalogForPrompt().map((tool) => ({
    name: tool.name, description: tool.description, risk: tool.risk, properties: tool.args,
    inputSchema: z.toJSONSchema(ASSISTANT_TOOLS[tool.name]!.argsSchema, { io: "input" }),
  }));
}
export function registryCatalogHash() {
  return createHash("sha256").update(JSON.stringify(registryCatalog().sort((a, b) => a.name.localeCompare(b.name)))).digest("hex");
}
