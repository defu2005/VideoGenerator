import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";

/** TASK-148a/b: weekly distillation of stage feedback into short lessons, plus the reader used by prompts. */

export const STAGE_LESSON_STAGES = ["RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_REVIEW", "MUSIC_REVIEW", "FINAL_APPROVAL"] as const;
export const MIN_NEW_ROWS_PER_STAGE = 5;
export const MAX_NOTES_PER_STAGE = 5;
export const LESSON_TEXT_MAX = 300;
export const STAGE_LESSON_STATUSES = ["proposed", "approved", "rejected", "retired"] as const;

export const StageLessonProposalSchema = z.object({
  notes: z.array(z.object({
    text: z.string().min(1).max(LESSON_TEXT_MAX),
    evidenceIds: z.array(z.string().min(1)).min(1),
    confidence: z.number().min(0).max(1),
  })).max(MAX_NOTES_PER_STAGE),
}).strict();
export type StageLessonProposal = z.infer<typeof StageLessonProposalSchema>;

export type FeedbackRowForLesson = {
  id: string;
  kind: string;
  target: string;
  before: string | null;
  after: string | null;
  reason: string | null;
};

/** Injected so tests stub the LLM; production passes a generateRoutedStructured wrapper. */
export type LessonProposer = (input: { stage: string; profileId: string | null; rows: FeedbackRowForLesson[] }) => Promise<StageLessonProposal>;

type RowTuple = FeedbackRowForLesson & { profile_id: string | null };

/**
 * Distils new (undistilled) feedback for one channel and stage into proposed notes.
 * Runs only when at least MIN_NEW_ROWS_PER_STAGE new rows exist. Marks the used rows distilled.
 * Returns the number of notes proposed. Never approves anything: agents and the job only propose.
 */
export async function distillStageFeedback(
  sqlite: Database.Database,
  input: { profileId: string; stage: string; propose: LessonProposer; now?: Date },
): Promise<number> {
  const rows = sqlite.prepare(
    `SELECT id, kind, target, before, after, reason, profile_id FROM stage_feedback
     WHERE profile_id IS ? AND stage = ? AND distilled_at IS NULL ORDER BY created_at LIMIT 200`,
  ).all(input.profileId, input.stage) as RowTuple[];
  if (rows.length < MIN_NEW_ROWS_PER_STAGE) return 0;
  const proposal = StageLessonProposalSchema.parse(await input.propose({ stage: input.stage, profileId: input.profileId, rows }));
  const known = new Set(rows.map((row) => row.id));
  const now = (input.now ?? new Date()).toISOString();
  let proposed = 0;
  const tx = sqlite.transaction(() => {
    for (const note of proposal.notes) {
      // Only evidence that really exists in this batch may back a note.
      const evidence = note.evidenceIds.filter((id) => known.has(id));
      if (evidence.length === 0) continue;
      sqlite.prepare(
        `INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?, 0)`,
      ).run(randomUUID(), input.profileId, input.stage, note.text, JSON.stringify(evidence), now);
      proposed += 1;
    }
    const mark = sqlite.prepare("UPDATE stage_feedback SET distilled_at = ? WHERE id = ?");
    for (const row of rows) mark.run(now, row.id);
  });
  tx();
  return proposed;
}

/** 148b: approved lessons for a channel plus global ones, newest and most used first. */
export function stageLessons(sqlite: Database.Database, profileId: string | null, stage: string, limit = MAX_NOTES_PER_STAGE): string[] {
  const rows = sqlite.prepare(
    `SELECT id, text FROM stage_notes
     WHERE stage = ? AND status = 'approved' AND (profile_id IS NULL OR profile_id = ?)
     ORDER BY (profile_id IS NULL), uses DESC, created_at DESC LIMIT ?`,
  ).all(stage, profileId, limit) as Array<{ id: string; text: string }>;
  if (rows.length > 0) {
    const touch = sqlite.prepare("UPDATE stage_notes SET uses = uses + 1, last_used_at = ? WHERE id = ?");
    const at = new Date().toISOString();
    for (const row of rows) touch.run(at, row.id);
  }
  return rows.map((row) => row.text);
}

export type LessonDecision = "approve" | "reject" | "retire" | "undo";

/**
 * Human decision on a lesson. Undo returns an approved or rejected note to proposed.
 * Editing the text is allowed only while proposed or approved; the caller passes the new text.
 */
export function decideStageNote(
  sqlite: Database.Database,
  input: { id: string; decision: LessonDecision; decidedBy: string; text?: string; now?: Date },
): { status: string } {
  const row = sqlite.prepare("SELECT id, status, text FROM stage_notes WHERE id = ?").get(input.id) as
    | { id: string; status: string; text: string }
    | undefined;
  if (!row) throw new Error("STAGE_NOTE_NOT_FOUND");
  const at = (input.now ?? new Date()).toISOString();
  const next =
    input.decision === "approve" ? "approved"
      : input.decision === "reject" ? "rejected"
        : input.decision === "retire" ? "retired"
          : "proposed";
  if (input.decision === "undo" && row.status === "proposed") throw new Error("STAGE_NOTE_NOT_DECIDED");
  const text = input.text !== undefined ? z.string().min(1).max(LESSON_TEXT_MAX).parse(input.text) : row.text;
  sqlite.prepare(
    `UPDATE stage_notes SET status = ?, text = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
  ).run(next, text, input.decision === "undo" ? null : at, input.decidedBy, input.id);
  return { status: next };
}

/**
 * Operator path (TASK-148a): the operator reads undistilled feedback and proposes notes itself.
 * Evidence must be undistilled rows of the same channel and stage. Used rows are marked distilled.
 * Never approves: the note stays `proposed` until a human decides.
 */
export function recordStageNotes(
  sqlite: Database.Database,
  input: { profileId: string | null; stage: string; notes: unknown; now?: Date },
): { proposed: number; skipped: number } {
  const proposal = StageLessonProposalSchema.parse({ notes: input.notes });
  const rows = sqlite.prepare(
    `SELECT id FROM stage_feedback WHERE profile_id IS ? AND stage = ? AND distilled_at IS NULL`,
  ).all(input.profileId, input.stage) as Array<{ id: string }>;
  const known = new Set(rows.map((row) => row.id));
  const now = (input.now ?? new Date()).toISOString();
  let proposed = 0;
  let skipped = 0;
  const tx = sqlite.transaction(() => {
    for (const note of proposal.notes) {
      const evidence = [...new Set(note.evidenceIds.filter((id) => known.has(id)))];
      if (evidence.length === 0) {
        skipped += 1;
        continue;
      }
      sqlite.prepare(
        `INSERT INTO stage_notes (id, profile_id, stage, text, evidence_ids, status, created_at, uses)
         VALUES (?, ?, ?, ?, ?, 'proposed', ?, 0)`,
      ).run(randomUUID(), input.profileId, input.stage, note.text, JSON.stringify(evidence), now);
      const mark = sqlite.prepare("UPDATE stage_feedback SET distilled_at = ? WHERE id = ?");
      for (const id of evidence) mark.run(now, id);
      proposed += 1;
    }
  });
  tx();
  return { proposed, skipped };
}
