import type { AspectRatio } from "../enums.js";
import type { ProjectSettings } from "../schemas/project.js";
import { builtInGuidelinePack } from "./packs.js";
import { marketName, marketPack, type MarketPack } from "../markets/index.js";
import type {
  GuidelinePack,
  GuidelinePackParams,
  GuidelineRule,
  GuidelineSeverity,
  GuidelineStrictness,
  GuidelineTarget,
} from "./schema.js";

type GuidelineProject = {
  settings: Pick<ProjectSettings, "platform" | "style" | "tone" | "audience" | "budget" | "market"> & {
    guidelines?: ProjectSettings["guidelines"];
  };
};

export type ActiveGuidelineRule = GuidelineRule & { packId: string; packName: string; key: string };

export type ActiveGuidelines = {
  packs: GuidelinePack[];
  rules: ActiveGuidelineRule[];
  strictness: GuidelineStrictness;
  params: GuidelinePackParams;
};

export const PROJECT_RULES_PACK_ID = "project";
const SEVERITY_ORDER: Record<GuidelineSeverity, number> = { MUST: 0, SHOULD: 1, TIP: 2 };

/** Channel packs that fit a brief's style, tone and audience (at most 3). */
export function suggestGuidelinePacks(settings: Pick<ProjectSettings, "style" | "tone" | "audience">, lookup = builtInGuidelinePack): string[] {
  const ids: string[] = [];
  if (settings.audience === "kids") ids.push("kids");
  ids.push(settings.style);
  if (settings.tone === "dramatic" && settings.style !== "news") ids.push("drama");
  return [...new Set(ids)].filter((id) => lookup(id)?.kind === "CHANNEL").slice(0, 3);
}

/** FILTER from BALANCED up, REMIND in ECO, unless the project chose. */
export function resolveGuidelineStrictness(project: GuidelineProject): GuidelineStrictness {
  return project.settings.guidelines?.strictness
    ?? ((project.settings.budget?.mode ?? "BALANCED") === "ECO" ? "REMIND" : "FILTER");
}

export function platformGuidelinePackId(project: GuidelineProject): string | null {
  const choice = project.settings.guidelines?.platformPack ?? "auto";
  if (choice === "auto") return project.settings.platform === "custom" ? null : project.settings.platform;
  return choice;
}

export function channelGuidelinePackIds(project: GuidelineProject, lookup = builtInGuidelinePack): string[] {
  return project.settings.guidelines?.channelPacks ?? suggestGuidelinePacks(project.settings, lookup);
}

/** The packs, rules and limits that apply to a project. User packs win over built-in packs with the same id. */
export function activeGuidelines(
  project: GuidelineProject, userPacks: readonly GuidelinePack[] = [],
  builtIn = builtInGuidelinePack, lookupMarket: (code: string) => MarketPack | null = marketPack,
): ActiveGuidelines {
  const lookup = (id: string) => userPacks.find((pack) => pack.id === id) ?? builtIn(id);
  const platformId = platformGuidelinePackId(project);
  const code = project.settings.market;
  const marketId = code ? `market:${code}` : null;
  const ids = [...new Set([platformId, marketId, ...channelGuidelinePackIds(project, lookup)])];
  const packs = ids.flatMap((id) => {
    if (!id) return [];
    const pack = lookup(id);
    if (pack) return [pack];
    const market = id === marketId && code ? lookupMarket(code) : null;
    if (!market) return [];
    return [{
      id, kind: "MARKET", name: marketName(market), description: "", reviewedAt: market.checkedAt,
      sourceUrls: [...new Set(market.rules.map((rule) => rule.source))].slice(0, 10),
      rules: market.rules.map(({ source: _source, ...rule }) => rule),
    } satisfies GuidelinePack];
  });
  const customRules = project.settings.guidelines?.customRules ?? [];
  if (customRules.length) {
    packs.push({
      id: PROJECT_RULES_PACK_ID,
      kind: "CUSTOM",
      name: "Quy tắc riêng của dự án",
      description: "",
      reviewedAt: new Date(0).toISOString().slice(0, 10),
      sourceUrls: [],
      rules: customRules.map((text, index) => ({
        id: `rule_${index + 1}`,
        text,
        severity: "SHOULD",
        appliesTo: ["script", "visuals", "music", "subtitles", "metadata"],
      })),
    });
  }
  const rules = packs.flatMap((pack) => pack.rules.map((rule) => ({
    ...rule,
    packId: pack.id,
    packName: pack.name,
    key: `${pack.id}.${rule.id}`,
  })));
  return { packs, rules, strictness: resolveGuidelineStrictness(project), params: mergeParams(packs) };
}

function mergeParams(packs: GuidelinePack[]): GuidelinePackParams {
  const params: GuidelinePackParams = {};
  for (const pack of packs) {
    const own = pack.params;
    if (!own) continue;
    if (own.maxDurationSec !== undefined) params.maxDurationSec = Math.min(params.maxDurationSec ?? Infinity, own.maxDurationSec);
    if (own.hookWithinSec !== undefined) params.hookWithinSec = Math.min(params.hookWithinSec ?? Infinity, own.hookWithinSec);
    if (own.aspectRatios && !params.aspectRatios) params.aspectRatios = [...own.aspectRatios] as AspectRatio[];
  }
  return params;
}

export function guidelineRulesFor(active: ActiveGuidelines, targets: readonly GuidelineTarget[]): ActiveGuidelineRule[] {
  return active.rules
    .filter((rule) => rule.appliesTo.some((target) => targets.includes(target)))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * The prompt text for a set of targets, or "" when no rule applies.
 * Rule keys are included so a checker can cite them.
 */
export function guidelinePromptBlock(active: ActiveGuidelines, targets: readonly GuidelineTarget[], maxRules = 30): string {
  const rules = guidelineRulesFor(active, targets).slice(0, maxRules);
  if (!rules.length) return "";
  return [
    "Content guidelines for this video (summaries, not official policy). Follow MUST rules strictly, SHOULD rules where possible, TIP rules when they help:",
    ...rules.map((rule) => `- [${rule.severity}] ${rule.text} (rule: ${rule.key})`),
  ].join("\n");
}
