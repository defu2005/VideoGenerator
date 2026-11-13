import {
  ApiErrorSchema,
  GUIDELINE_DISCLAIMER,
  GuidelineFindingsResponseSchema,
  GuidelinePacksResponseSchema,
  GuidelineProfilesSchema,
  PROJECT_RULES_PACK_ID,
  SaveGuidelinePacksInputSchema,
  resolveBudget,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import type { AppConfig } from "../lib/config.js";
import { runGuidelineLlmCheck } from "../guidelines/llmCheck.js";
import { GuidelineService } from "../guidelines/service.js";
import { getGuidelinePacks, getGuidelineProfiles, saveGuidelinePacks, saveGuidelineProfiles } from "../guidelines/settings.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { requireProject, type ProjectService } from "../services/projectService.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();
const FindingParamsSchema = z.object({
  id: z.string().uuid(),
  findingId: z.string().uuid(),
}).strict();
const DismissSchema = z.object({
  reason: z.string().trim().max(300).optional(),
}).strict();

export function registerGuidelineRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  projects: ProjectService,
  guidelines: GuidelineService,
  registry: LlmProviderRegistry,
  config: AppConfig,
): void {
  app.get("/api/guidelines/packs", {
    schema: { response: { 200: GuidelinePacksResponseSchema } },
  }, async () => ({
    builtIn: guidelines.builtInPacks(),
    custom: getGuidelinePacks(sqlite),
    disclaimer: GUIDELINE_DISCLAIMER,
  }));

  app.put("/api/guidelines/packs", {
    schema: {
      body: SaveGuidelinePacksInputSchema,
      response: { 200: GuidelinePacksResponseSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = SaveGuidelinePacksInputSchema.parse(request.body);
    if (body.packs.some((pack) => pack.id === PROJECT_RULES_PACK_ID)) {
      throw new AppError(400, "VALIDATION_ERROR", 'Pack id "project" is reserved.');
    }
    if (new Set(body.packs.map((pack) => pack.id)).size !== body.packs.length) {
      throw new AppError(400, "VALIDATION_ERROR", "Pack ids must be unique.");
    }
    saveGuidelinePacks(sqlite, body.packs);
    return {
      builtIn: guidelines.builtInPacks(),
      custom: body.packs,
      disclaimer: GUIDELINE_DISCLAIMER,
    };
  });

  app.get("/api/guidelines/profiles", {
    schema: { response: { 200: GuidelineProfilesSchema } },
  }, async () => getGuidelineProfiles(sqlite));

  app.put("/api/guidelines/profiles", {
    schema: {
      body: GuidelineProfilesSchema,
      response: { 200: GuidelineProfilesSchema, 400: ApiErrorSchema },
    },
  }, async (request) => {
    const body = GuidelineProfilesSchema.parse(request.body);
    const ids = body.profiles.map((profile) => profile.id);
    if (new Set(ids).size !== ids.length) throw new AppError(400, "VALIDATION_ERROR", "Profile ids must be unique.");
    if (body.defaultProfileId && !ids.includes(body.defaultProfileId)) {
      throw new AppError(400, "VALIDATION_ERROR", "defaultProfileId does not match a profile.");
    }
    saveGuidelineProfiles(sqlite, body);
    return body;
  });

  app.get("/api/projects/:id/guidelines/findings", {
    schema: {
      params: ParamsSchema,
      response: { 200: GuidelineFindingsResponseSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return guidelines.responseFor(await requireProject(projects, id));
  });

  app.post("/api/projects/:id/guidelines/findings/:findingId/dismiss", {
    schema: {
      params: FindingParamsSchema,
      body: DismissSchema.optional(),
      response: { 200: GuidelineFindingsResponseSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id, findingId } = FindingParamsSchema.parse(request.params);
    const body = DismissSchema.optional().parse(request.body ?? {});
    await requireProject(projects, id);
    guidelines.dismiss(id, findingId, body?.reason);
    return guidelines.responseFor(await requireProject(projects, id));
  });

  app.post("/api/projects/:id/guidelines/check", {
    schema: {
      params: ParamsSchema,
      response: { 200: GuidelineFindingsResponseSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const project = await requireProject(projects, id);
    const script = guidelines.readScript(project.id);
    if (script) guidelines.runCodeChecks(project, "SCRIPT");
    if (guidelines.readTimeline(project.id)) guidelines.runCodeChecks(project, "TIMELINE");
    if (script && resolveBudget(project).guidelineCheck !== "off") {
      try {
        const checked = await runGuidelineLlmCheck({
          sqlite,
          registry,
          config,
          project,
          script,
          active: guidelines.activeFor(project),
          signal: AbortSignal.timeout(config.LLM_TIMEOUT_MS),
          logger: request.log,
        });
        guidelines.replaceFindings(project.id, "SCRIPT", "LLM", checked.drafts);
      } catch (error) {
        request.log.warn({ err: error, projectId: project.id }, "On-demand guidelineCheck failed");
      }
    }
    return guidelines.responseFor(project);
  });
}
