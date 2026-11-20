import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { ContinuityEnvelopeSchema, type ContinuityEnvelope } from "@vg/shared";

/** Versioned JSON belongs to SCENE_PLAN, so snapshots and inputVersion include it. */
export function readContinuity(db: Database.Database, projectId: string): ContinuityEnvelope | undefined {
  for (const row of db.prepare('SELECT visual_queries FROM scenes WHERE project_id=? ORDER BY "order"').all(projectId) as { visual_queries: string }[]) {
    try {
      if (!row.visual_queries) continue;
      const json = JSON.parse(row.visual_queries);
      if (!json || typeof json !== "object") continue;
      const parsed = ContinuityEnvelopeSchema.safeParse(json.continuity);
      if (parsed.success) return parsed.data;
    } catch {
      // malformed-JSON on one scene row does not crash the read
    }
  }
  return undefined;
}
export function writeContinuity(db: Database.Database, projectId: string, envelope: ContinuityEnvelope): void {
  const parsed = ContinuityEnvelopeSchema.parse(envelope);
  const rows = db.prepare('SELECT id,visual_queries FROM scenes WHERE project_id=? ORDER BY "order"').all(projectId) as { id: string; visual_queries: string }[];
  const update = db.prepare("UPDATE scenes SET visual_queries=? WHERE id=? AND project_id=?");
  for (const [index, row] of rows.entries()) {
    let data: Record<string, unknown> = {};
    try {
      const json = JSON.parse(row.visual_queries);
      if (json && typeof json === "object" && !Array.isArray(json)) data = json as Record<string, unknown>;
    } catch {
      data = {};
    }
    delete data.continuity;
    if (index === 0) data.continuity = parsed;
    update.run(JSON.stringify(data), row.id, projectId);
  }
}
export function continuityFingerprint(envelope: ContinuityEnvelope | undefined): string {
  return envelope ? createHash("sha256").update(JSON.stringify(envelope.plan)).digest("hex") : "";
}

/** Preserve the plan while structural edits discard/remap old scene identifiers. */
export function reconcileContinuity(db: Database.Database, projectId: string, envelope: ContinuityEnvelope,
  remap: Record<string, string[]> = {}): void {
  const ids = new Set((db.prepare("SELECT id FROM scenes WHERE project_id=?").all(projectId) as { id: string }[]).map((row) => row.id));
  const map = (values: string[]) => [...new Set(values.flatMap((id) => remap[id] ?? [id]).filter((id) => ids.has(id)))];
  writeContinuity(db, projectId, { ...envelope, plan: { ...envelope.plan,
    characters: envelope.plan.characters.map((item) => ({ ...item, appearsInScenes: map(item.appearsInScenes) })),
    motifs: envelope.plan.motifs.map((item) => ({ ...item, scenes: map(item.scenes) })),
  } });
}
