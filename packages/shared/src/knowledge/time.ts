import type { KnowledgeEntry, KnowledgeFreshness } from "./schema.js";

const ttl = { stable: 730, yearly: 365, quarterly: 90, monthly: 30, weekly: 7 };
const DAY_MS = 86_400_000;

export function knowledgeTime(entry: KnowledgeEntry, at = new Date()): {
  reviewAfter: string; freshness: KnowledgeFreshness;
} {
  const latest = entry.evidence.reduce((max, e) => Math.max(max, Date.parse(e.checkedAt)), 0);
  const span = ttl[entry.volatility] * DAY_MS;
  const day = Date.parse(at.toISOString().slice(0, 10));
  return {
    reviewAfter: new Date(latest + span).toISOString().slice(0, 10),
    freshness: day > latest + 2 * span ? "stale" : day > latest + span ? "due" : "fresh",
  };
}

export function knowledgeApplies(entry: KnowledgeEntry, at: Date): boolean {
  const day = at.toISOString().slice(0, 10);
  return entry.status === "active"
    && (!entry.validFrom || entry.validFrom <= day)
    && (!entry.validUntil || day < entry.validUntil);
}
