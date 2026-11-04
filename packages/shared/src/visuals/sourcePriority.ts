import type { StockImageProvider } from "../schemas/visual.js";
import { STOCK_IMAGE_PROVIDERS } from "../schemas/visual.js";

export type PreferredSourcesInput = {
  topic?: string;
  style?: string;
  sceneText?: string;
};

export type PreferredSourcePlan = {
  /** All providers kept; preferred ones moved to the front. */
  order: StockImageProvider[];
  /** Per-provider search page size. Preferred get a higher limit. */
  limits: Record<StockImageProvider, number>;
};

const SPACE_SCIENCE = [
  "space", "nasa", "astronomy", "astronaut", "galaxy", "planet", "mars", "moon", "rocket",
  "satellite", "orbit", "cosmos", "nebula", "telescope", "physics", "chemistry", "biology",
  "science", "scientific", "lab", "laboratory", "quantum", "genome", "dna",
  "vu tru", "thiên văn", "phi hành", "khoa học", "vũ trụ", "hành tinh", "mặt trăng", "sao hỏa",
];

const HISTORY_ART = [
  "history", "historical", "museum", "art", "painting", "sculpture", "antique", "heritage",
  "archive", "civil war", "renaissance", "medieval", "ancient", "artifact", "archaeology",
  "portrait", "gallery", "monument", "dynasty", "empire",
  "lịch sử", "nghệ thuật", "bảo tàng", "cổ vật", "tranh", "điêu khắc", "di sản",
];

const EVERYDAY = [
  "lifestyle", "everyday", "daily", "people", "family", "street", "city life", "food",
  "coffee", "travel", "vacation", "home", "office", "workout", "fashion", "portrait photo",
  "stock", "business", "workplace",
  "đời sống", "cuộc sống", "gia đình", "ẩm thực", "du lịch", "đường phố",
];

const DEFAULT_LIMIT = 8;
const BOOST_LIMIT = 12;
const LOWER_LIMIT = 6;

function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((keyword) => haystack.includes(normalize(keyword)));
}

function moveToFront(order: StockImageProvider[], preferred: StockImageProvider[]): StockImageProvider[] {
  const preferredSet = new Set(preferred);
  const head = preferred.filter((id) => order.includes(id));
  const tail = order.filter((id) => !preferredSet.has(id));
  return [...head, ...tail];
}

/**
 * Pure topic routing (0 LLM): reorder providers and adjust per-provider limits.
 * Never removes providers — only changes order and limits.
 */
export function preferredSources(
  project: PreferredSourcesInput,
  scene?: PreferredSourcesInput,
): PreferredSourcePlan {
  const haystack = normalize([
    project.topic ?? "",
    project.style ?? "",
    project.sceneText ?? "",
    scene?.topic ?? "",
    scene?.style ?? "",
    scene?.sceneText ?? "",
  ].join(" "));

  let order: StockImageProvider[] = [...STOCK_IMAGE_PROVIDERS];
  let preferred: StockImageProvider[] = [];

  if (matchesAny(haystack, SPACE_SCIENCE)) {
    preferred = ["nasa", "wikimedia", "openverse"];
  } else if (matchesAny(haystack, HISTORY_ART)) {
    preferred = ["met", "loc", "smithsonian", "europeana", "wikimedia"];
  } else if (matchesAny(haystack, EVERYDAY)) {
    preferred = ["pexels", "unsplash", "pixabay", "flickr"];
  }

  if (preferred.length) order = moveToFront(order, preferred);

  const preferredSet = new Set(preferred);
  const limits = Object.fromEntries(
    STOCK_IMAGE_PROVIDERS.map((id) => [
      id,
      preferredSet.size === 0
        ? DEFAULT_LIMIT
        : preferredSet.has(id) ? BOOST_LIMIT : LOWER_LIMIT,
    ]),
  ) as Record<StockImageProvider, number>;

  return { order, limits };
}
