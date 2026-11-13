import type { ComposeLangPack } from "./types.js";

/**
 * English scale words and suffixes follow compromise/plugins/numbers (MIT, spencermountain/compromise):
 * thousand, million, billion, and the short forms k / m / bn.
 */
export const EN_PACK: ComposeLangPack = {
  code: "en",
  decimalSep: ".",
  thousandSep: ",",
  scaleWords: {
    thousand: 1e3,
    million: 1e6,
    billion: 1e9,
    k: 1e3,
    m: 1e6,
    bn: 1e9,
  },
  percentWords: ["percent", "per cent"],
  timesWords: { before: [], after: ["times"] },
  yearMarkers: ["in", "since", "by"],
  ordinals: [
    "first", "second", "third", "fourth", "fifth",
    "sixth", "seventh", "eighth", "ninth", "tenth",
    "number 1", "number 2", "number 3",
  ],
  contrastWords: ["but", "actually", "in fact", "however"],
  quoteMarks: [["“", "”"], ["\"", "\""]],
};
