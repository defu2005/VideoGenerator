import { z } from "zod";

/** Quality repair vocabulary (TASK-121). Pure data and pure ordering, no I/O. */
export const REPAIR_GATES = ["SCRIPT", "VISUALS", "RENDER"] as const;
export type RepairGate = (typeof REPAIR_GATES)[number];

export const REPAIR_ACTIONS = [
  "revise_script",
  "revise_script_stronger_model",
  "rerun_research_then_script",
  "new_angle",
  "vision_recheck",
  "pick_next_candidate",
  "research_scene",
  "web_search_scene",
  "rephrase_scene_visual",
  "switch_shot_type",
  "rerun_voice",
  "rerun_music",
  "rerun_subtitle",
  "rebuild_timeline",
  "revise_script_target_length",
  "rerender",
] as const;
export const RepairActionKindSchema = z.enum(REPAIR_ACTIONS);
export type RepairActionKind = z.infer<typeof RepairActionKindSchema>;

export const REPAIR_ISSUE_KINDS = [
  "script_score", "script_facts", "script_guideline",
  "scene_vision_reject", "scene_vision_missing", "scene_low_relevance", "scene_source_risk",
  "audio_silent", "subtitle_sync", "freeze", "black", "duration_long", "duration_short", "file_missing",
] as const;
export type RepairIssueKind = (typeof REPAIR_ISSUE_KINDS)[number];

export type RepairIssue = {
  gate: RepairGate;
  kind: RepairIssueKind;
  sceneIds?: string[];
  /** Short Vietnamese text for the log and the digest. */
  detail: string;
  /** Allowed actions for this issue, cheapest first. */
  actions: RepairActionKind[];
};

/** Actions that end with a re-render. They count against the render budget. */
export const RENDER_ACTIONS: ReadonlySet<RepairActionKind> = new Set([
  "rerun_voice", "rerun_music", "rerun_subtitle", "rebuild_timeline", "revise_script_target_length", "rerender",
]);

const SCENE_LADDER: RepairActionKind[] = [
  "pick_next_candidate", "research_scene", "web_search_scene", "rephrase_scene_visual", "switch_shot_type",
];

/** Default ladder per issue. It never includes an action the guide does not allow for that issue. */
export const REPAIR_LADDERS: Record<RepairIssueKind, RepairActionKind[]> = {
  script_score: ["revise_script", "revise_script_stronger_model", "new_angle"],
  script_facts: ["revise_script", "rerun_research_then_script", "revise_script_stronger_model", "new_angle"],
  script_guideline: ["revise_script", "revise_script_stronger_model", "new_angle"],
  scene_vision_reject: SCENE_LADDER,
  scene_vision_missing: ["vision_recheck", ...SCENE_LADDER],
  scene_low_relevance: SCENE_LADDER,
  // Licence and watermark rules are never relaxed: no web search that could add another unverified find.
  scene_source_risk: ["pick_next_candidate", "research_scene", "rephrase_scene_visual", "switch_shot_type"],
  audio_silent: ["rerun_voice", "rerun_music"],
  subtitle_sync: ["rerun_subtitle"],
  freeze: SCENE_LADDER,
  black: SCENE_LADDER,
  duration_long: ["rebuild_timeline", "revise_script_target_length"],
  duration_short: ["rebuild_timeline", "revise_script_target_length"],
  file_missing: ["rerender"],
};

export function repairActionsFor(
  kind: RepairIssueKind,
  options: { hasPassingCandidate?: boolean; webAllowed?: boolean } = {},
): RepairActionKind[] {
  return REPAIR_LADDERS[kind].filter((action) => {
    if (action === "pick_next_candidate") return options.hasPassingCandidate === true;
    if (action === "web_search_scene") return options.webAllowed === true;
    return true;
  });
}

export type RepairStat = { tries: number; passed: number };
export type RepairStatsByIssue = Partial<Record<RepairIssueKind, Partial<Record<RepairActionKind, RepairStat>>>>;

/** An action that passed at least 60% over at least 5 tries moves to the front for that issue. */
export function orderRepairLadder(
  kind: RepairIssueKind,
  actions: readonly RepairActionKind[],
  stats: RepairStatsByIssue = {},
): RepairActionKind[] {
  const per = stats[kind] ?? {};
  const proven = actions.filter((action) => {
    const stat = per[action];
    return stat !== undefined && stat.tries >= 5 && stat.passed / stat.tries >= 0.6;
  });
  proven.sort((a, b) => (per[b]!.passed / per[b]!.tries) - (per[a]!.passed / per[a]!.tries));
  return [...proven, ...actions.filter((action) => !proven.includes(action))];
}

/** First allowed action not yet tried for this issue. Null means the ladder is used up. */
export function nextLadderAction(
  kind: RepairIssueKind,
  actions: readonly RepairActionKind[],
  tried: readonly RepairActionKind[],
  stats: RepairStatsByIssue = {},
): RepairActionKind | null {
  return orderRepairLadder(kind, actions, stats).find((action) => !tried.includes(action)) ?? null;
}

/** What the agent may answer. Code rejects any action that is not in the issue's list. */
export const RepairChoiceSchema = z.object({
  choices: z.array(z.object({
    issueIndex: z.number().int().min(0),
    action: RepairActionKindSchema,
    reason: z.string().max(200).optional(),
  }).strict()).max(20),
}).strict();
export type RepairChoice = z.infer<typeof RepairChoiceSchema>;
