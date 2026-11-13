import { describe, expect, it } from "vitest";
import { FORMAT_RECIPE_IDS, FORMAT_RECIPES } from "../formats/recipes.js";
import { directivesForRecipe, GENRE_PACKS, genreDirectives, genrePack, GenrePackSchema, genreRecipe } from "./genre.js";
import { layeredTokens } from "./resolve.js";

describe("built-in genre packs", () => {
  it("wrap every existing recipe without copying it", () => {
    for (const id of FORMAT_RECIPE_IDS) {
      const pack = genrePack(id)!;
      expect(pack.recipe).toEqual({ ref: id });
      expect(genreRecipe(pack)).toBe(FORMAT_RECIPES[id]);
      expect(pack.nameVi).toBe(FORMAT_RECIPES[id].nameVi);
      expect(genreDirectives(pack).pacing).toEqual({ preset: FORMAT_RECIPES[id].edit.rhythm, paceScale: 1 });
    }
  });

  it("carry the director rules that are hard-coded today", () => {
    // kinds070.ts mapPiece: only explainer and news_recap. listPiece: only listicle and how_to.
    // kinds070.ts comparePiece: myth_vs_fact compares without a contrast word.
    // rules.ts opening: listicle opens later scenes as a list; short_hook hooks every scene.
    for (const id of FORMAT_RECIPE_IDS) {
      const d = directivesForRecipe(id);
      expect(!d.disabledKinds.includes("map"), `${id} map`).toBe(id === "explainer" || id === "news_recap");
      expect(!d.disabledKinds.includes("list_full"), `${id} list`).toBe(id === "listicle" || id === "how_to");
      expect(d.forcedKinds.includes("compare"), `${id} compare`).toBe(id === "myth_vs_fact");
      expect(d.compareFallback, `${id} compare fallback`).toBe(id === "myth_vs_fact");
      expect(d.listOpening, `${id} list opening`).toBe(id === "listicle");
      expect(d.hookEveryScene, `${id} hook`).toBe(id === "short_hook");
      expect(d.templates.list_full).toEqual(["list_full"]);
      for (const kind of ["chart", "compare", "quote_full", "kinetic_text", "still", "footage"]) expect(d.disabledKinds).not.toContain(kind);
    }
  });
});

describe("a new genre is data", () => {
  it("ships top_facts with a mix no built-in recipe has", () => {
    const d = directivesForRecipe("top_facts");
    expect(d.genreId).toBe("top_facts");
    expect(d.listOpening).toBe(true);
    expect(d.compareFallback).toBe(true);
    expect(d.disabledKinds).toEqual([]);
    expect(GenrePackSchema.parse({ ...GENRE_PACKS.top_facts, director: { ...GENRE_PACKS.top_facts!.director, compareFallback: undefined } }).director.compareFallback).toBe(false);
  });

  it("ships three genres that reuse a recipe and differ only in data", () => {
    const history = genrePack("history")!;
    expect(genreRecipe(history)).toBe(FORMAT_RECIPES.story);
    const d = genreDirectives(history);
    expect(d.disabledKinds).toEqual(["list_full"]);
    expect(d.pacing).toEqual({ preset: "story", paceScale: 1.1 });
    expect(d.llmNotes).toHaveLength(1);
    expect(layeredTokens({ genre: history.style }).motion.ease).toBe("gentle");
    expect(genreDirectives(genrePack("travel")!).listOpening).toBe(true);
    expect(layeredTokens({ genre: genrePack("finance")!.style }).graphics.maxShare).toBe(0.4);
  });

  it("accepts a user pack with its own recipe and templates, and prefers it over a built-in", () => {
    const { id: _id, ...structure } = FORMAT_RECIPES.explainer;
    const pack = GenrePackSchema.parse({
      schema: 1,
      id: "science_short",
      nameVi: "Khoa học ngắn",
      descriptionVi: "Một hiện tượng, một lời giải thích, một thí nghiệm.",
      recipe: { inline: { ...structure, nameVi: "Khoa học ngắn" } },
      director: { opening: "hook_every", kinds: { chart: { templates: ["chart", "stat_tiles"] }, map: { enabled: false, force: true } } },
      style: { layout: { family: "poster" } },
    });
    expect(genreRecipe(pack).id).toBe("science_short");
    const d = genreDirectives(pack);
    expect(d.hookEveryScene).toBe(true);
    expect(d.templates.chart).toEqual(["chart", "stat_tiles"]);
    // A disabled kind is never forced.
    expect(d.forcedKinds).toEqual([]);
    expect(genrePack("science_short", { science_short: pack })).toBe(pack);
    expect(genrePack("explainer", { explainer: pack })).toBe(pack);
    expect(genrePack("science_short")).toBeNull();
    expect(genrePack(null)).toBeNull();
  });

  it("rejects a pack with a bad id, an unknown kind or an out-of-range style", () => {
    const base = { schema: 1, nameVi: "X", descriptionVi: "Y", recipe: { ref: "story" }, director: {} };
    expect(GenrePackSchema.safeParse({ ...base, id: "Bad Id" }).success).toBe(false);
    expect(GenrePackSchema.safeParse({ ...base, id: "ok", director: { kinds: { hologram: {} } } }).success).toBe(false);
    expect(GenrePackSchema.safeParse({ ...base, id: "ok", style: { motion: { speed: 5 } } }).success).toBe(false);
    expect(GenrePackSchema.safeParse({ ...base, id: "ok", recipe: { ref: "nope" } }).success).toBe(false);
    expect(GenrePackSchema.safeParse({ ...base, id: "ok" }).success).toBe(true);
  });

  it("every built-in pack parses and has a unique id", () => {
    expect(Object.keys(GENRE_PACKS)).toHaveLength(11);
    for (const [id, pack] of Object.entries(GENRE_PACKS)) expect(pack.id).toBe(id);
  });
});
