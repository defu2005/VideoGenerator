import {
  ApiErrorSchema,
  MergedStorySchema,
  ResearchNotesSchema,
  SaveScriptInputSchema,
  ScriptDataSchema,
  ScriptSchema,
  storyModeForProject,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ScriptService } from "../services/scriptService.js";
import type { ProjectService } from "../services/projectService.js";
import { requireProject } from "../services/projectService.js";
import { researchPrompt } from "../stages/research/prompt.js";
import { mergedStoryPrompt } from "../stages/script/mergedStoryPrompt.js";
import { scriptPrompt } from "../stages/script/prompt.js";
import type { AppConfig } from "../lib/config.js";
import type { GuidelineService } from "../guidelines/service.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();
const PromptParamsSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum(["RESEARCH", "SCRIPT", "STORY"]),
}).strict();
const PromptResponseSchema = z.object({
  stage: z.enum(["RESEARCH", "SCRIPT", "STORY"]),
  system: z.string(),
  user: z.string(),
  jsonSchema: z.record(z.string(), z.unknown()),
  language: z.string(),
  targetDurationSec: z.number().int(),
}).strict();

export function registerScriptRoutes(
  app: FastifyInstance,
  service: ScriptService,
  projects: ProjectService,
  config: AppConfig,
  guidelines: GuidelineService,
): void {
  app.get("/api/projects/:id/script", {
    schema: {
      params: ParamsSchema,
      response: { 200: ScriptDataSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.get(id);
  });

  app.put("/api/projects/:id/script", {
    schema: {
      params: ParamsSchema,
      body: SaveScriptInputSchema,
      response: { 200: ScriptDataSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.save(id, SaveScriptInputSchema.parse(request.body));
  });

  app.put("/api/projects/:id/research", {
    schema: {
      params: ParamsSchema,
      body: ResearchNotesSchema,
      response: { 200: ScriptDataSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.saveResearch(id, ResearchNotesSchema.parse(request.body));
  });

  app.get("/api/projects/:id/prompts/:stage", {
    schema: {
      params: PromptParamsSchema,
      response: { 200: PromptResponseSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id, stage } = PromptParamsSchema.parse(request.params);
    const project = await requireProject(projects, id);
    const data = stage === "SCRIPT" ? service.get(id) : undefined;
    const researchMode = storyModeForProject(project);
    const research = researchMode !== "off" ? data?.research?.data : undefined;
    const storyGuidance = guidelines.guidanceFor(project, ["script", "subtitles"]);
    const prompt = stage === "STORY"
      ? mergedStoryPrompt(project, config.SPEECH_WORDS_PER_MINUTE, "standard", storyGuidance)
      : stage === "RESEARCH" && researchMode === "merged"
        ? mergedStoryPrompt(project, config.SPEECH_WORDS_PER_MINUTE, "standard", storyGuidance)
        : stage === "RESEARCH"
          ? researchPrompt(project, "standard", guidelines.guidanceFor(project, ["script"]))
          : scriptPrompt(project, research, config.SPEECH_WORDS_PER_MINUTE, storyGuidance);
    const schema = stage === "STORY"
      ? MergedStorySchema
      : stage === "RESEARCH" && researchMode === "merged"
        ? MergedStorySchema
        : stage === "RESEARCH"
          ? ResearchNotesSchema
          : ScriptSchema;
    return {
      stage,
      system: prompt.system,
      user: prompt.prompt,
      jsonSchema: z.toJSONSchema(schema),
      language: project.settings.language,
      targetDurationSec: project.settings.targetDurationSec,
    };
  });
}
