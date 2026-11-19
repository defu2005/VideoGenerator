import { describe, expect, it } from "vitest";
import {
  areSentencesEqual,
  checkNeighbouringSceneDuplicates,
  dedupeSeams,
  getSeamDrops,
  getSeamReports,
  normalizeSentence,
  tokenJaccard,
} from "../src/scenes/dedupeSeams.js";
import { planScenes } from "../src/scenes/planScenes.js";
import type { Script } from "../src/schemas/script.js";

function makeScript(overrides: Partial<Script> = {}): Script {
  return {
    title: "Video thử nghiệm",
    hook: "Liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài?",
    sections: [
      {
        id: "sec-1",
        heading: "Phần một",
        narration:
          "Liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài? Berserk chính là câu trả lời nghiệt ngã nhưng bi tráng nhất.",
        visualQueries: { primary: "guts swordsman", alternatives: [] },
        visualNotes: "",
        musicMood: "dramatic",
        energy: "high",
        estDurationSec: 10,
      },
      {
        id: "sec-2",
        heading: "Phần hai",
        narration: "Hành trình của Guts là biểu tượng bất diệt cho ý chí con người. Đó là bài học sâu sắc nhất.",
        visualQueries: { primary: "dark fantasy eclipse", alternatives: [] },
        visualNotes: "",
        musicMood: "epic",
        energy: "high",
        estDurationSec: 10,
      },
    ],
    outro: "Đó là bài học sâu sắc nhất. Cảm ơn các bạn đã theo dõi video.",
    music: { mood: "epic", energy: "high", keywords: [] },
    ...overrides,
  };
}

