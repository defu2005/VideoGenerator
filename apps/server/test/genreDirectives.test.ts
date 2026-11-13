import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  directivesForRecipe,
  genreDirectives,
  getLangPack,
  GenrePackSchema,
  type ComposePlan,
  type KindSpan,
  type Shot,
  type VariantOptions,
} from "@vg/shared";
import type { DirectorInput } from "../src/compose/director.js";
import { buildDirectorPrompt, createLlmDirector, directByRules, variantChoicesFromAnswer } from "../src/compose/director/index.js";
import { graphicKindPiece } from "../src/compose/director/kinds070.js";
import { graphicVariantOptions, llmChoiceAnswers, prepareGraphicStyle } from "../src/compose/render/graphicStyle.js";
import { GENRE_IDS, hit, SCENES, speak } from "./helpers/genreFixtures.js";

/** TASK-112: the director reads genre directives, and the QUALITY LLM may choose among picker options. */

function inputsFor(recipe: string, directives?: DirectorInput["directives"]): DirectorInput[] {
  return SCENES.map((text, index) => {
    const spoken = speak(text);
    return {
      scene: { sceneId: `s${index}`, index, count: SCENES.length, text, durationSec: spoken.durationSec },
      words: spoken.words,
      recipeId: recipe,
      aspect: "16:9" as const,
      stills: [{ candidateId: `still-${index}`, path: `still-${index}.png` }],
      footage: Array.from({ length: 3 }, (_, i) => hit(`${index}-${i}`)),
      ...(directives ? { directives } : {}),
    };
  });
}

