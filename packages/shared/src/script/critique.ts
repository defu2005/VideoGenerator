import { z } from "zod";
import type { HookCandidate, HookTactic } from "./outline.js";

export const SCRIPT_CRITERION_WEIGHTS = { structure: 20, hook: 20, accuracy: 20, ttsNatural: 15, visualizable: 15, originality: 10 } as const;
export const ScriptCriterionSchema = z.enum(["structure", "hook", "accuracy", "ttsNatural", "visualizable", "originality"]);
export type ScriptCriterion = z.infer<typeof ScriptCriterionSchema>;
const score = z.number().min(0).max(5);
export const ScriptScoresSchema = z.object({ structure: score, hook: score, accuracy: score, ttsNatural: score, visualizable: score, originality: score }).strict();
export type ScriptScores = z.infer<typeof ScriptScoresSchema>;

export const CRITIC_RUBRIC_SYSTEM_PROMPT = `You are a rigorous script critic for short-form and long-form video.
Evaluate scripts against these 6 narrative criteria (score each 0-5):
1. structure (weight 20): Does the narrative build tension, deliver payoff, and avoid filler or rambling?
2. hook (weight 20): Does the hook grab immediate attention within 3 seconds and pose an irresistible open loop?
3. accuracy (weight 20): Are claims factual, grounded in research, and free from misleading assertions?
4. ttsNatural (weight 15): Is the rhythm natural when spoken aloud? No tongue-twisters, robotic phrasing, or awkward breath stops.
5. visualizable (weight 15): Does each line evoke clear, dynamic visual moments rather than abstract talking-head lecturing?
6. originality (weight 10): Is the framing fresh, avoiding predictable clichés, platitudes, and boilerplate conclusions?

Identify specific section issues with clear fixes. Check if the opening hook is resolved by the end (hookPaidOff) and list any open loops that were forgotten.`;
export const ScriptCritiqueInputSchema = z.object({
  scores: ScriptScoresSchema,
  // Accepted for provider compatibility, always replaced in computeScriptCritique.
  total: z.number().optional(),
  sectionIssues: z.array(z.object({
    sectionId: z.string().min(1), criterion: ScriptCriterionSchema, problem: z.string().min(1), fix: z.string().min(1),
  }).strict()).max(40),
  hookPaidOff: z.boolean(), unclosedLoops: z.array(z.string().min(1)).max(24),
}).strict();
export const ScriptCritiqueSchema = ScriptCritiqueInputSchema.extend({ total: z.number().min(0).max(100) });
export type ScriptCritique = z.infer<typeof ScriptCritiqueSchema>;
export function computeScriptCritique(input: z.input<typeof ScriptCritiqueInputSchema>): ScriptCritique {
  const parsed = ScriptCritiqueInputSchema.parse(input);
  const total = (Object.keys(SCRIPT_CRITERION_WEIGHTS) as ScriptCriterion[])
    .reduce((sum, criterion) => sum + SCRIPT_CRITERION_WEIGHTS[criterion] * parsed.scores[criterion] / 5, 0);
  return { ...parsed, total: Math.round(total * 10) / 10 };
}
export function scriptCritiqueNeedsRewrite(critique: ScriptCritique, hasFixLint: boolean): boolean {
  return critique.total < 75 || Object.values(critique.scores).some((value) => value < 3)
    || !critique.hookPaidOff || critique.unclosedLoops.length > 0 || hasFixLint;
}
export function scriptCritiqueNeedsHold(critique: ScriptCritique, hasBlockingFacts: boolean): boolean {
  return critique.total < 60 || critique.scores.accuracy < 3 || hasBlockingFacts;
}
export const HookScoresSchema = z.object({ clarity: score, curiosity: score, accuracy: score, audienceFit: score, payoff: score }).strict();
export const HookAssessmentSchema = z.object({ hookId: z.string().min(1), scores: HookScoresSchema }).strict();
export type HookAssessment = z.infer<typeof HookAssessmentSchema>;
export const HookAssessmentsSchema = z.object({ hooks: z.array(HookAssessmentSchema).length(3) }).strict();

/** Rank a complete score set; ties retain outline order after checking the last ten tactics. */
export function pickStoryHook(candidates: readonly HookCandidate[], assessments: readonly HookAssessment[], recentTactics: readonly HookTactic[]): HookCandidate {
  if (candidates.length !== 3 || new Set(candidates.map((hook) => hook.id)).size !== 3
    || assessments.length !== 3 || new Set(assessments.map((assessment) => assessment.hookId)).size !== 3) {
    throw new Error("Expected three distinct candidates and three distinct hook assessments.");
  }
  const totals = new Map(assessments.map((assessment) => {
    const parsed = HookAssessmentSchema.parse(assessment);
    return [parsed.hookId, Object.values(parsed.scores).reduce((sum, value) => sum + value, 0)];
  }));
  if (candidates.some((candidate) => !totals.has(candidate.id))) throw new Error("Hook assessments do not match candidate ids.");
  const recent = recentTactics.slice(-10);
  const used = (tactic: HookTactic) => recent.filter((value) => value === tactic).length;
  return [...candidates].sort((a, b) => totals.get(b.id)! - totals.get(a.id)! || used(a.tactic) - used(b.tactic))[0]!;
}
