import { z } from "zod";
import { REPAIR_ACTIONS } from "@vg/shared";
import type { AssistantToolContext } from "../assistant/tools.js";
import { AppError } from "../lib/errors.js";
import { readScriptRepairHint, scriptRevisionFeedback, writeScriptRepairHint } from "./qualityGates.js";

/** Thin implementations behind the three `repair_*` registry tools (TASK-121). Each reuses an existing service. */

const SCRIPT_ACTIONS = ["revise_script", "revise_script_stronger_model", "rerun_research_then_script", "new_angle"] as const;
const SCENE_ACTIONS = [
  "vision_recheck", "pick_next_candidate", "research_scene", "web_search_scene", "rephrase_scene_visual", "switch_shot_type",
] as const;
const RENDER_STAGE_ACTIONS = [
  "rerun_voice", "rerun_music", "rerun_subtitle", "rebuild_timeline", "revise_script_target_length", "rerender",
] as const;
void REPAIR_ACTIONS;

export const repairScriptArgs = z.object({
  projectId: z.string().uuid(),
  action: z.enum(SCRIPT_ACTIONS),
  reason: z.string().min(1).max(200),
}).strict();

export const repairSceneArgs = z.object({
  projectId: z.string().uuid(),
  sceneIds: z.array(z.string().uuid()).min(1).max(60),
  action: z.enum(SCENE_ACTIONS),
  reason: z.string().min(1).max(200),
  /** Freeze/black from the render gate: rebuild TIMELINE (and carry on) after the scene changes. */
  thenTimeline: z.boolean().optional(),
}).strict();

export const repairRenderStageArgs = z.object({
  projectId: z.string().uuid(),
  action: z.enum(RENDER_STAGE_ACTIONS),
  reason: z.string().min(1).max(200),
  targetWords: z.number().int().min(20).max(20000).optional(),
}).strict();

function bumpReviseRound(ctx: AssistantToolContext, projectId: string): { previousVersion: number | null } {
  const row = ctx.sqlite.prepare("SELECT version FROM scripts WHERE project_id = ?").get(projectId) as { version: number } | undefined;
  ctx.sqlite.prepare("UPDATE scripts SET revise_round = revise_round + 1 WHERE project_id = ?").run(projectId);
  return { previousVersion: row?.version ?? null };
}

export async function executeRepairScript(args: z.infer<typeof repairScriptArgs>, ctx: AssistantToolContext) {
  const { projectId, action } = args;
  const bumped = bumpReviseRound(ctx, projectId);
  if (action === "revise_script") writeScriptRepairHint(ctx.sqlite, projectId, null);
  if (action === "revise_script_stronger_model") writeScriptRepairHint(ctx.sqlite, projectId, { stronger: true });
  if (action === "new_angle") writeScriptRepairHint(ctx.sqlite, projectId, { newAngle: true });
  if (action === "rerun_research_then_script") {
    const facts = scriptRevisionFeedback(ctx.sqlite, projectId).reasons.slice(0, 5);
    writeScriptRepairHint(ctx.sqlite, projectId, { extraQueries: facts });
    ctx.orchestrator.runStageThenContinue(projectId, "RESEARCH");
    return { action, previousScriptVersion: bumped.previousVersion, stage: "RESEARCH" };
  }
  await ctx.orchestrator.runStage(projectId, "SCRIPT");
  return { action, previousScriptVersion: bumped.previousVersion, stage: "SCRIPT" };
}

async function visualService(ctx: AssistantToolContext) {
  const { VisualService } = await import("../services/visualService.js");
  const { JobRepository } = await import("../jobs/jobRepository.js");
  const { PipelineEventBus } = await import("../jobs/eventBus.js");
  return new VisualService(ctx.sqlite, new JobRepository(ctx.sqlite, new PipelineEventBus()), ctx.config);
}

export async function executeRepairScene(args: z.infer<typeof repairSceneArgs>, ctx: AssistantToolContext) {
  const { projectId, action } = args;
  const service = await visualService(ctx);
  const undo: Array<{ sceneId: string; candidateId: string | null }> = [];
  let changed = 0;
  for (const sceneId of args.sceneIds) {
    const before = service.repairSceneView(projectId).find((scene) => scene.sceneId === sceneId);
    if (!before || before.owned) continue; // never touch a scene the user owns
    const previous = before.candidateId;
    let done = false;
    if (action === "vision_recheck") {
      done = (await service.repairVisionRecheck(projectId, sceneId, ctx.registry, ctx.signal)).changed;
    } else if (action === "pick_next_candidate") {
      done = (await service.repairPickNextCandidate(projectId, sceneId, ctx.signal)).changed;
    } else if (action === "research_scene") {
      await service.repairResearchScene(projectId, sceneId, ctx.signal);
      done = (await service.repairPickNextCandidate(projectId, sceneId, ctx.signal)).changed;
    } else if (action === "web_search_scene") {
      if (!service.repairWebAllowed()) throw new AppError(409, "REPAIR_WEB_OFF", "Nguồn ảnh web chưa bật.");
      await service.repairWebSearchScene(projectId, sceneId, ctx.signal);
      done = (await service.repairPickNextCandidate(projectId, sceneId, ctx.signal)).changed;
    } else if (action === "rephrase_scene_visual") {
      service.repairRephraseScene(projectId, sceneId);
      await service.repairResearchScene(projectId, sceneId, ctx.signal);
      done = (await service.repairPickNextCandidate(projectId, sceneId, ctx.signal)).changed;
    } else {
      done = service.repairSwitchShotType(projectId, sceneId).changed;
    }
    undo.push({ sceneId, candidateId: previous });
    if (done) changed += 1;
  }
  if (args.thenTimeline) ctx.orchestrator.runStageThenContinue(projectId, "TIMELINE");
  return { action, changed, scenes: undo };
}

export async function executeRepairRenderStage(args: z.infer<typeof repairRenderStageArgs>, ctx: AssistantToolContext) {
  const { projectId, action } = args;
  switch (action) {
    case "rerun_voice": ctx.orchestrator.runStageThenContinue(projectId, "VOICE"); break;
    case "rerun_music": ctx.orchestrator.runStageThenContinue(projectId, "MUSIC_SEARCH"); break;
    case "rerun_subtitle": ctx.orchestrator.runStageThenContinue(projectId, "SUBTITLE"); break;
    case "rebuild_timeline": ctx.orchestrator.runStageThenContinue(projectId, "TIMELINE"); break;
    case "rerender": await ctx.orchestrator.runStage(projectId, "RENDER"); break;
    case "revise_script_target_length": {
      bumpReviseRound(ctx, projectId);
      const hint = readScriptRepairHint(ctx.sqlite, projectId) ?? {};
      writeScriptRepairHint(ctx.sqlite, projectId, { ...hint, ...(args.targetWords ? { targetWords: args.targetWords } : {}) });
      ctx.orchestrator.runStageThenContinue(projectId, "SCRIPT");
      break;
    }
  }
  return { action };
}
