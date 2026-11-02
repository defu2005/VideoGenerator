import { describe, expect, it } from "vitest";
import { detectLanguage, recommendBrief } from "../src/index.js";

describe("recommendBrief", () => {
  it.each([
    ["Lịch sử trận đấu năm 2016", "vi"],
    ["The history of games in 2016", "en"],
  ])("detects language from %s", (topic, language) => {
    expect(detectLanguage(topic).language).toBe(language);
    expect(recommendBrief({ topic }).values.settings.language).toBe(language);
  });

  it.each([
    ["Lịch sử Việt Nam", "documentary", "lịch sử"],
    ["History of Rome", "documentary", "history"],
    ["Cách làm bánh mì", "explainer", "cách"],
    ["How to build a video", "explainer", "how to"],
    ["Vì sao bầu trời màu xanh", "explainer", "vì sao"],
    ["Tại sao mèo kêu meo meo", "explainer", "tại sao"],
    ["5 sự thật về mèo", "listicle", "5 su that"],
    ["Top 10 oceans", "listicle", "top 10"],
    ["Tin mới nhất", "news", "tin"],
    ["Latest news", "news", "news"],
    ["A quiet day", "storytelling", "No style keyword"],
  ] as const)("recommends %s as %s", (topic, style, keyword) => {
    const result = recommendBrief({ topic });
    expect(result.values.settings.style).toBe(style);
    expect(result.recommendations.style.reason).toContain(keyword);
  });

  it.each([
    ["youtube", "16:9", 180, 7, 42],
    ["youtube_shorts", "9:16", 50, 3, 18],
    ["tiktok", "9:16", 45, 3, 18],
    ["facebook_reels", "9:16", 45, 3, 42],
    ["custom", "16:9", 120, 6, 42],
  ] as const)("uses the %s platform preset", (platform, aspectRatio, duration, sceneDuration, subtitleChars) => {
    const result = recommendBrief({ topic: "A video", settings: { platform, userSet: ["platform"] } });
    expect(result.values.settings).toMatchObject({
      platform,
      aspectRatio,
      targetDurationSec: duration,
      sceneDurationSec: sceneDuration,
      subtitles: { enabled: true, maxCharsPerLine: subtitleChars },
    });
  });

  it("infers Shorts from a user-set vertical aspect ratio", () => {
    const result = recommendBrief({ topic: "A video", settings: { aspectRatio: "9:16" } });
    expect(result.values.settings.platform).toBe("youtube_shorts");
    expect(result.recommendations.aspectRatio.source).toBe("user");
  });

  it("keeps an out-of-range user duration and adds a warning", () => {
    const result = recommendBrief({ topic: "A video", settings: { platform: "tiktok", targetDurationSec: 200 } });
    expect(result.values.settings.targetDurationSec).toBe(200);
    expect(result.warnings).toEqual([
      "Duration 200s is outside the tiktok range (15-180s); the user value was kept.",
    ]);
  });

  it("protects user-set values but re-recommends reset fields", () => {
    const result = recommendBrief({
      topic: "How to make bread",
      settings: { style: "news", tone: "humorous", userSet: ["style"] },
    });
    expect(result.values.settings.style).toBe("news");
    expect(result.recommendations.style.source).toBe("user");
    expect(result.values.settings.tone).toBe("neutral");
    expect(result.recommendations.tone.source).toBe("recommended");
  });

  it("reduces speaking pace for kids", () => {
    const result = recommendBrief({ topic: "An educational video for trẻ em" });
    expect(result.values.settings.audience).toBe("kids");
    expect(result.values.settings.wordsPerMinute).toBe(145);
  });

  it("derives a title at a word boundary", () => {
    const topic = `${"A very long topic word ".repeat(8)}ending`;
    const result = recommendBrief({ topic });
    expect(result.values.title.length).toBeLessThanOrEqual(80);
    expect(result.values.title).toBe(result.values.title.trim());
    expect(topic.toLocaleLowerCase().startsWith(result.values.title.toLocaleLowerCase())).toBe(true);
    expect(topic[result.values.title.length]).toBe(" ");
  });
});
