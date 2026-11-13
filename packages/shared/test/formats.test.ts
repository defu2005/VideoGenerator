import { describe, expect, it } from "vitest";
import { FORMAT_RECIPES, FormatRecipeSchema, fallbackFormat, fallbackGraphics, missingRequiredSections, buildTreatment } from "../src/index.js";

describe("format recipes", () => {
  it("parses every starter recipe and keeps section shares near 1", () => {
    for (const recipe of Object.values(FORMAT_RECIPES)) {
      expect(FormatRecipeSchema.parse(recipe).id).toBe(recipe.id);
      const share = recipe.script.structure.reduce((sum, section) => sum + section.shareOfDuration, 0);
      expect(Math.abs(share - 1)).toBeLessThanOrEqual(0.01);
    }
  });

  it("picks short, listicle, then explainer", () => {
    expect(fallbackFormat({ topic: "hố đen", aspectRatio: "9:16", targetDurationSec: 30 }).id).toBe("short_hook");
    expect(fallbackFormat({ topic: "5 điều về hố đen", aspectRatio: "16:9", targetDurationSec: 120 }).id).toBe("listicle");
    expect(fallbackFormat({ topic: "hố đen", aspectRatio: "16:9", targetDurationSec: 120 }).id).toBe("explainer");
  });

  it("names a missing required section and still accepts an old script", () => {
    const recipe = FORMAT_RECIPES.explainer;
    expect(missingRequiredSections(recipe, ["hook", "point"])).toContain("context");
    expect(missingRequiredSections(recipe, [undefined, undefined])).toEqual(recipe.script.structure.filter((s) => s.required).map((s) => s.key));
  });

  it("builds a treatment from a fixture script", () => {
    const card = buildTreatment({
      title: "Hố đen",
      recipe: FORMAT_RECIPES.explainer,
      hook: "Hố đen nuốt ánh sáng.",
      sections: [
        { key: "hook", heading: "Mở", estDurationSec: 8 },
        { key: "point", heading: "Ý", estDurationSec: 40 },
      ],
      cost: { inputTokens: 1000, outputTokens: 400, ttsCharacters: 800, usd: null },
    });
    expect(card.formatNameVi).toBe("Giải thích");
    expect(card.estimatedDurationSec).toBe(48);
    expect(card.renderNoteVi).toBe("chưa có dữ liệu");
    expect(card.cost.usd).toBeNull();
  });

  it("puts list_item on listicle item sections", () => {
    const graphics = fallbackGraphics({
      title: "5 điều",
      aspect: "16:9",
      totalDurationSec: 40,
      preset: "energetic",
      settings: { enabled: true },
      recipe: FORMAT_RECIPES.listicle,
      scenes: [{
        sceneId: "s1",
        startSec: 0,
        durationSec: 8,
        label: "Mục một",
        sectionKey: "item",
        placeholder: true,
      }],
    });
    expect(graphics.some((graphic) => graphic.templateId === "list_item")).toBe(true);
  });
});
