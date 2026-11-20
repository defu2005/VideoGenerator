import { z } from "zod";
import type { FormatRecipe, FormatRecipeId } from "../formats/recipes.js";
import type { ResearchNotes } from "../schemas/script.js";

export const StoryFrameworkSchema = z.enum([
  "question_driven", "cold_open", "contradiction", "three_act", "story_circle", "freytag", "listicle_payoff",
]);
export type StoryFramework = z.infer<typeof StoryFrameworkSchema>;
export const BeatPurposeSchema = z.enum([
  "hook", "setup", "reveal", "evidence", "tension", "explanation", "payoff", "reflection", "transition", "cta",
]);
export const BeatEmotionSchema = z.enum(["curious", "tense", "awe", "sad", "warm", "urgent", "calm", "playful"]);
const id = z.string().trim().min(1).max(120);
const text = z.string().trim().min(1).max(4000);
const factIds = z.array(z.string().regex(/^f[1-9]\d*$/)).max(16);
const loopIds = z.array(id).max(24);
export const StoryBeatSchema = z.object({
  id, sectionKey: id, purpose: BeatPurposeSchema, emotion: BeatEmotionSchema,
  concreteMoment: text, newInformation: text, opensLoops: loopIds, closesLoops: loopIds,
  factIds, visualIntent: text, targetSec: z.number().positive().max(3600),
}).strict();
export type StoryBeat = z.infer<typeof StoryBeatSchema>;
export const StoryOutlineSchema = z.object({
  centralQuestion: text, promise: text, framework: StoryFrameworkSchema,
  surprises: z.array(z.object({ fact: text, factIds: factIds.min(1) }).strict()).min(2).max(4),
  beats: z.array(StoryBeatSchema).min(2).max(80),
  loops: z.array(z.object({ id, question: text, opensAtBeatId: id, closesAtBeatId: id }).strict()).max(24),
  setupPayoffs: z.array(z.object({ setupBeatId: id, payoffBeatId: id, detail: text }).strict()).max(24),
}).strict();
export type StoryOutline = z.infer<typeof StoryOutlineSchema>;
export const HookTacticSchema = z.enum(["curiosity_gap", "cold_open", "contradiction", "high_stakes", "question"]);
export type HookTactic = z.infer<typeof HookTacticSchema>;
export const HookCandidateSchema = z.object({ id, tactic: HookTacticSchema, text, promise: text }).strict();
export type HookCandidate = z.infer<typeof HookCandidateSchema>;
export const StoryOutlineResponseSchema = z.object({ outline: StoryOutlineSchema, hooks: z.array(HookCandidateSchema).length(3) }).strict();
export type StoryOutlineResponse = z.infer<typeof StoryOutlineResponseSchema>;

/** Editorial choices are explicit so validity is decided in code. */
export const STORY_FRAMEWORKS_BY_RECIPE: Record<FormatRecipeId, readonly StoryFramework[]> = {
  explainer: ["question_driven", "contradiction", "three_act"], listicle: ["listicle_payoff", "question_driven"],
  story: ["three_act", "story_circle", "freytag", "cold_open"], news_recap: ["cold_open", "question_driven"],
  myth_vs_fact: ["contradiction", "question_driven"], how_to: ["question_driven", "three_act"],
  short_hook: ["cold_open", "contradiction", "question_driven"],
};
/** Legacy one-style recipes expand into three compatible tactics rather than three near-identical hooks. */
export const HOOK_TACTICS_BY_STYLE: Record<string, readonly HookTactic[]> = {
  "câu hỏi": ["question", "curiosity_gap", "contradiction"], "con số": ["curiosity_gap", "high_stakes", "contradiction"],
  "số lượng": ["curiosity_gap", "question", "high_stakes"], "cảnh giữa chuyện": ["cold_open", "high_stakes", "curiosity_gap"],
  "tiêu đề": ["high_stakes", "question", "curiosity_gap"], "tin đồn": ["contradiction", "question", "curiosity_gap"],
  "kết quả trước": ["cold_open", "curiosity_gap", "question"], "câu cụt": ["cold_open", "contradiction", "curiosity_gap"],
};
export function hookTacticsForRecipe(recipe: FormatRecipe): HookTactic[] {
  return [...new Set(recipe.script.hookStyles.flatMap((style) => HOOK_TACTICS_BY_STYLE[style] ?? []))];
}
/** IDs are stable within a research document without changing its stored schema. */
export function researchFactsWithIds(research: ResearchNotes): Array<ResearchNotes["keyFacts"][number] & { id: string }> {
  return research.keyFacts.map((fact, index) => ({ ...fact, id: `f${index + 1}` }));
}

