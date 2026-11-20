import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { decideStageNote, LESSON_TEXT_MAX } from "../learning/stageLessons.js";
import { stageQualityTrend } from "../learning/stageQuality.js";

const ProfileParamsSchema = z.object({ id: z.string().min(1) }).strict();
const StageQualityQuerySchema = z.object({
  stage: z.string().min(1).max(40),
  metric: z.string().min(1).max(40).optional(),
  days: z.coerce.number().int().min(1).max(90).default(14),
  profileId: z.string().min(1).nullish(),
}).strict();
const NoteParamsSchema = z.object({ id: z.string().min(1), noteId: z.string().min(1) }).strict();
const DecisionBodySchema = z.object({
  decision: z.enum(["approve", "reject", "retire", "undo"]),
  text: z.string().min(1).max(LESSON_TEXT_MAX).optional(),
}).strict();

type NoteRow = {
  id: string;
  profileId: string | null;
  stage: string;
  text: string;
  evidenceIds: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  uses: number;
  lastUsedAt: string | null;
};

/** TASK-148a/b: the channel's lessons (its own plus global), for the "Bài học theo bước" section. */
export function registerStageLessonRoutes(app: FastifyInstance, sqlite: Database.Database): void {
  app.get("/api/profiles/:id/stage-notes", async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const rows = sqlite.prepare(
      `SELECT id, profile_id AS profileId, stage, text, evidence_ids AS evidenceIds, status, created_at AS createdAt,
              decided_at AS decidedAt, decided_by AS decidedBy, uses, last_used_at AS lastUsedAt
       FROM stage_notes WHERE profile_id = ? OR profile_id IS NULL ORDER BY created_at DESC LIMIT 200`,
    ).all(id) as NoteRow[];
    return rows.map((row) => ({ ...row, evidenceIds: JSON.parse(row.evidenceIds) as string[] }));
  });

  /** TASK-148c: rolling quality trend per stage (read only). */
  app.get("/api/stage-quality/trend", async (request) => {
    const query = StageQualityQuerySchema.parse(request.query);
    return stageQualityTrend(sqlite, {
      stage: query.stage,
      metric: query.metric,
      days: query.days,
      profileId: query.profileId ?? undefined,
    });
  });

  app.post("/api/profiles/:id/stage-notes/:noteId/decision", async (request) => {
    const { id, noteId } = NoteParamsSchema.parse(request.params);
    const body = DecisionBodySchema.parse(request.body);
    const owner = sqlite.prepare("SELECT profile_id AS profileId FROM stage_notes WHERE id = ?").get(noteId) as
      | { profileId: string | null }
      | undefined;
    if (!owner) throw new AppError(404, "STAGE_NOTE_NOT_FOUND", "Stage lesson not found");
    if (owner.profileId !== null && owner.profileId !== id) throw new AppError(404, "STAGE_NOTE_NOT_FOUND", "Stage lesson not found");
    try {
      const isAgent = request.actor?.kind === "apikey";
      // Agents may only propose lessons (TASK-148a); approving or undoing is a human decision.
      if (isAgent && body.decision !== "reject") throw new AppError(403, "AGENT_CANNOT_DECIDE", "Agents may only propose or reject stage lessons.");
      const decidedBy = isAgent ? "agent" : "user";
      return decideStageNote(sqlite, { id: noteId, decision: body.decision, decidedBy, text: body.text });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "STAGE_NOTE_NOT_DECIDED") throw new AppError(409, "INVALID_PIPELINE_STATE", "Lesson has not been decided yet.");
      throw error;
    }
  });
}
