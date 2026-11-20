import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { redactExportText } from "@vg/shared";

/**
 * TASK-148e: prompt variant registry. Variants are proposed (by code or an agent) and
 * trialled offline; only the user may promote one. Nothing here changes a live prompt.
 */
export const VARIANT_TEXT_MAX = 8000;
export const MIN_TRIALS_TO_RECOMMEND = 10;
export const RECOMMEND_WIN_RATE = 0.6;

export type VariantStatus = "candidate" | "active" | "retired";
export type TrialWinner = "A" | "B" | "TIE";

export interface TrialEvidence {
  fixtureId: string;
  winner: TrialWinner;
  at: string;
}

export interface VariantRow {
  id: string;
  stage: string;
  textHash: string;
  text: string;
  status: VariantStatus;
  evidence: TrialEvidence[];
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export function registerPromptVariant(db: Database.Database, input: { stage: string; text: string; now?: Date }): VariantRow {
  if (input.text.length > VARIANT_TEXT_MAX) throw new Error("VARIANT_TOO_LONG");
  const text = redactExportText(input.text);
  const textHash = createHash("sha256").update(text).digest("hex");
  const existing = db.prepare("SELECT * FROM stage_prompt_variants WHERE stage=? AND text_hash=?").get(input.stage, textHash) as RawRow | undefined;
  if (existing) return toVariant(existing);
  const row: VariantRow = {
    id: randomUUID(), stage: input.stage, textHash, text, status: "candidate", evidence: [],
    createdAt: (input.now ?? new Date()).toISOString(), decidedAt: null, decidedBy: null,
  };
  db.prepare(`INSERT INTO stage_prompt_variants (id,stage,text_hash,text,status,evidence,created_at,decided_at,decided_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(row.id, row.stage, row.textHash, row.text, row.status, "[]", row.createdAt, null, null);
  return row;
}

/** Append blind-judge outcomes for one variant against the baseline. Evidence is append-only. */
export function recordTrialEvidence(db: Database.Database, variantId: string, trials: TrialEvidence[]): VariantRow {
  const row = getVariant(db, variantId);
  if (!row) throw new Error("VARIANT_NOT_FOUND");
  const evidence = [...row.evidence, ...trials.map((trial) => ({ ...trial, fixtureId: redactExportText(trial.fixtureId) }))];
  db.prepare("UPDATE stage_prompt_variants SET evidence=? WHERE id=?").run(JSON.stringify(evidence), variantId);
  return { ...row, evidence };
}

/** Decision rule: recommend only with enough trials and a clear win rate (ties count half). */
export function trialVerdict(evidence: TrialEvidence[]): { trials: number; winRate: number; recommend: boolean } {
  const trials = evidence.length;
  if (trials === 0) return { trials, winRate: 0, recommend: false };
  const score = evidence.reduce((sum, item) => sum + (item.winner === "A" ? 1 : item.winner === "TIE" ? 0.5 : 0), 0);
  const winRate = score / trials;
  return { trials, winRate: Math.round(winRate * 1000) / 1000, recommend: trials >= MIN_TRIALS_TO_RECOMMEND && winRate >= RECOMMEND_WIN_RATE };
}

/** Only the user promotes. Agents and operators get a rejection; the route enforces it too. */
export function promotePromptVariant(db: Database.Database, input: { id: string; decidedBy: string; now?: Date }): VariantRow {
  if (input.decidedBy !== "user") throw new Error("PROMPT_VARIANT_USER_ONLY");
  const row = getVariant(db, input.id);
  if (!row) throw new Error("VARIANT_NOT_FOUND");
  const at = (input.now ?? new Date()).toISOString();
  db.transaction(() => {
    db.prepare("UPDATE stage_prompt_variants SET status='retired' WHERE stage=? AND status='active' AND id<>?").run(row.stage, row.id);
    db.prepare("UPDATE stage_prompt_variants SET status='active', decided_at=?, decided_by=? WHERE id=?").run(at, input.decidedBy, row.id);
  })();
  return getVariant(db, input.id)!;
}

export function activePromptVariant(db: Database.Database, stage: string): VariantRow | null {
  const row = db.prepare("SELECT * FROM stage_prompt_variants WHERE stage=? AND status='active' LIMIT 1").get(stage) as RawRow | undefined;
  return row ? toVariant(row) : null;
}

export function getVariant(db: Database.Database, id: string): VariantRow | null {
  const row = db.prepare("SELECT * FROM stage_prompt_variants WHERE id=?").get(id) as RawRow | undefined;
  return row ? toVariant(row) : null;
}

type RawRow = { id: string; stage: string; text_hash: string; text: string; status: VariantStatus; evidence: string; created_at: string; decided_at: string | null; decided_by: string | null };
function toVariant(row: RawRow): VariantRow {
  return { id: row.id, stage: row.stage, textHash: row.text_hash, text: row.text, status: row.status,
    evidence: JSON.parse(row.evidence) as TrialEvidence[], createdAt: row.created_at, decidedAt: row.decided_at, decidedBy: row.decided_by };
}
