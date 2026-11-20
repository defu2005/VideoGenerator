import { describe, expect, it } from "vitest";
import { FORMAT_RECIPES } from "../formats/recipes.js";
import { lintNarration, NARRATION_LINT_THRESHOLDS } from "./lint.js";
import {
  cleanScript,
  clicheScript,
  dateListScript,
  repeatedHookScript,
  templateOutroScript,
} from "./__fixtures__/scripts.js";

const recipe = FORMAT_RECIPES.story;
const codes = (findings: ReturnType<typeof lintNarration>) => findings.map((f) => f.code);

describe("lintNarration", () => {
  it("flags a section that lists dates", () => {
    const findings = lintNarration(dateListScript, recipe, "vi");
    const hit = findings.find((f) => f.code === "DATE_LIST");
    expect(hit).toMatchObject({ sectionId: "s1", severity: "fix" });
  });

  it("flags a thank-you / subscribe outro", () => {
    const findings = lintNarration(templateOutroScript, recipe, "vi");
    expect(findings.find((f) => f.code === "TEMPLATE_OUTRO")).toMatchObject({ sectionId: "outro", severity: "fix" });

    // English outro with comparison "like" must not be flagged
    const comparisonScript = {
      ...cleanScript,
      outro: "In the end, it looks like the wall was never one wall, but dozens of independent barriers built centuries apart.",
    };
    expect(codes(lintNarration(comparisonScript, recipe, "en"))).not.toContain("TEMPLATE_OUTRO");

    // English outro asking for like & share must be flagged
    const callToActionScript = {
      ...cleanScript,
      outro: "If you enjoyed this deep dive, like and share this video with a friend who loves history.",
    };
    expect(codes(lintNarration(callToActionScript, recipe, "en"))).toContain("TEMPLATE_OUTRO");
  });

  it("flags clichés per language", () => {
    expect(codes(lintNarration(clicheScript, recipe, "vi"))).toContain("CLICHE");
    const en = { ...cleanScript, outro: "A testament to courage, and a tapestry of loss." };
    const hits = lintNarration(en, recipe, "en").filter((f) => f.code === "CLICHE");
    expect(hits.length).toBe(2);
    // English list is not applied to a Vietnamese script
    expect(codes(lintNarration(en, recipe, "vi"))).not.toContain("CLICHE");
  });

  it("flags a repeated hook in section 1", () => {
    const findings = lintNarration(repeatedHookScript, recipe, "vi");
    expect(findings.find((f) => f.code === "HOOK_REPEATED")).toMatchObject({ sectionId: "s1", severity: "fix" });
  });

  it("gives no findings for a clean hand-written script", () => {
    expect(lintNarration(cleanScript, recipe, "vi")).toEqual([]);
  });

  it("flags flat rhythm and long sentences", () => {
    const flat = {
      ...cleanScript,
      sections: [{
        ...cleanScript.sections[0]!,
        narration: "Anh đi qua cổng rồi. Anh nhìn lên bầu trời. Anh thấy ánh sao sáng. Anh nghe gió thổi mạnh.",
      }],
    };
    expect(codes(lintNarration(flat, recipe, "vi"))).toContain("FLAT_RHYTHM");
    const long = { ...flat, sections: [{ ...flat.sections[0]!, narration: Array(recipe.script.sentenceMaxWords * 2).fill("từ").join(" ") + "." }] };
    expect(lintNarration(long, recipe, "vi").find((f) => f.code === "LONG_SENTENCE")?.severity).toBe("fix");
  });

  it("warns when the hook question has no payoff in the outro", () => {
    const findings = lintNarration(repeatedHookScript, recipe, "vi");
    expect(findings.find((f) => f.code === "NO_QUESTION_PAYOFF")?.severity).toBe("warn");
  });

  it("exposes tunable thresholds", () => {
    expect(NARRATION_LINT_THRESHOLDS.dateStartRatio).toBe(0.4);
    expect(NARRATION_LINT_THRESHOLDS.flatRhythmCv).toBe(0.25);
  });
});
