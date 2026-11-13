import type { Script, ScriptSection } from "../schemas/script.js";
import type { SceneDraft } from "../schemas/scene.js";
import { splitSentences } from "./sentences.js";

// Restored on 2026-11-03 from packages/shared/dist/scenes/planScenes.js (built 1 minute before
// the source file was zeroed by an interrupted write); types re-added from planScenes.d.ts.

type Settings = {
  sceneDurationSec: number;
  wordsPerMinute: number;
  language: string;
  /** Recipe range. The midpoint replaces the project scene length when set. */
  targetSceneSec?: [number, number];
  /** Preferred visual kinds from the recipe, rotated onto search queries. */
  visualMix?: Array<"photo" | "illustration" | "chart" | "text">;
};

type Unit = {
  kind: "hook" | "section" | "outro";
  sectionId: string | null;
  label: string;
  narration: string;
  section: ScriptSection | null;
  queriesFrom: ScriptSection | null;
};

type QueryAssignment = {
  visualQueries: { primary: string; alternatives: string[] };
  queryVariant: boolean;
};

type AssignQueries = (section: ScriptSection | null) => QueryAssignment;

const QUERY_VARIANT_MODIFIERS = ["close-up", "wide shot", "archival photo", "detail", "portrait", "illustration"];

function sceneTarget(settings: Settings): number {
  if (!settings.targetSceneSec) return settings.sceneDurationSec;
  return (settings.targetSceneSec[0] + settings.targetSceneSec[1]) / 2;
}

export function ensureConsecutiveQueryVariety(scenes: SceneDraft[]): void {
  for (let index = 1; index < scenes.length; index += 1) {
    const scene = scenes[index]!;
    if (scene.visualQueries.primary !== scenes[index - 1]!.visualQueries.primary) continue;
    const base = scene.visualQueries.primary;
    for (let offset = 0; offset < QUERY_VARIANT_MODIFIERS.length; offset += 1) {
      const modifier = QUERY_VARIANT_MODIFIERS[(index + offset) % QUERY_VARIANT_MODIFIERS.length]!;
      const primary = `${base} ${modifier}`.trim();
      if (primary === scenes[index - 1]!.visualQueries.primary) continue;
      scene.visualQueries = {
        primary,
        alternatives: scene.visualQueries.alternatives.filter((query) => query !== primary).slice(0, 3),
      };
      scene.queryVariant = true;
      break;
    }
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function duration(text: string, wordsPerMinute: number): number {
  return round1(words(text) * 60 / wordsPerMinute);
}

function splitLongSentence(sentence: string, settings: Settings): string[] {
  const maxDuration = settings.sceneDurationSec * 1.6;
  if (duration(sentence, settings.wordsPerMinute) <= maxDuration) return [sentence];

  const clauses: string[] = [];
  let current = "";
  // Only split where the delimiter is followed by whitespace (e.g. not inside "người—và"),
  // so re-joining scenes with a single space reproduces the original text exactly.
  for (const part of sentence.split(/([,;:—])(?=\s)/u)) {
    current += part;
    if (/^[,;:—]$/u.test(part)) {
      clauses.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) clauses.push(current.trim());

  const parts = clauses.length > 1 ? clauses : [sentence];
  if (parts.every((part) => duration(part, settings.wordsPerMinute) <= maxDuration)) return parts;

  const result: string[] = [];
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/u);
    const partDuration = tokens.length * 60 / settings.wordsPerMinute;
    if (partDuration <= maxDuration) {
      result.push(part.trim());
      continue;
    }
    const target = sceneTarget(settings);
    // Closest part count to the target, never fewer than the 1.6× limit allows.
    const partCount = Math.min(
      tokens.length,
      Math.max(Math.ceil(partDuration / (1.6 * target)), Math.round(partDuration / target)),
    );
    const baseSize = Math.floor(tokens.length / partCount);
    let remainder = tokens.length % partCount;
    let offset = 0;
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const size = baseSize + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      result.push(tokens.slice(offset, offset + size).join(" "));
      offset += size;
    }
  }
  return result;
}

function sceneDraft(
  unit: Unit,
  narration: string,
  startSec: number,
  settings: Settings,
  assignQueries: AssignQueries,
): SceneDraft {
  const section = unit.section ?? unit.queriesFrom;
  const queryAssignment = assignQueries(section);
  return {
    order: 0,
    kind: unit.kind,
    sectionId: unit.sectionId,
    label: unit.label,
    narration,
    visualNotes: section?.visualNotes ?? "",
    visualDescription: section?.visualNotes ?? "",
    visualQueries: queryAssignment.visualQueries,
    queryVariant: queryAssignment.queryVariant,
    musicMood: section?.musicMood ?? "",
    energy: section?.energy ?? "medium",
    estDurationSec: duration(narration, settings.wordsPerMinute),
    durationOverrideSec: null,
    startSec: round1(startSec),
    transitionNote: "",
  } as SceneDraft;
}

