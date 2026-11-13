import { ASSISTANT_TOOLS } from "../assistant/tools.js";
import { loadRepoSkills } from "./repoSkills.js";
import { scoreCandidates, type RouteCandidate } from "./routing.js";
import { OPERATOR_SKILLS, parseSkillMarkdown, skillShortBody } from "./skills.js";
import { repoRoot } from "./workspace.js";

/**
 * A skill counts as picked when it is in the top 3 and either clears this score or
 * matched a trigger without an anti-trigger. Token noise from an off-topic prompt
 * scores about 0.5, so it does not count.
 */
const PICK_THRESHOLD = 0.6;
const PICK_LIMIT = 3;
export const SKILL_EVAL_MIN_SCORE = 80;

export type SkillScenario = { id: string; prompt: string; expect: "pick" | "skip" };
export type SkillEvalResult = {
  score: number;
  scenarios: Array<SkillScenario & { ok: boolean; rank: number | null }>;
};

/** Prompts that no skill should be picked for. Every skill is checked against them. */
export const OFF_TOPIC_SCENARIOS: SkillScenario[] = [
  { id: "off-topic-weather", prompt: "Hôm nay thời tiết Hà Nội thế nào", expect: "skip" },
  { id: "off-topic-joke", prompt: "Kể cho tôi một câu chuyện cười", expect: "skip" },
  { id: "off-topic-math", prompt: "Tính giúp 17 nhân 23", expect: "skip" },
];

export function skillScenarios(markdown: string): SkillScenario[] {
  const parsed = parseSkillMarkdown(markdown);
  if (!parsed) return [];
  return [
    ...parsed.triggers.slice(0, 6).map((trigger, index) => ({
      id: `trigger-${index}`, prompt: `Giúp tôi ${trigger}`, expect: "pick" as const,
    })),
    ...parsed.antiTriggers.slice(0, 4).map((anti, index) => ({
      id: `anti-${index}`, prompt: anti, expect: "skip" as const,
    })),
    ...OFF_TOPIC_SCENARIOS,
  ];
}

function builtinCandidates(): RouteCandidate[] {
  const repo = loadRepoSkills({
    root: repoRoot(),
    toolNames: new Set(Object.keys(ASSISTANT_TOOLS)),
    builtinNames: new Set(OPERATOR_SKILLS.map((skill) => skill.name)),
  }).skills.map((skill) => ({
    id: `repo:${skill.name}`, name: skill.name, description: skill.description,
    body: skill.longNotes.join("\n"), triggers: skill.triggers,
    antiTriggers: skill.antiTriggers, area: skill.area, shortBody: skill.shortSteps.join("\n"),
  }));
  return [
    ...OPERATOR_SKILLS.map((skill) => ({
      id: `builtin:${skill.name}`, name: skill.name, description: skill.description,
      body: [...skill.shortSteps, ...skill.longNotes].join("\n"), triggers: skill.triggers,
      antiTriggers: skill.antiTriggers, area: skill.area, shortBody: skillShortBody(skill),
    })),
    ...repo,
  ];
}

/**
 * Runs the skill's scenarios through the same router find_skills uses, next to the
 * built-in skills. Score is the share of scenarios that route as expected (0..100).
 */
export function evaluateSkill(markdown: string): SkillEvalResult {
  const parsed = parseSkillMarkdown(markdown);
  if (!parsed) return { score: 0, scenarios: [] };
  const self: RouteCandidate = {
    id: "candidate", name: parsed.name, description: parsed.description, body: parsed.body,
    triggers: parsed.triggers, antiTriggers: parsed.antiTriggers, area: "user", shortBody: parsed.shortBody,
  };
  const peers = builtinCandidates().filter((peer) => peer.name !== parsed.name);
  const scenarios = skillScenarios(markdown).map((scenario) => {
    const hits = scoreCandidates(scenario.prompt, [self, ...peers]);
    const index = hits.findIndex((hit) => hit.id === "candidate");
    const hit = index >= 0 && index < PICK_LIMIT ? hits[index] : undefined;
    const picked = Boolean(hit && (hit.score >= PICK_THRESHOLD || (hit.breakdown.trigger === 1 && hit.breakdown.anti === 0)));
    return { ...scenario, rank: index >= 0 ? index + 1 : null, ok: scenario.expect === "pick" ? picked : !picked };
  });
  const passed = scenarios.filter((item) => item.ok).length;
  return { score: scenarios.length ? Math.round((passed / scenarios.length) * 100) : 0, scenarios };
}
