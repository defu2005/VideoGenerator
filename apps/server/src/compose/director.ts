import { directivesForRecipe, type AspectRatio, type GenreDirectives, type KindSpan, type SceneWord } from "@vg/shared";
import type { FootageHit } from "../providers/footage/types.js";

export type DirectorInput = {
  scene: { sceneId: string; index: number; count: number; text: string; durationSec: number };
  words: SceneWord[];
  /** Kept for the prompt and the logs. The director reads `directives`, never this id. */
  recipeId: string;
  /** Built once per project by `planProject`. Missing: built from `recipeId` (unknown ids behave like explainer). */
  directives?: GenreDirectives;
  aspect: AspectRatio;
  stills: { candidateId: string; path: string }[];
  footage: FootageHit[];
};

/** The genre directives of a scene input: the ones the caller built, otherwise those of its recipe id. */
export function directivesOf(input: Pick<DirectorInput, "recipeId" | "directives">): GenreDirectives {
  return input.directives ?? directivesForRecipe(input.recipeId);
}

export type Director = {
  id: string;
  directScenes(inputs: DirectorInput[]): Promise<KindSpan[][]>;
};

export const baselineDirector: Director = {
  id: "baseline",
  directScenes(inputs) {
    return Promise.resolve(inputs.map((input) => [{
      kind: input.footage.length >= 2 ? "footage" as const : "still" as const,
      wordStart: 0,
      wordEnd: input.words.length,
      reason: "baseline",
    }]));
  },
};
