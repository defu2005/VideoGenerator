import type { FormatRecipe } from "./recipes.js";

export interface TreatmentSection {
  key: string;
  nameVi: string;
  estSec: number;
}

export interface TreatmentCard {
  title: string;
  formatId: string;
  formatNameVi: string;
  angle: string;
  sections: TreatmentSection[];
  estimatedSceneCount: number;
  estimatedDurationSec: number;
  cost: {
    inputTokens: number;
    outputTokens: number;
    ttsCharacters: number;
    usd: number | null;
  };
  estimatedRenderSec: number | null;
  renderNoteVi: string;
}

export function buildTreatment(input: {
  title: string;
  recipe: FormatRecipe;
  hook: string;
  sections: { key?: string; heading: string; estDurationSec: number }[];
  cost: { inputTokens: number; outputTokens: number; ttsCharacters?: number; usd?: number | null };
  averageGraphicSec?: number | null;
}): TreatmentCard {
  const byKey = new Map(input.recipe.script.structure.map((section) => [section.key, section]));
  const sections = input.sections.map((section) => {
    const known = section.key ? byKey.get(section.key) : undefined;
    return {
      key: section.key ?? "other",
      nameVi: known?.nameVi ?? section.heading,
      estSec: Math.max(0, Math.round(section.estDurationSec)),
    };
  });
  const duration = sections.reduce((sum, section) => sum + section.estSec, 0);
  const [minScene, maxScene] = input.recipe.scenes.targetSceneSec;
  const mid = (minScene + maxScene) / 2;
  const scenes = duration > 0 ? Math.max(1, Math.round(duration / mid)) : input.sections.length;
  const render = input.averageGraphicSec && input.averageGraphicSec > 0
    ? Math.round(input.averageGraphicSec * Math.min(scenes, 8))
    : null;
  return {
    title: input.title,
    formatId: input.recipe.id,
    formatNameVi: input.recipe.nameVi,
    angle: input.hook.trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 180) || input.hook.slice(0, 180),
    sections,
    estimatedSceneCount: scenes,
    estimatedDurationSec: duration,
    cost: {
      inputTokens: input.cost.inputTokens,
      outputTokens: input.cost.outputTokens,
      ttsCharacters: input.cost.ttsCharacters ?? 0,
      usd: input.cost.usd ?? null,
    },
    estimatedRenderSec: render,
    renderNoteVi: render === null ? "chưa có dữ liệu" : `ước tính ${render} giây cho đồ họa`,
  };
}
