import type { ComposeLangPack } from "./types.js";

/** Scale words follow the same list used by vietnamese-number (MIT): nghìn/ngàn, triệu, tỷ/tỉ. */
export const VI_PACK: ComposeLangPack = {
  code: "vi",
  decimalSep: ",",
  thousandSep: ".",
  scaleWords: {
    nghìn: 1e3,
    ngàn: 1e3,
    triệu: 1e6,
    tỷ: 1e9,
    tỉ: 1e9,
  },
  percentWords: ["phần trăm"],
  timesWords: { before: ["gấp"], after: ["lần"] },
  yearMarkers: ["năm"],
  ordinals: [
    "thứ nhất", "thứ hai", "thứ ba", "thứ tư", "thứ năm",
    "thứ sáu", "thứ bảy", "thứ tám", "thứ chín", "thứ mười",
    "số 1", "số 2", "số 3", "số 4", "số 5",
    "đầu tiên",
  ],
  contrastWords: ["nhưng", "thực ra", "sự thật là", "tuy nhiên"],
  quoteMarks: [["“", "”"], ["\"", "\""]],
};
