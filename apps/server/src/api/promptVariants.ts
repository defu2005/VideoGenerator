import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { getVariant, promotePromptVariant, registerPromptVariant, VARIANT_TEXT_MAX } from "../learning/promptVariants.js";

const RegisterBodySchema = z.object({
  stage: z.enum(["SCRIPT"]),
  text: z.string().min(1).max(VARIANT_TEXT_MAX),
}).strict();
const IdParamsSchema = z.object({ id: z.string().min(1) }).strict();

/** TASK-148e: prompt variants. Only a user registers or promotes; an agent gets 403 (same rule as stage lessons). */
export function registerPromptVariantRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.post("/api/stage-prompt-variants", async (request) => {
    if (request.actor?.kind === "apikey") throw new AppError(403, "AGENT_CANNOT_DECIDE", "Agents may not register prompt variants.");
    const body = RegisterBodySchema.parse(request.body);
    return registerPromptVariant(sqlite, { stage: body.stage, text: body.text });
  });

  app.get("/api/stage-prompt-variants/:id", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    const row = getVariant(sqlite, id);
    if (!row) throw new AppError(404, "PROMPT_VARIANT_NOT_FOUND", "Prompt variant not found");
    return row;
  });

  app.post("/api/stage-prompt-variants/:id/promote", async (request) => {
    if (request.actor?.kind === "apikey") throw new AppError(403, "AGENT_CANNOT_DECIDE", "Agents may not promote prompt variants.");
    const { id } = IdParamsSchema.parse(request.params);
    try {
      return promotePromptVariant(sqlite, { id, decidedBy: "user" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "VARIANT_NOT_FOUND") throw new AppError(404, "PROMPT_VARIANT_NOT_FOUND", "Prompt variant not found");
      if (code === "PROMPT_VARIANT_USER_ONLY") throw new AppError(403, "AGENT_CANNOT_DECIDE", "Only a user may promote a prompt variant.");
      throw error;
    }
  });
}

