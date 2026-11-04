import { describe, expect, it } from "vitest";
import {
  BUILT_IN_GUIDELINE_PACKS,
  GuidelinePackSchema,
  PROJECT_RULES_PACK_ID,
  activeGuidelines,
  checkScriptGuidelines,
  checkTimelineGuidelines,
  findBlockedWords,
  guidelinePromptBlock,
  suggestGuidelinePacks,
  type GuidelinePack,
  type Script,
  type Timeline,
} from "../src/index.js";

const baseSettings = {
  platform: "youtube" as const,
  style: "storytelling" as const,
  tone: "neutral" as const,
  audience: "general" as const,
  budget: { mode: "BALANCED" as const },
  guidelines: { platformPack: "auto", customRules: [] as string[] },
};

function project(settings: typeof baseSettings) {
  return { settings };
}

describe("content guideline packs", () => {
  it("parses every built-in pack and keeps rule ids unique", () => {
    for (const pack of BUILT_IN_GUIDELINE_PACKS) {
      expect(GuidelinePackSchema.parse(pack)).toEqual(pack);
      expect(new Set(pack.rules.map((rule) => rule.id)).size).toBe(pack.rules.length);
    }
  });

  it("suggests channel packs from audience, style and tone", () => {
    expect(suggestGuidelinePacks({ audience: "kids", style: "storytelling", tone: "dramatic" })).toEqual(["kids", "storytelling", "drama"]);
    expect(suggestGuidelinePacks({ audience: "general", style: "news", tone: "dramatic" })).toEqual(["news"]);
    expect(suggestGuidelinePacks({ audience: "kids", style: "listicle", tone: "dramatic" }).length).toBeLessThanOrEqual(3);
  });

  it("resolves active packs, overrides and merged limits", () => {
    const auto = activeGuidelines(project({ ...baseSettings, platform: "youtube_shorts", tone: "dramatic" }));
    expect(auto.packs.map((pack) => pack.id)).toEqual(["youtube_shorts", "storytelling", "drama"]);
    expect(activeGuidelines(project({ ...baseSettings, platform: "custom" })).packs.map((pack) => pack.id)).toEqual(["storytelling"]);

    const customYoutube: GuidelinePack = {
      ...BUILT_IN_GUIDELINE_PACKS.find((pack) => pack.id === "youtube")!,
      name: "YouTube của tôi",
      params: { maxDurationSec: 90, hookWithinSec: 4 },
    };
    const overridden = activeGuidelines(project(baseSettings), [customYoutube]);
    expect(overridden.packs.find((pack) => pack.id === "youtube")?.name).toBe("YouTube của tôi");
    expect(overridden.params.maxDurationSec).toBe(90);

    const shorts = activeGuidelines(project({ ...baseSettings, platform: "youtube_shorts", guidelines: { platformPack: "auto", channelPacks: [], customRules: [] } }), [
      { ...BUILT_IN_GUIDELINE_PACKS.find((pack) => pack.id === "youtube_shorts")!, params: { maxDurationSec: 60, hookWithinSec: 2, aspectRatios: ["9:16"] } },
    ]);
    expect(shorts.params).toMatchObject({ maxDurationSec: 60, hookWithinSec: 2 });

    const withRules = activeGuidelines(project({
      ...baseSettings,
      guidelines: { platformPack: "auto", channelPacks: [], customRules: ["Không hé lộ kết quá sớm"] },
    }));
    expect(withRules.packs.at(-1)?.id).toBe(PROJECT_RULES_PACK_ID);
    expect(withRules.rules.at(-1)?.key).toBe("project.rule_1");
  });

  it("builds a prompt block only when a rule matches the target", () => {
    const active = activeGuidelines(project({
      ...baseSettings,
      platform: "custom",
      guidelines: { platformPack: "auto", channelPacks: ["storytelling"], customRules: [] },
    }));
    expect(guidelinePromptBlock(active, ["music"])).toBe("");
    expect(guidelinePromptBlock(active, ["script"])).toContain("(rule: storytelling.arc)");
  });

  it("checks script length, hook, blocked words and aspect ratio", () => {
    const active = activeGuidelines(project({
      ...baseSettings,
      platform: "youtube_shorts",
      guidelines: { platformPack: "auto", channelPacks: [], customRules: [] },
    }));
    expect(findBlockedWords("nói đéo được", ["đéo"])).toEqual(["đéo"]);
    expect(findBlockedWords("đéox", ["đéo"])).toEqual([]);
    const long = Array.from({ length: 500 }, (_, index) => `từ${index}`).join(" ");
    const script: Script = {
      title: "Shorts",
      hook: "Đây là một câu mở đầu rất dài với nhiều từ để vượt quá ba giây đọc.",
      sections: [{
        id: "opening",
        heading: "Mở",
        narration: `${long} đéo`,
        visualQueries: { primary: "city", alternatives: [] },
        visualNotes: "",
        musicMood: "",
        energy: "medium",
        estDurationSec: 0,
      }],
      outro: "Hết.",
      music: { mood: "", energy: "medium", keywords: [] },
    };
    const findings = checkScriptGuidelines(active, script, { wordsPerMinute: 150, aspectRatio: "16:9" });
    expect(findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining([
      "youtube_shorts.max_duration",
      "youtube_shorts.hook",
      "youtube_shorts.vertical",
      "youtube_shorts.profanity",
    ]));
    expect(findings.find((finding) => finding.ruleId === "youtube_shorts.profanity")?.quote).toBe("đéo");
  });

  it("checks timeline duration, risky visual licenses and music", () => {
    const active = activeGuidelines(project({
      ...baseSettings,
      platform: "youtube_shorts",
      guidelines: { platformPack: "auto", channelPacks: [], customRules: [] },
    }));
    const timeline = {
      totalDurationSec: 240,
      scenes: [
        { sceneId: "scene-1", order: 0, visuals: [{ licenseKind: "UNKNOWN" }, { licenseKind: "CC_BY_NC" }, { licenseKind: "CC0" }] },
      ],
      music: { licenseKind: "CC_BY_NC" },
    } as unknown as Timeline;
    const findings = checkTimelineGuidelines(active, timeline, { aspectRatio: "16:9" });
    expect(findings.map((finding) => finding.text).join("\n")).toContain("240");
    expect(findings.some((finding) => finding.sceneId === "scene-1" && finding.text.includes("UNKNOWN"))).toBe(true);
    expect(findings.some((finding) => finding.sceneId === null && finding.text.includes("CC_BY_NC"))).toBe(true);
  });
});