/** Returns all semantic failures for the single outline repair prompt, after schema parsing. */
export function validateStoryOutline(response: StoryOutlineResponse, recipe: FormatRecipe, research: ResearchNotes, targetDurationSec: number): string[] {
  const { outline, hooks } = response;
  const errors: string[] = [];
  const beatIndex = new Map<string, number>();
  const sectionKeys = new Set(recipe.script.structure.map((section) => section.key));
  const knownFacts = new Set(researchFactsWithIds(research).map((fact) => fact.id));
  const declaredLoops = new Map(outline.loops.map((loop) => [loop.id, loop]));
  const checkUnique = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) errors.push(`${label}: duplicate ids.`);
  };
  const checkFacts = (values: readonly string[], label: string) => {
    checkUnique(values, `${label}.factIds`);
    for (const value of values) if (!knownFacts.has(value)) errors.push(`${label}: unknown fact ${value}.`);
  };
  if (!STORY_FRAMEWORKS_BY_RECIPE[recipe.id].includes(outline.framework)) errors.push(`Framework ${outline.framework} is not allowed for ${recipe.id}.`);
  checkUnique(outline.beats.map((beat) => beat.id), "beats");
  checkUnique(outline.loops.map((loop) => loop.id), "loops");
  outline.beats.forEach((beat, index) => {
    beatIndex.set(beat.id, index);
    if (!sectionKeys.has(beat.sectionKey)) errors.push(`${beat.id}: unknown sectionKey ${beat.sectionKey}.`);
    checkFacts(beat.factIds, beat.id);
    for (const field of ["opensLoops", "closesLoops"] as const) {
      checkUnique(beat[field], `${beat.id}.${field}`);
      for (const loopId of beat[field]) {
        const loop = declaredLoops.get(loopId);
        if (!loop) errors.push(`${beat.id}: undeclared loop ${loopId}.`);
        else if (loop[field === "opensLoops" ? "opensAtBeatId" : "closesAtBeatId"] !== beat.id) errors.push(`${beat.id}: ${field} ${loopId} disagrees with its declared endpoint.`);
      }
    }
  });
  for (const section of recipe.script.structure) {
    if (section.required && !outline.beats.some((beat) => beat.sectionKey === section.key)) errors.push(`Missing required sectionKey ${section.key}.`);
  }
  outline.surprises.forEach((surprise, index) => checkFacts(surprise.factIds, `surprise ${index + 1}`));
  for (const loop of outline.loops) {
    const open = beatIndex.get(loop.opensAtBeatId);
    const close = beatIndex.get(loop.closesAtBeatId);
    if (open === undefined || close === undefined || close <= open) errors.push(`Loop ${loop.id} must open and close in existing beats, closing strictly later.`);
    if (open !== undefined && !outline.beats[open]!.opensLoops.includes(loop.id)) errors.push(`Loop ${loop.id} is not opened at ${loop.opensAtBeatId}.`);
    if (close !== undefined && !outline.beats[close]!.closesLoops.includes(loop.id)) errors.push(`Loop ${loop.id} is not closed at ${loop.closesAtBeatId}.`);
  }
  for (const payoff of outline.setupPayoffs) {
    const setupIndex = beatIndex.get(payoff.setupBeatId);
    const payoffIndex = beatIndex.get(payoff.payoffBeatId);
    if (setupIndex === undefined || payoffIndex === undefined || payoffIndex <= setupIndex) errors.push(`Setup/payoff ${payoff.setupBeatId}/${payoff.payoffBeatId} must resolve in a later beat.`);
  }
  const seconds = outline.beats.reduce((sum, beat) => sum + beat.targetSec, 0);
  if (!Number.isFinite(targetDurationSec) || targetDurationSec <= 0 || Math.abs(seconds - targetDurationSec) > targetDurationSec * 0.1 + 1e-8) errors.push(`Beat durations sum to ${seconds}s; required ${targetDurationSec}s ±10%.`);
  checkUnique(hooks.map((hook) => hook.id), "hooks");
  if (new Set(hooks.map((hook) => hook.tactic)).size !== 3) errors.push("Hooks must use three different tactics.");
  const allowedTactics = hookTacticsForRecipe(recipe);
  for (const hook of hooks) if (!allowedTactics.includes(hook.tactic)) errors.push(`Hook ${hook.id}: tactic ${hook.tactic} is not allowed for ${recipe.id}.`);
  return errors;
}
