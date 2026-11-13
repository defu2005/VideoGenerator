import { EN_PACK } from "./en.js";
import type { ComposeLangPack } from "./types.js";
import { VI_PACK } from "./vi.js";

export type { ComposeLangPack } from "./types.js";

export const DIGITS_ONLY: ComposeLangPack = {
  code: "digits",
  decimalSep: ".",
  thousandSep: ",",
  scaleWords: {},
  percentWords: [],
  timesWords: { before: [], after: [] },
  yearMarkers: [],
  ordinals: [],
  contrastWords: [],
  quoteMarks: [],
};

const PACKS: Record<string, ComposeLangPack> = {
  vi: VI_PACK,
  en: EN_PACK,
};

export function getLangPack(code: string | null | undefined): ComposeLangPack {
  const base = (code ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return PACKS[base] ?? DIGITS_ONLY;
}
