import type Database from "better-sqlite3";
import { knowledgeTerms } from "@vg/shared";
import { embedTexts } from "./embeddings.js";
import { searchKnowledge } from "./search.js";
// Fixed similarity thresholds, independent of score normalization or RRF rank.
export async function earlierTopic(db: Database.Database, profileId: string, query: string) {
    const queryVector = (await embedTexts(db, [query]))?.[0];
    const result = searchKnowledge(db, { profileId, query, kinds: ["topic", "script", "result"], limit: 8, tokenBudget: 3000, mode: "hybrid", queryVector });
    const terms = new Set(knowledgeTerms(query));
    const hit = result.matches.find(m => m.projectId && ((m.breakdown.vector ?? 0) >= 0.82 || [...new Set(knowledgeTerms(m.title + " " + m.text))].filter(t => terms.has(t)).length / Math.max(1, terms.size) >= 0.75));
    return hit ? { label: "đã làm", projectId: hit.projectId!, title: hit.title } : null;
}
