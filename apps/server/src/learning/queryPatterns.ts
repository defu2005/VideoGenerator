import type Database from "better-sqlite3";
import { redactExportText } from "@vg/shared";

/**
 * TASK-148d: query shapes that worked (or failed) for a topic in this workspace.
 * Code only, no LLM. Shapes are coarse flags, so the table stays small and private.
 */
const GENERIC = new Set(["image", "images", "photo", "photos", "picture", "pictures", "stock", "background", "video", "footage", "scene", "shot"]);
const MAX_HINTS = 5;
const MAX_EXAMPLE = 120;

export function queryShapes(query: string): string[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const shapes: string[] = [];
  // A capitalised word after the first position is a proper noun in most scout queries.
  if (words.slice(1).some((word) => /^\p{Lu}/u.test(word))) shapes.push("proper_noun");
  if (/\b(?:19|20)\d{2}\b/.test(query)) shapes.push("year");
  if (words.some((word) => GENERIC.has(word.toLowerCase()))) shapes.push("generic_word");
  if (/[^\x00-\x7F]/.test(query)) shapes.push("non_latin");
  if (words.length <= 2) shapes.push("short");
  return shapes.length ? shapes : ["plain"];
}

export function topicTagFor(topic: string | null | undefined): string {
  const tag = (topic ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  return tag || "general";
}

/** Record one accept or reject outcome for every shape of the query. */
export function recordQueryOutcome(db: Database.Database, input: {
  workspaceId: string | null; channel?: string | null; topic: string | null | undefined; query: string; accepted: boolean; now?: Date;
}): void {
  if (!input.workspaceId) return;
  const example = redactExportText(input.query.trim()).slice(0, MAX_EXAMPLE);
  if (!example || /https?:\/\//i.test(example)) return;
  const topicTag = topicTagFor(input.topic);
  const at = (input.now ?? new Date()).toISOString();
  const channel = input.channel ?? "";
  const upsert = db.prepare(`INSERT INTO visual_query_patterns (workspace_id,channel,topic_tag,shape,accepted,rejected,example_query,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,channel,topic_tag,shape,example_query) DO UPDATE SET
      accepted=accepted+excluded.accepted, rejected=rejected+excluded.rejected,
      example_query=excluded.example_query, updated_at=excluded.updated_at`);
  db.transaction(() => {
    for (const shape of queryShapes(example)) {
      upsert.run(input.workspaceId, channel, topicTag, shape, input.accepted ? 1 : 0, input.accepted ? 0 : 1, example, at);
    }
  })();
}

/**
 * Up to 5 example queries that were accepted more often than rejected for this topic.
 * Every shape row of one example carries the same counts, so MAX per example, not SUM across shapes.
 */
export function queryHints(db: Database.Database, workspaceId: string | null, topic: string | null | undefined, channel?: string | null): string[] {
  if (!workspaceId) return [];
  const rows = db.prepare(`SELECT example_query AS example, MAX(accepted) AS accepted, MAX(rejected) AS rejected
    FROM visual_query_patterns WHERE workspace_id=? AND channel=? AND topic_tag=?
    GROUP BY example_query HAVING MAX(accepted) > MAX(rejected)
    ORDER BY MAX(accepted) DESC, MAX(updated_at) DESC LIMIT ?`)
    .all(workspaceId, channel ?? "", topicTagFor(topic), MAX_HINTS) as Array<{ example: string }>;
  return rows.map((row) => row.example);
}
