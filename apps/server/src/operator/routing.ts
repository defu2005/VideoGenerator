/**
 * Hybrid skill/tool routing. Ideas from paulpas/agent-skill-router (MIT):
 * BM25, trigger match, MMR. Written here; no code is copied.
 */

export const ROUTING_WEIGHTS = {
  bm25: 0.45,
  trigger: 0.25,
  history: 0.15,
  area: 0.15,
} as const;

const K1 = 1.2;
const B = 0.75;

export type RouteCandidate = {
  id: string;
  name: string;
  description: string;
  body: string;
  triggers: string[];
  antiTriggers: string[];
  area: string;
  /** 0..1. A new skill or tool uses 0.5. */
  history?: number;
  shortBody?: string;
};

export type ScoreBreakdown = {
  bm25: number;
  trigger: number;
  history: number;
  area: number;
  anti: number;
  total: number;
};

export type RouteHit = {
  id: string;
  name: string;
  description: string;
  area: string;
  score: number;
  breakdown: ScoreBreakdown;
  shortBody: string;
};

export type RoutedPart = {
  query: string;
  hits: RouteHit[];
};

const AREA_RULES: Array<{ area: string; words: string[] }> = [
  { area: "Hồ sơ", words: ["ho so", "profile", "kenh", "dinh huong"] },
  { area: "Tự động hoá", words: ["chu de", "hang doi", "lich tu dong", "automation", "trend", "xu huong"] },
  { area: "Quy trình", words: ["pipeline", "quy trinh", "gate", "cong", "du an", "project", "script", "kich ban"] },
  { area: "Render", words: ["render", "xuat video", "thumbnail", "clip", "shorts"] },
  { area: "Đăng bài", words: ["dang", "publish", "youtube", "tiktok", "lich dang", "upload"] },
  { area: "Bình luận", words: ["binh luan", "comment", "spam"] },
  { area: "Phân tích", words: ["thong ke", "analytics", "view", "insight", "bai hoc"] },
  { area: "Tài chính", words: ["doanh thu", "tien", "finance", "loi nhuan"] },
  { area: "Mô hình AI", words: ["quota", "han muc", "model", "mo hinh", "llm", "route"] },
  { area: "Ngân sách", words: ["ngan sach", "budget", "eco", "balanced"] },
  { area: "Telegram", words: ["telegram", "thong bao", "notification"] },
  { area: "Trợ lý", words: ["tro ly", "operator", "lenh thuong truc"] },
];

export function foldRoutingText(value: string): string {
  return value
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function routingTokens(value: string): string[] {
  return foldRoutingText(value).split(/[^a-z0-9]+/).filter((token) => token.length > 1);
}

export function classifyArea(query: string): string | null {
  const folded = foldRoutingText(query);
  let best: { area: string; hits: number } | null = null;
  for (const rule of AREA_RULES) {
    const hits = rule.words.filter((word) => folded.includes(word)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { area: rule.area, hits };
  }
  return best?.area ?? null;
}

function bm25(queryTokens: string[], docs: string[][]): number[] {
  const total = docs.length || 1;
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / total;
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTokens) {
      const freq = tf.get(term) ?? 0;
      if (!freq) continue;
      const seen = df.get(term) ?? 0;
      const idf = Math.log(1 + (total - seen + 0.5) / (seen + 0.5));
      const denom = freq + K1 * (1 - B + B * (doc.length / Math.max(1, avg)));
      score += idf * ((freq * (K1 + 1)) / denom);
    }
    return score;
  });
}

export function tokenJaccard(left: string, right: string): number {
  const a = new Set(routingTokens(left));
  const b = new Set(routingTokens(right));
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function scoreCandidates(query: string, candidates: RouteCandidate[]): RouteHit[] {
  const queryTokens = routingTokens(query);
  const foldedQuery = foldRoutingText(query);
  const area = classifyArea(query);
  const docs = candidates.map((candidate) => routingTokens(
    `${candidate.name} ${candidate.description} ${candidate.body}`,
  ));
  const raw = bm25(queryTokens, docs);
  const max = Math.max(0, ...raw);
  return candidates.map((candidate, index) => {
    const bm25Score = max === 0 ? 0 : raw[index]! / max;
    const trigger = candidate.triggers.some((item) => foldedQuery.includes(foldRoutingText(item))) ? 1 : 0;
    const history = candidate.history ?? 0.5;
    const areaScore = area && candidate.area === area ? 1 : 0;
    const anti = candidate.antiTriggers.some((item) => foldedQuery.includes(foldRoutingText(item))) ? 0.3 : 0;
    const total = ROUTING_WEIGHTS.bm25 * bm25Score
      + ROUTING_WEIGHTS.trigger * trigger
      + ROUTING_WEIGHTS.history * history
      + ROUTING_WEIGHTS.area * areaScore
      - anti;
    return {
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      area: candidate.area,
      score: total,
      breakdown: { bm25: bm25Score, trigger, history, area: areaScore, anti, total },
      shortBody: candidate.shortBody?.trim() || candidate.body.trim(),
    };
  }).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

/** Drop a hit that is too similar to one already picked (MMR-style filter). */
export function diversify(hits: RouteHit[], limit: number, threshold = 0.72): RouteHit[] {
  const picked: RouteHit[] = [];
  for (const hit of hits) {
    const blob = `${hit.name} ${hit.description} ${hit.shortBody}`;
    if (picked.some((item) => tokenJaccard(blob, `${item.name} ${item.description} ${item.shortBody}`) >= threshold)) {
      continue;
    }
    picked.push(hit);
    if (picked.length >= limit) break;
  }
  return picked;
}

const CONJUNCTION = /\s+(?:rồi|roi|sau đó|sau do|and then|then|and)\s+/i;

export function splitCompoundQuery(query: string): string[] {
  const parts = query.split(CONJUNCTION).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [query.trim()];
}

export function routeQuery(query: string, candidates: RouteCandidate[], limit = 3): RoutedPart[] {
  return splitCompoundQuery(query).map((part) => ({
    query: part,
    hits: diversify(scoreCandidates(part, candidates), limit),
  }));
}

export type HistoryEvent = {
  id: string;
  at: string;
  outcome: "success" | "failed" | "rejected" | "pending_rejected" | string;
};

/** Laplace smoothing over the last 30 days. No events → 0.5. */
export function historicalSuccess(events: HistoryEvent[], now: Date, id: string): number {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let successes = 0;
  let failures = 0;
  for (const event of events) {
    if (event.id !== id) continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || at < cutoff) continue;
    if (event.outcome === "success") successes += 1;
    else failures += 1;
  }
  return (successes + 1) / (successes + failures + 2);
}
