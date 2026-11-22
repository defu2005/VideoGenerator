import {
  ApiErrorSchema,
  MergedStorySchema,
  ResearchNotesSchema,
  StoredResearchNotesSchema,
  SaveScriptInputSchema,
  StoryBeatSchema,
  StoryOutlineSchema,
  ScriptDataSchema,
  ScriptSchema,
  storyModeForProject,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import { ScriptService } from "../services/scriptService.js";
import type { ProjectService } from "../services/projectService.js";
import { requireProject } from "../services/projectService.js";
import { researchPrompt } from "../stages/research/prompt.js";
import { mergedStoryPrompt } from "../stages/script/mergedStoryPrompt.js";
import { deeperResearchDepth, scriptPrompt } from "../stages/script/prompt.js";
import type { AppConfig } from "../lib/config.js";
import type { GuidelineService } from "../guidelines/service.js";
import { getProfilePromptContext } from "../services/profileService.js";
import { captureScriptEdit, feedbackSourceFor } from "../learning/stageFeedback.js";
import type Database from "better-sqlite3";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();
const SwitchHookBodySchema = z.object({ hookId: z.string().min(1) }).strict();
// TASK-146: only the central question and beat concrete moments are editable; every other key is rejected.
const OutlineEditBodySchema = z.object({
  centralQuestion: StoryOutlineSchema.shape.centralQuestion.optional(),
  beats: z.array(z.object({
    id: StoryBeatSchema.shape.id,
    concreteMoment: StoryBeatSchema.shape.concreteMoment,
  }).strict()).min(1).max(80).optional(),
}).strict();
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
  sqlite?: Database.Database,
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
    const next = SaveScriptInputSchema.parse(request.body);
    const previous = service.get(id).script;
    const saved = await service.save(id, next);
    if (sqlite) {
      // Best-effort: a capture failure must never fail a save that already succeeded.
      try {
        const row = sqlite.prepare("SELECT profile_id AS profileId FROM projects WHERE id = ?").get(id) as { profileId: string | null } | undefined;
        captureScriptEdit(sqlite, { projectId: id, profileId: row?.profileId ?? null, before: previous?.data ?? null, after: next, source: feedbackSourceFor(request.actor) });
      } catch (error) {
        request.log.warn({ err: error, projectId: id }, "stage feedback capture failed");
      }
    }
    return saved;
  });

  app.put("/api/projects/:id/research", {
    schema: {
      params: ParamsSchema,
      body: StoredResearchNotesSchema,
      response: { 200: ScriptDataSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.saveResearch(id, StoredResearchNotesSchema.parse(request.body));
  });

  app.post("/api/projects/:id/script/hook", {
    schema: {
      params: ParamsSchema,
      body: SwitchHookBodySchema,
      response: { 200: ScriptDataSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const { hookId } = SwitchHookBodySchema.parse(request.body);
    return service.switchHook(id, hookId);
  });

  app.post("/api/projects/:id/script/outline", {
    schema: {
      params: ParamsSchema,
      body: OutlineEditBodySchema,
      response: { 200: ScriptDataSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const edit = OutlineEditBodySchema.parse(request.body);
    if (edit.centralQuestion === undefined && edit.beats === undefined) {
      throw new AppError(400, "NOTHING_TO_EDIT", "Send centralQuestion, beats, or both.");
    }
    return service.editOutline(id, edit);
  });

  app.post("/api/projects/:id/script/critique", {
    schema: {
      params: ParamsSchema,
      response: { 200: ScriptDataSchema, 404: ApiErrorSchema, 409: ApiErrorSchema, 503: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return service.rescoreCritique(id);
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
    const promptContext = sqlite ? getProfilePromptContext(sqlite, project.profileId, stage === "RESEARCH" ? "RESEARCH" : "SCRIPT") : undefined;
    const channelDirection = promptContext?.direction;
    const learnedNotes = promptContext?.learnedNotes;
    const researchDepth = deeperResearchDepth("standard", project);
    const prompt = stage === "STORY"
      ? mergedStoryPrompt(project, config.SPEECH_WORDS_PER_MINUTE, researchDepth, storyGuidance, channelDirection, learnedNotes)
      : stage === "RESEARCH" && researchMode === "merged"
        ? mergedStoryPrompt(project, config.SPEECH_WORDS_PER_MINUTE, researchDepth, storyGuidance, channelDirection, learnedNotes)
        : stage === "RESEARCH"
          ? researchPrompt(project, researchDepth, guidelines.guidanceFor(project, ["script"]), channelDirection)
          : scriptPrompt(project, research, config.SPEECH_WORDS_PER_MINUTE, storyGuidance, channelDirection, learnedNotes);
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
