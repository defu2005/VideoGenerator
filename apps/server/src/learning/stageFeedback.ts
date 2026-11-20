import { randomUUID } from "node:crypto";
import { PROTECTED_PROJECT_ID, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";

// TASK-148a: the single writer for stage_feedback. Every capture point calls this function.
// Rules: the protected project is never written; text is redacted and capped at 4 KB.

export const STAGE_FEEDBACK_KINDS = ["user_edit", "gate_reject", "gate_approve_with_edit", "swap", "agent_release"] as const;
export type StageFeedbackKind = (typeof STAGE_FEEDBACK_KINDS)[number];
export const STAGE_FEEDBACK_CAP_BYTES = 4 * 1024;
export const STAGE_FEEDBACK_RETENTION_DAYS = 180;

export type StageFeedbackInput = {
  projectId: string;
  profileId: string | null;
  stage: string;
  kind: StageFeedbackKind;
  target: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  source: string;
  now?: Date;
};

function toText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const redacted = redactExportText(raw);
  const bytes = Buffer.from(redacted, "utf8");
  if (bytes.length <= STAGE_FEEDBACK_CAP_BYTES) return redacted;
  // Over the cap: keep a valid JSON marker with the head of the value, never a cut JSON fragment.
  // Cut on a byte boundary, then drop a broken trailing UTF-8 sequence.
  let head = bytes.subarray(0, STAGE_FEEDBACK_CAP_BYTES).toString("utf8").replace(/�$/, "");
  let out = JSON.stringify({ truncated: true, bytes: bytes.length, head });
  // JSON escaping can grow the head, so shrink it until the whole marker fits the cap.
  while (Buffer.byteLength(out, "utf8") > STAGE_FEEDBACK_CAP_BYTES && head.length > 0) {
    head = head.slice(0, Math.floor(head.length * 0.9));
    out = JSON.stringify({ truncated: true, bytes: bytes.length, head });
  }
  return out;
}

/** Returns the new row id, or null when nothing was written (protected project or no change). */
export function recordStageFeedback(sqlite: Database.Database, input: StageFeedbackInput): string | null {
  if (input.projectId === PROTECTED_PROJECT_ID) return null;
  if (!STAGE_FEEDBACK_KINDS.includes(input.kind)) throw new Error(`Unknown stage feedback kind: ${input.kind}`);
  const before = toText(input.before);
  const after = toText(input.after);
  if (input.kind === "user_edit" && before !== null && before === after) return null;
  const id = randomUUID();
  sqlite.prepare(`
    INSERT INTO stage_feedback (id, created_at, project_id, profile_id, stage, kind, target, before, after, reason, source, distilled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    id,
    (input.now ?? new Date()).toISOString(),
    input.projectId,
    input.profileId,
    input.stage,
    input.kind,
    input.target,
    before,
    after,
    input.reason ? redactExportText(input.reason).slice(0, 1000) : null,
    input.source,
  );
  return id;
}

/** Deletes rows older than the retention window. Called from the existing cleanup job. */
export function pruneStageFeedback(sqlite: Database.Database, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - STAGE_FEEDBACK_RETENTION_DAYS * 86_400_000).toISOString();
  return sqlite.prepare("DELETE FROM stage_feedback WHERE created_at < ?").run(cutoff).changes;
}

/** Diffs a script save by part (title, hook, each section, outro) and records one row per changed part. */
export function captureScriptEdit(
  sqlite: Database.Database,
  input: { projectId: string; profileId: string | null; before: { title: string; hook: string; sections: unknown[]; outro: string } | null; after: { title: string; hook: string; sections: unknown[]; outro: string }; source?: string },
): number {
  if (!input.before) return 0;
  const source = input.source ?? "user";
  const base = { projectId: input.projectId, profileId: input.profileId, stage: "SCRIPT", kind: "user_edit" as const, source };
  let written = 0;
  const write = (target: string, before: unknown, after: unknown) => {
    if (recordStageFeedback(sqlite, { ...base, target, before, after })) written += 1;
  };
  write("title", input.before.title, input.after.title);
  write("hook", input.before.hook, input.after.hook);
  const max = Math.max(input.before.sections.length, input.after.sections.length);
  for (let i = 0; i < max; i++) {
    write(`section:${i + 1}`, input.before.sections[i] ?? null, input.after.sections[i] ?? null);
  }
  write("outro", input.before.outro, input.after.outro);
  return written;
}

/** Maps an authenticated actor to the feedback `source` value. API-key callers are agents or tools. */
export function feedbackSourceFor(actor: { kind?: string } | null | undefined): string {
  return actor?.kind === "apikey" ? "agent" : "user";
}

/**
 * Best-effort capture for every save path: resolves profile_id itself and never throws,
 * so a capture failure cannot fail the user's action that already succeeded.
 */
export function captureStageFeedback(
  sqlite: Database.Database,
  input: Omit<StageFeedbackInput, "profileId">,
  log?: { warn: (obj: unknown, msg: string) => void },
): string | null {
  try {
    const row = sqlite.prepare("SELECT profile_id AS profileId FROM projects WHERE id = ?").get(input.projectId) as { profileId: string | null } | undefined;
    return recordStageFeedback(sqlite, { ...input, profileId: row?.profileId ?? null });
  } catch (error) {
    log?.warn({ err: error, projectId: input.projectId }, "stage feedback capture failed");
    return null;
  }
}

/**
 * Rule (TASK-148a, advisor ruling Vòng 17): an approval counts as "approve with edit" only when the
 * channel has a user_edit row for the same stage written at or after the gate opened (the gate's
 * project_stages.updated_at when it entered WAITING_USER). Best-effort; never throws.
 */
export function captureGateApproval(
  sqlite: Database.Database,
  input: { projectId: string; gate: string; gateOpenedAt: string; source: string },
  log?: { warn: (obj: unknown, msg: string) => void },
): string | null {
  try {
    const edited = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM stage_feedback WHERE project_id = ? AND stage = ? AND kind = 'user_edit' AND created_at >= ?",
    ).get(input.projectId, input.gate, input.gateOpenedAt) as { n: number };
    if (edited.n === 0) return null;
    return captureStageFeedback(sqlite, {
      projectId: input.projectId,
      stage: input.gate,
      kind: "gate_approve_with_edit",
      target: `gate:${input.gate}`,
      source: input.source,
      reason: null,
    }, log);
  } catch (error) {
    log?.warn({ err: error, projectId: input.projectId }, "gate approval capture failed");
    return null;
  }
}
