import { describe, expect, it } from "vitest";
import { GENRE_PACKS } from "@vg/shared";
import type { DirectorInput } from "../src/compose/director.js";
import { directByRules } from "../src/compose/director/index.js";
import { planEval, type EvalMode } from "../src/compose/eval/runEval.js";
import { GENRE_IDS, hit, SCENES, speak } from "./helpers/genreFixtures.js";

/**
 * TASK-112 equivalence snapshots: the director's output for every built-in genre and for the eval
 * fixtures was frozen before the director stopped comparing recipe ids. It must not move.
 */

function inputs(recipe: string, aspect: "16:9" | "9:16"): DirectorInput[] {
  return SCENES.map((text, index) => {
    const spoken = speak(text);
    return {
      scene: { sceneId: `s${index}`, index, count: SCENES.length, text, durationSec: spoken.durationSec },
      words: spoken.words,
      recipeId: recipe,
      aspect,
      stills: [{ candidateId: `still-${index}`, path: `still-${index}.png` }],
      footage: Array.from({ length: 3 }, (_, i) => hit(`${index}-${i}`)),
    };
  });
}

describe("genre director equivalence snapshots", () => {
  it("lists every built-in genre", () => {
    for (const id of GENRE_IDS) expect(GENRE_PACKS[id]).toBeDefined();
  });

  for (const id of GENRE_IDS) {
    for (const aspect of ["16:9", "9:16"] as const) {
      it(`${id} ${aspect} rule director output stays the same`, () => {
        expect(directByRules(inputs(id, aspect))).toMatchSnapshot();
      });
    }
  }

  const MODES: Exclude<EvalMode, "legacy">[] = ["baseline", "rule", "rule+llm(mock)", "compose"];
  for (const project of ["explainer", "listicle", "story"]) {
    for (const mode of MODES) {
      it(`eval fixture ${project} / ${mode} plan stays the same`, async () => {
        const { plan } = await planEval(project, mode);
        const shots = plan.scenes.map((scene) => scene.shots.map((shot) => ({
          kind: shot.source.kind,
          start: shot.startSec,
          end: shot.endSec,
          ...(shot.source.kind === "footage" || shot.source.kind === "still" ? {} : { source: shot.source }),
        })));
        expect({ shots, stats: plan.stats }).toMatchSnapshot();
      });
    }
  }
});
