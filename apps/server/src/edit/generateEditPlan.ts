import { z } from "zod";
import { resolveBudget, resolveFormat, type Project, type Timeline } from "@vg/shared";
import type Database from "better-sqlite3";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";

const LoosePlanSchema = z.object({
  transitions: z.array(z.object({
    afterSceneId: z.string(),
    type: z.string(),
    durationSec: z.number(),
  })).optional(),
  motions: z.array(z.object({ sceneId: z.string(), preset: z.string() })).optional(),
  emphasis: z.array(z.object({
    sceneId: z.string(),
    wordIndexStart: z.number(),
    wordIndexEnd: z.number(),
    effects: z.array(z.string()),
    calloutText: z.string().optional(),
    startSec: z.number().optional(),
  })).optional(),
  subtitleStyle: z.string().optional(),
});

/** One edit-plan call. Returns null when the budget feature is off or the model fails. */
export async function generateEditPlanRaw(input: {
  registry: LlmProviderRegistry;
  sqlite: Database.Database;
  project: Project;
  timeline: Timeline;
}): Promise<unknown | null> {
  if (!resolveBudget(input.project).editPlan) return null;
  const recipe = resolveFormat({
    topic: input.project.topic,
    aspectRatio: input.project.settings.aspectRatio,
    targetDurationSec: input.project.settings.targetDurationSec,
    format: input.project.settings.format,
  }).recipe;
  const route = input.registry.resolveTask("editPlan", input.project, getAppLlmSettings(input.sqlite));
  const generated = await generateRoutedStructured({
    registry: input.registry,
    route,
    task: "editPlan",
    schema: LoosePlanSchema,
    schemaName: "EditPlan",
    schemaVersion: "1",
    maxOutputTokens: 1200,
    system: "Bạn lập kế hoạch dựng video. Chỉ trả JSON. type là cut, fade, fadeblack, dissolve, smoothleft, smoothright, slideup, wipeleft, circleopen, zoomin, radial hoặc hblur. preset là push_in, pull_out, pan_left, pan_right, pan_up, punch_in hoặc static. effects là punch_in, callout, flash, sfx. calloutText tối đa 24 ký tự.",
    prompt: JSON.stringify({
      title: input.project.title,
      aspect: input.project.settings.aspectRatio,
      preset: input.project.settings.edit?.preset ?? recipe.edit.preset,
      format: recipe.id,
      graphics: recipe.edit.graphics,
      scenes: input.timeline.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        label: scene.label,
        startSec: scene.startSec,
        durationSec: scene.durationSec,
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return generated.value;
}