describe("TASK-130 seam deduplication", () => {
  describe("normalization & sentence matching", () => {
    it("normalizes text with NFC, lower case, collapsing whitespace, and stripping punctuation/quotes", () => {
      const raw = "  “Liệu  MỘT   phàm nhân... có thể?!”  ";
      expect(normalizeSentence(raw)).toBe("liệu một phàm nhân có thể");
    });

    it("hook repeated with different punctuation, quotes or casing → dropped", () => {
      const a = "“Liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài?!”";
      const b = "liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài.";
      expect(areSentencesEqual(a, b)).toBe(true);
    });

    it("near-duplicate (Jaccard ≥ 0.9, ≥ 6 words) → dropped; a short 3-word repeat → kept", () => {
      // 12 words vs 11 words (1 word omitted), intersection = 10, union = 11, Jaccard = 10/11 = 0.909 >= 0.9
      const sentenceA = "Đây là một câu chuyện rất kỳ lạ về một thế giới xa xôi.";
      const sentenceB = "Đây là một câu chuyện rất kỳ lạ về thế giới xa xôi.";
      expect(areSentencesEqual(sentenceA, sentenceB)).toBe(true);

      // Short 3-word near-duplicate (< 6 words) → not identical, so kept
      const shortA = "Liệu có thật";
      const shortB = "Liệu có đúng";
      expect(areSentencesEqual(shortA, shortB)).toBe(false);
    });
  });

  describe("dedupeSeams", () => {
    it("hook repeated as the first sentence of section 1 → dropped from section 1; the hook is kept", () => {
      const script = makeScript();
      const result = dedupeSeams(script, "vi");

      // Hook preserved
      expect(result.script.hook).toBe(script.hook);
      // First sentence dropped from section 1
      expect(result.script.sections[0]!.narration).toBe("Berserk chính là câu trả lời nghiệt ngã nhưng bi tráng nhất.");
      // Drop reported
      expect(result.dropped).toContainEqual({
        seam: "hook",
        sectionId: "sec-1",
        sentence: "Liệu một phàm nhân bằng xương bằng thịt có thể vung kiếm chém đứt xiềng xích của định mệnh đã an bài?",
      });
    });

    it("the outro repeats the last section's last sentence → dropped from the outro", () => {
      const script = makeScript({
        hook: "Mở đầu video.",
        sections: [
          {
            id: "sec-1",
            heading: "Phần cuối",
            narration: "Hành trình kết thúc tại đây. Đó là bài học sâu sắc nhất.",
            visualQueries: { primary: "ending", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
        ],
        outro: "Đó là bài học sâu sắc nhất. Cảm ơn các bạn đã theo dõi video.",
      });

      const result = dedupeSeams(script, "vi");
      expect(result.script.outro).toBe("Cảm ơn các bạn đã theo dõi video.");
      expect(result.script.sections[0]!.narration).toBe("Hành trình kết thúc tại đây. Đó là bài học sâu sắc nhất.");
      expect(result.dropped).toContainEqual({
        seam: "outro",
        sectionId: null,
        sentence: "Đó là bài học sâu sắc nhất.",
      });
    });

    it("section N+1 opens with section N's last sentence → dropped", () => {
      const script = makeScript({
        hook: "Hook độc lập hoàn toàn.",
        sections: [
          {
            id: "sec-1",
            heading: "Phần 1",
            narration: "Mở đầu phần một. Bí mật này đã bị chôn giấu suốt hàng nghìn năm qua.",
            visualQueries: { primary: "ancient", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
          {
            id: "sec-2",
            heading: "Phần 2",
            narration: "Bí mật này đã bị chôn giấu suốt hàng nghìn năm qua. Cho đến hôm nay chúng ta mới phát hiện ra nó.",
            visualQueries: { primary: "discovery", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
        ],
        outro: "Hẹn gặp lại các bạn.",
      });

      const result = dedupeSeams(script, "vi");
      expect(result.script.sections[0]!.narration).toBe("Mở đầu phần một. Bí mật này đã bị chôn giấu suốt hàng nghìn năm qua.");
      expect(result.script.sections[1]!.narration).toBe("Cho đến hôm nay chúng ta mới phát hiện ra nó.");
      expect(result.dropped).toContainEqual({
        seam: "section",
        sectionId: "sec-2",
        sentence: "Bí mật này đã bị chôn giấu suốt hàng nghìn năm qua.",
      });
    });

    it("a section made only of the repeated sentence → kept, and reported", () => {
      const script = makeScript({
        hook: "Câu hỏi mở đầu duy nhất.",
        sections: [
          {
            id: "sec-1",
            heading: "Phần chỉ có một câu trùng",
            narration: "Câu hỏi mở đầu duy nhất.",
            visualQueries: { primary: "question", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
          {
            id: "sec-2",
            heading: "Phần tiếp theo",
            narration: "Đây là phần nội dung bình thường tiếp tục video.",
            visualQueries: { primary: "next", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
        ],
        outro: "Hết video.",
      });

      const result = dedupeSeams(script, "vi");
      // Not dropped because that would empty section 1
      expect(result.script.sections[0]!.narration).toBe("Câu hỏi mở đầu duy nhất.");
      expect(result.dropped).toHaveLength(0);
      // But reported as kept
      const report = result.reports.find((r) => r.sectionId === "sec-1");
      expect(report).toBeDefined();
      expect(report?.action).toBe("kept");
      expect(report?.reason).toBe("would_empty_section");
    });

    it("helper getSeamDrops and getSeamReports expose drops and reports", () => {
      const script = makeScript();
      const drops = getSeamDrops(script, "vi");
      expect(drops.length).toBeGreaterThan(0);
      expect(drops.some((d) => d.seam === "hook")).toBe(true);

      const reports = getSeamReports(script, "vi");
      expect(reports.length).toBeGreaterThan(0);
    });
  });

  describe("planScenes integration", () => {
    it("no repeats → planScenes output unchanged", () => {
      const cleanScript = makeScript({
        hook: "Hook độc lập không lặp.",
        sections: [
          {
            id: "sec-1",
            heading: "P1",
            narration: "Nội dung phần một hoàn toàn mới và hấp dẫn.",
            visualQueries: { primary: "visual1", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
          {
            id: "sec-2",
            heading: "P2",
            narration: "Nội dung phần hai tiếp tục với một chủ đề khác.",
            visualQueries: { primary: "visual2", alternatives: [] },
            visualNotes: "",
            musicMood: "",
            energy: "medium",
            estDurationSec: 5,
          },
        ],
        outro: "Tạm biệt và hẹn gặp lại.",
      });

      const scenes = planScenes(cleanScript, {
        sceneDurationSec: 5,
        wordsPerMinute: 150,
        language: "vi",
      });

      expect(scenes.length).toBeGreaterThan(0);
      expect(scenes[0]!.kind).toBe("hook");
      expect(scenes[0]!.narration).toBe("Hook độc lập không lặp.");
      expect(scenes[1]!.kind).toBe("section");
      expect(scenes[1]!.narration).toContain("Nội dung phần một");
    });

    it("repeats in hook seam are automatically deduped in planScenes", () => {
      const scriptWithDupHook = makeScript();
      const scenes = planScenes(scriptWithDupHook, {
        sceneDurationSec: 30,
        wordsPerMinute: 150,
        language: "vi",
      });

      // Scene 0 is hook
      expect(scenes[0]!.kind).toBe("hook");
      expect(scenes[0]!.narration).toBe(scriptWithDupHook.hook);

      // Section 1 scenes no longer contain the hook sentence
      const sectionScenes = scenes.filter((s) => s.kind === "section");
      expect(sectionScenes[0]!.narration).toBe("Berserk chính là câu trả lời nghiệt ngã nhưng bi tráng nhất.");
    });
  });

  describe("pre-render check", () => {
    it("the pre-render check flags two neighbouring scenes with the same sentence, as a warning only", () => {
      const scenes = [
        {
          id: "scene-0",
          narration: "Liệu một phàm nhân có thể vung kiếm chém đứt định mệnh?",
          order: 0,
        },
        {
          id: "scene-1",
          narration: "Liệu một phàm nhân có thể vung kiếm chém đứt định mệnh? Berserk chính là câu trả lời.",
          order: 1,
        },
        {
          id: "scene-2",
          narration: "Hành trình không bao giờ dừng lại.",
          order: 2,
        },
      ];

      const warnings = checkNeighbouringSceneDuplicates(scenes, "vi");
      expect(warnings.length).toBe(1);
      expect(warnings[0]!.severity).toBe("WARN");
      expect(warnings[0]!.sceneId).toBe("scene-0");
      expect(warnings[0]!.nextSceneId).toBe("scene-1");
      expect(warnings[0]!.sentence).toContain("Liệu một phàm nhân");

      // Non-neighbouring scenes are clean
      const cleanScenes = [
        { id: "scene-0", narration: "Câu đầu tiên.", order: 0 },
        { id: "scene-1", narration: "Câu thứ hai khác biệt.", order: 1 },
      ];
      expect(checkNeighbouringSceneDuplicates(cleanScenes, "vi")).toHaveLength(0);
    });
  });
});
