import { describe, expect, it } from "vitest";
import {
  MusicAssistOutputSchema,
  VideoMetadataDraftSchema,
  buildChapters,
  buildMetadataText,
  cleanupTagsAndHashtags,
  codeMetadataDraft,
  formatChapterTime,
  normalizeMetadataDraft,
} from "../src/index.js";

describe("metadata schemas", () => {
  it("accepts a valid music assist payload", () => {
    expect(MusicAssistOutputSchema.parse({
      mood: "calm reflective",
      energy: "low",
      queries: ["calm piano ambient"],
      avoid: ["vocals"],
      why: "Matches the tone.",
    }).queries).toHaveLength(1);
  });

  it("accepts a valid video metadata draft", () => {
    const draft = VideoMetadataDraftSchema.parse({
      titles: ["One", "Two", "Three"],
      description: "A short description",
      tags: ["history"],
      hashtags: ["#history"],
      thumbnailText: ["Fact", "Story"],
    });
    expect(draft.titles).toHaveLength(3);
  });
});

describe("buildChapters", () => {
  const sections = [
    { id: "a", heading: "Opening" },
    { id: "b", heading: "Middle" },
    { id: "c", heading: "Close" },
  ];

  it("returns no chapters for videos under 60 seconds", () => {
    expect(buildChapters({
      totalDurationSec: 45,
      scenes: [
        { startSec: 0, endSec: 15, label: "A" },
        { startSec: 15, endSec: 30, label: "B" },
        { startSec: 30, endSec: 45, label: "C" },
      ],
    }, sections)).toEqual([]);
  });

  it("returns no chapters when there are fewer than 3 sections", () => {
    expect(buildChapters({
      totalDurationSec: 120,
      scenes: [
        { startSec: 0, endSec: 40, label: "A" },
        { startSec: 40, endSec: 120, label: "B" },
      ],
    }, [{ heading: "Only two" }, { heading: "Sections" }])).toEqual([]);
  });

  it("starts at 00:00 and merges short chapters", () => {
    const chapters = buildChapters({
      totalDurationSec: 120,
      scenes: [
        { startSec: 2, endSec: 20, label: "Hook" },
        { startSec: 20, endSec: 25, label: "Tiny" },
        { startSec: 25, endSec: 70, label: "Body" },
        { startSec: 70, endSec: 120, label: "End" },
      ],
    }, sections);
    expect(chapters[0]).toMatchObject({ startSec: 0, text: "00:00 Hook" });
    expect(chapters.map((chapter) => chapter.label)).toEqual(["Hook", "Body", "End"]);
    expect(chapters.every((chapter, index, list) => {
      const next = list[index + 1];
      return !next || next.startSec - chapter.startSec >= 10;
    })).toBe(true);
  });

  it("formats times with hours when needed", () => {
    expect(formatChapterTime(3661)).toBe("1:01:01");
    expect(formatChapterTime(75)).toBe("01:15");
  });
});

describe("tag and hashtag cleanup", () => {
  it("strips hashes from tags, adds them to hashtags, and dedupes", () => {
    expect(cleanupTagsAndHashtags({
      tags: [" #History ", "history", "AI", ""],
      hashtags: ["history", "#AI", "  ##Facts  ", ""],
    })).toEqual({
      tags: ["History", "AI"],
      hashtags: ["#history", "#AI", "#Facts"],
    });
  });

  it("normalizes a draft and builds a code fallback", () => {
    expect(normalizeMetadataDraft({
      titles: ["  A very long title that should be trimmed carefully because youtube caps titles around one hundred characters total!!  "],
      description: "x".repeat(2000),
      tags: ["#One", "one", ""],
      hashtags: ["two"],
      thumbnailText: ["A", "", "B", "C"],
    })).toMatchObject({
      titles: [expect.stringMatching(/^A very long title/)],
      tags: ["One"],
      hashtags: ["#two"],
      thumbnailText: ["A", "B"],
    });
    expect(codeMetadataDraft({
      title: "Script title",
      hook: "The hook",
      keywords: ["space", "science"],
    })).toEqual({
      titles: ["Script title"],
      description: "The hook",
      tags: ["space", "science"],
      hashtags: [],
      thumbnailText: [],
    });
  });
});

describe("buildMetadataText", () => {
  it("includes titles, composed description, tags, hashtags and AI disclosure", () => {
    const text = buildMetadataText({
      titles: ["Ocean story", "Calm sea"],
      description: "A calm sea at dawn.",
      tags: ["ocean", "nature"],
      hashtags: ["#ocean"],
      chaptersText: "0:00 Opening",
      creditsText: "Photo by Alice",
      disclosure: "Video có sử dụng giọng đọc tổng hợp và nội dung do AI hỗ trợ.",
    });
    expect(text).toContain("Ocean story");
    expect(text).toContain("A calm sea at dawn.");
    expect(text).toContain("0:00 Opening");
    expect(text).toContain("Photo by Alice");
    expect(text).toContain("ocean, nature");
    expect(text).toContain("#ocean");
    expect(text).toContain("Video có sử dụng giọng đọc tổng hợp và nội dung do AI hỗ trợ.");
  });
});
