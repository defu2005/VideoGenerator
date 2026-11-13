export type ComposeLangPack = {
  code: string;
  decimalSep: "," | ".";
  thousandSep: "." | ",";
  scaleWords: Record<string, number>;
  percentWords: string[];
  timesWords: { before: string[]; after: string[] };
  yearMarkers: string[];
  ordinals: string[];
  contrastWords: string[];
  quoteMarks: [string, string][];
};