const reasons = (spans: KindSpan[][]) => spans.flat().map((span) => span.reason);
const count = (spans: KindSpan[][], kind: string) => spans.flat().filter((span) => span.kind === kind).length;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("the director never compares recipe ids", () => {
  it("has no recipeId === or !== under src/compose outside eval fixtures", () => {
    const root = join(__dirname, "..", "src", "compose");
    const hits = sourceFiles(root)
      .filter((file) => !file.includes(`${join("compose", "eval")}`))
      .filter((file) => /recipeId\s*(===|!==)/.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("a genre is data", () => {
  it("honours a brand-new pack with no code change", () => {
    const calm = GenrePackSchema.parse({
      schema: 1,
      id: "documentary_calm",
      nameVi: "Tài liệu trầm",
      descriptionVi: "Không bản đồ, không thẻ so sánh, không thẻ danh sách.",
      recipe: { ref: "story" },
      director: { kinds: { map: { enabled: false }, compare: { enabled: false }, list_full: { enabled: false } } },
      pacing: { preset: "story", paceScale: 1 },
      style: {},
    });
    const base = directByRules(inputsFor("explainer"));
    const own = directByRules(inputsFor("explainer", genreDirectives(calm)));
    expect(count(base, "map")).toBeGreaterThan(0);
    expect(count(base, "compare")).toBeGreaterThan(0);
    expect(count(own, "map")).toBe(0);
    expect(count(own, "compare")).toBe(0);
    expect(count(own, "list_full")).toBe(0);
  });

  it("top_facts (a shipped pack with no recipe of its own) changes the plan through its directives only", () => {
    const facts = directByRules(inputsFor("top_facts"));
    const explainer = directByRules(inputsFor("explainer"));
    expect(directivesForRecipe("top_facts").listOpening).toBe(true);
    expect(reasons(facts)).not.toEqual(reasons(explainer));
    expect(count(facts, "list_full")).toBeGreaterThan(count(explainer, "list_full"));
  });

  it("lists every built-in genre pack", () => {
    for (const id of GENRE_IDS) expect(directivesForRecipe(id).genreId).toBe(id);
  });
});

describe("compareFallback", () => {
  it("keeps the myth_vs_fact behaviour: a compare card without a compare cue", () => {
    const myth = directivesForRecipe("myth_vs_fact");
    expect(myth.compareFallback).toBe(true);
    const text = "Nhiều người tin uống nước lạnh gây bệnh nhưng thực ra không hề đúng như vậy.";
    const spoken = speak(text);
    const scene = (directives: DirectorInput["directives"]): DirectorInput => ({
      scene: { sceneId: "c1", index: 1, count: 4, text, durationSec: spoken.durationSec },
      words: spoken.words,
      recipeId: "myth_vs_fact",
      aspect: "16:9",
      stills: [],
      footage: [hit("a")],
      directives,
    });
    const lang = getLangPack("vi");
    expect(graphicKindPiece(scene(myth), lang)).toMatchObject({ kind: "compare", reason: "R8-compare", payload: { style: "myth_fact" } });
    expect(graphicKindPiece(scene({ ...myth, compareFallback: false }), lang)).toBeNull();
    expect(directivesForRecipe("explainer").compareFallback).toBe(false);
  });
});

describe("QUALITY variant choice inside the existing LLM call", () => {
  const options = (shots: { id: string; templateId: string }[]): VariantOptions[] => shots.map((shot) => ({
    shotId: shot.id,
    templateId: shot.templateId,
    options: ["x=1", "x=2", "x=3"].map((key) => ({ key, axes: { x: key.slice(2) } })),
  }));

  function run(answerFor: (graphicId: string) => string, withHook: boolean) {
    const prompts: string[] = [];
    const chosen: unknown[] = [];
    const director = createLlmDirector(async (prompt) => {
      prompts.push(prompt);
      const id = /"id":"([^"]+)"/.exec(prompt)?.[1] ?? "none";
      return answerFor(id);
    }, withHook ? { variants: { optionsFor: options, onChoices: (items) => chosen.push(...items) } } : {});
    return { director, prompts, chosen };
  }

  it("offers the options in the prompt and applies a valid letter", async () => {
    const { director, prompts, chosen } = run((id) => JSON.stringify({ scenes: [], variants: { [id]: "b" } }), true);
    await director.directScenes(inputsFor("explainer"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("variants");
    expect(prompts[0]).toContain("b:x=2");
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toMatchObject({ key: "x=2" });
  });

  it("ignores an invalid letter, an unknown shot and a missing field", async () => {
    for (const answer of [
      () => JSON.stringify({ scenes: [], variants: { "s0#0": "z", nowhere: "a" } }),
      () => JSON.stringify({ scenes: [], variants: { "s0#0": "x=9" } }),
      () => "[]",
      () => "not json",
    ]) {
      const { director, chosen } = run(answer, true);
      await director.directScenes(inputsFor("explainer"));
      expect(chosen).toEqual([]);
    }
  });

  it("choosing the rule pick records nothing", () => {
    const offered = options([{ id: "s1#0", templateId: "chart" }]);
    expect(variantChoicesFromAnswer(JSON.stringify({ variants: { "s1#0": "a" } }), offered)).toEqual([]);
    expect(variantChoicesFromAnswer(JSON.stringify({ variants: { "s1#0": "c" } }), offered)).toEqual([
      { sceneId: "s1", n: 0, templateId: "chart", key: "x=3" },
    ]);
  });

  it("ECO and BALANCED (no hook) add no variant field to the prompt and still call the LLM once", async () => {
    const { director, prompts } = run(() => "[]", false);
    await director.directScenes(inputsFor("explainer"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("variants");
    expect(prompts[0]).not.toContain("\"v\":");
    const inputs = inputsFor("explainer");
    expect(buildDirectorPrompt(inputs, directByRules(inputs))).toBe(prompts[0]);
  });

  it("puts the genre's llmNotes and its kind rules in the prompt", () => {
    const inputs = inputsFor("top_facts");
    const prompt = buildDirectorPrompt(inputs, directByRules(inputs));
    expect(prompt).toContain(directivesForRecipe("top_facts").llmNotes[0]!);
    const story = inputsFor("story");
    expect(buildDirectorPrompt(story, directByRules(story))).toContain("Do not use m");
  });
});

describe("applying the LLM's looks at render time", () => {
  const shot = (id: string): Shot => ({
    id,
    kind: "kinetic_text",
    startSec: 0,
    endSec: 3,
    source: { kind: "kinetic_text", lines: ["Xin chào"], emphasis: [], style: "bold" },
    reason: "R1",
  });
  const request = { projectId: "p1", profileId: "c1", recipeId: "explainer", width: 1920, height: 1080 };

  it("maps a choice to the nth graphic shot of its scene", () => {
    const plan = {
      scenes: [{ sceneId: "s1", shots: [shot("s1-0"), shot("s1-1")] }],
      llmVariantChoices: [{ sceneId: "s1", n: 1, templateId: "kinetic_text", key: "k" }, { sceneId: "s9", n: 0, templateId: "chart", key: "k" }],
    } as unknown as ComposePlan;
    expect(llmChoiceAnswers(plan)).toEqual({ "s1-1": "k" });
  });

  it("uses a valid choice and keeps the rule pick for an invalid one", () => {
    const shots = [shot("a"), shot("b")];
    const base = prepareGraphicStyle({ ...request, shots });
    const offered = graphicVariantOptions(request, shots.map((item) => ({ id: item.id, templateId: item.source.kind })));
    const alternative = offered[0]!.options.find((option) => option.key !== base.picks[0]!.key);
    expect(alternative).toBeDefined();
    const chosen = prepareGraphicStyle({ ...request, shots, llmChoices: { a: alternative!.key } });
    expect(chosen.picks[0]!.key).toBe(alternative!.key);
    const invalid = prepareGraphicStyle({ ...request, shots, llmChoices: { a: "no=such" } });
    expect(invalid.picks.map((pick) => pick.key)).toEqual(base.picks.map((pick) => pick.key));
    expect(prepareGraphicStyle({ ...request, shots, llmChoices: {} }).picks).toEqual(base.picks);
  });
});