function packUnit(unit: Unit, settings: Settings, assignQueries: AssignQueries): SceneDraft[] {
  const sentences = splitSentences(unit.narration, settings.language)
    .flatMap((sentence) => splitLongSentence(sentence, settings));
  if (sentences.length === 0) return [];

  const target = sceneTarget(settings);
  const packed: string[] = [];
  let current: string[] = [];
  for (const sentence of sentences) {
    if (current.length === 0) {
      current.push(sentence);
      continue;
    }
    const currentText = current.join(" ");
    const proposedDuration = duration(`${currentText} ${sentence}`, settings.wordsPerMinute);
    const currentDuration = duration(currentText, settings.wordsPerMinute);
    if (proposedDuration <= target * 1.3
      || (currentDuration < target * 0.6 && proposedDuration <= target * 1.6)) {
      current.push(sentence);
    } else {
      packed.push(currentText);
      current = [sentence];
    }
  }
  if (current.length) packed.push(current.join(" "));

  // Merge any scene shorter than 0.5× target into its shorter neighbour (same unit) when ≤ 1.8× target.
  if (packed.length > 1) {
    let index = 0;
    while (index < packed.length) {
      const currentDuration = duration(packed[index]!, settings.wordsPerMinute);
      if (currentDuration >= target * 0.5) {
        index += 1;
        continue;
      }
      const neighbors = [index - 1, index + 1]
        .filter((neighborIndex) => neighborIndex >= 0 && neighborIndex < packed.length)
        .sort((left, right) =>
          duration(packed[left]!, settings.wordsPerMinute)
          - duration(packed[right]!, settings.wordsPerMinute));
      const mergeIndex = neighbors.find((neighborIndex) => {
        const left = Math.min(index, neighborIndex);
        const right = Math.max(index, neighborIndex);
        return duration(`${packed[left]} ${packed[right]}`, settings.wordsPerMinute) <= target * 1.8;
      });
      if (mergeIndex === undefined) {
        const neighborIndex = neighbors[0];
        if (neighborIndex === undefined) {
          index += 1;
          continue;
        }
        const left = Math.min(index, neighborIndex);
        const right = Math.max(index, neighborIndex);
        const wordsToBalance = `${packed[left]} ${packed[right]}`.trim().split(/\s+/u);
        const midpoint = Math.ceil(wordsToBalance.length / 2);
        packed.splice(
          left,
          2,
          wordsToBalance.slice(0, midpoint).join(" "),
          wordsToBalance.slice(midpoint).join(" "),
        );
        index = Math.max(0, left - 1);
        continue;
      }
      const left = Math.min(index, mergeIndex);
      const right = Math.max(index, mergeIndex);
      packed.splice(left, 2, `${packed[left]} ${packed[right]}`);
      index = Math.max(0, left - 1);
    }
  }

  let startSec = 0;
  return packed.map((narration) => {
    const scene = sceneDraft(unit, narration, 0, settings, assignQueries);
    scene.startSec = startSec;
    startSec = round1(startSec + scene.estDurationSec);
    return scene;
  });
}

export function planScenes(script: Script, settings: Settings): SceneDraft[] {
  if (!Number.isFinite(settings.sceneDurationSec) || settings.sceneDurationSec <= 0
    || !Number.isFinite(settings.wordsPerMinute) || settings.wordsPerMinute <= 0) {
    throw new RangeError("Scene duration and words per minute must be positive finite numbers.");
  }

  const firstSection = script.sections[0] ?? null;
  const lastSection = script.sections.at(-1) ?? null;
  const units: Unit[] = [
    ...(script.hook.trim() ? [{
      kind: "hook" as const,
      sectionId: null,
      label: "Hook",
      narration: script.hook,
      section: null,
      queriesFrom: firstSection,
    }] : []),
    ...script.sections.map((section): Unit => ({
      kind: "section",
      sectionId: section.id,
      label: section.heading,
      narration: section.narration,
      section,
      queriesFrom: section,
    })),
    ...(script.outro.trim() ? [{
      kind: "outro" as const,
      sectionId: null,
      label: "Outro",
      narration: script.outro,
      section: null,
      queriesFrom: lastSection,
    }] : []),
  ];

  const result: SceneDraft[] = [];
  // Query rotation continues per section across hook/section/outro boundaries, so the hook
  // and the first section scene never reuse the same primary query.
  const queryPositions = new Map<string, number>();
  let previousPrimary: string | undefined;
  const assignQueries: AssignQueries = (section) => {
    if (!section) {
      return { visualQueries: { primary: "", alternatives: [] }, queryVariant: false };
    }
    const pool = [...new Set([section.visualQueries.primary, ...section.visualQueries.alternatives])];
    const positionKey = section.id;
    let position = queryPositions.get(positionKey) ?? 0;
    let primary: string;
    let queryVariant: boolean;
    do {
      if (position < pool.length) {
        primary = pool[position]!;
        queryVariant = false;
      } else {
        const modifier = QUERY_VARIANT_MODIFIERS[(position - pool.length) % QUERY_VARIANT_MODIFIERS.length]!;
        primary = `${section.visualQueries.primary} ${modifier}`.trim();
        queryVariant = true;
      }
      position += 1;
    } while (primary === previousPrimary);
    queryPositions.set(positionKey, position);
    const mix = settings.visualMix ?? [];
    if (mix.length > 0) {
      const kind = mix[(position - 1) % mix.length];
      const word = kind === "photo" ? "photograph" : kind === "text" ? "text graphic" : kind;
      if (word && !primary.toLowerCase().includes(word)) primary = `${primary} ${word}`;
    }
    previousPrimary = primary;
    const variantQueries = QUERY_VARIANT_MODIFIERS.map((modifier) => `${section.visualQueries.primary} ${modifier}`.trim());
    const alternatives = [...pool, ...variantQueries]
      .filter((query) => query !== primary)
      .slice(0, 3);
    return {
      visualQueries: { primary, alternatives },
      queryVariant,
    };
  };

  let startSec = 0;
  for (const unit of units) {
    const unitScenes = packUnit(unit, settings, assignQueries);
    for (const scene of unitScenes) {
      scene.order = result.length;
      scene.startSec = round1(startSec);
      startSec = round1(startSec + (scene.durationOverrideSec ?? scene.estDurationSec));
      result.push(scene);
    }
  }
  return result;
}
