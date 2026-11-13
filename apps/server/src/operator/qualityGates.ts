import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { untrustedTextHasInstructions, type ScriptGateInput } from "@vg/shared";
import { localDateString } from "@vg/shared";
import type Database from "better-sqlite3";
import { readAutonomyBudget } from "./autonomyBudget.js";
import { createUserRequest } from "./autopilot.js";

export const SILENT_MAX_VOLUME_DB = -50;

export function scriptGateInputs(sqlite: Database.Database, projectId: string): ScriptGateInput {
  const script = sqlite.prepare(
    "SELECT quality_score, blocking_facts, revise_round FROM scripts WHERE project_id = ?",
  ).get(projectId) as { quality_score: number | null; blocking_facts: number; revise_round: number } | undefined;
  const must = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM guideline_findings WHERE project_id = ? AND stage = 'SCRIPT' AND severity = 'MUST' AND status = 'OPEN'",
  ).get(projectId) as { n: number };
  const project = sqlite.prepare("SELECT profile_id, settings FROM projects WHERE id = ?").get(projectId) as
    | { profile_id: string | null; settings: string }
    | undefined;
  const goal = project?.profile_id
    ? sqlite.prepare("SELECT spec FROM operator_goals WHERE profile_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1")
      .get(project.profile_id) as { spec: string } | undefined
    : undefined;
  let minQualityScore = 7;
  const sources = [goal?.spec, project?.settings];
  for (const raw of sources) {
    if (!raw) continue;
    try {
      const spec = JSON.parse(raw) as { minQualityScore?: number; automation?: { minQualityScore?: number } };
      const value = spec.minQualityScore ?? spec.automation?.minQualityScore;
      if (typeof value === "number") minQualityScore = value;
    } catch {
      minQualityScore = 7;
    }
  }
  return {
    score: script?.quality_score ?? null,
    blockingFacts: script?.blocking_facts ?? 0,
    reviseRound: script?.revise_round ?? 0,
    guidelinePass: (must?.n ?? 0) === 0,
    minQualityScore,
  };
}

export const SCRIPT_REVISION_HEADER = "Bản trước chưa đạt. Sửa đúng các điểm sau, giữ ý chính và độ dài mục tiêu:";
const BLOCKING_NOTE_PREFIX = "blocking:";

export function blockingNote(text: string): string {
  return `${BLOCKING_NOTE_PREFIX}${text}`;
}

/** Reasons for a script rewrite. Comments and trend titles are never read. */
export function scriptRevisionFeedback(sqlite: Database.Database, projectId: string): { round: number; reasons: string[] } {
  const input = scriptGateInputs(sqlite, projectId);
  const row = sqlite.prepare("SELECT review_notes FROM scripts WHERE project_id = ?").get(projectId) as
    | { review_notes: string | null }
    | undefined;
  let notes: string[] = [];
  if (row?.review_notes) {
    try {
      const parsed = JSON.parse(row.review_notes) as unknown;
      if (Array.isArray(parsed)) notes = parsed.filter((item): item is string => typeof item === "string");
    } catch {
      notes = [];
    }
  }
  const findings = sqlite.prepare(
    "SELECT text FROM guideline_findings WHERE project_id = ? AND stage = 'SCRIPT' AND severity = 'MUST' AND status = 'OPEN'",
  ).all(projectId) as Array<{ text: string }>;
  const reasons: string[] = [];
  if (input.score != null && input.score < input.minQualityScore) {
    reasons.push(`Điểm ${input.score}/10, cần ≥ ${input.minQualityScore}`);
  }
  for (const note of notes) {
    if (note.startsWith(BLOCKING_NOTE_PREFIX)) reasons.push(note.slice(BLOCKING_NOTE_PREFIX.length).trim());
  }
  for (const finding of findings) reasons.push(finding.text);
  for (const note of notes) {
    if (!note.startsWith(BLOCKING_NOTE_PREFIX)) reasons.push(note);
  }
  const kept: string[] = [];
  let used = 0;
  for (const reason of reasons) {
    if (kept.length >= 8 || used >= 1200) break;
    if (untrustedTextHasInstructions(reason)) continue;
    const piece = reason.slice(0, 1200 - used);
    if (!piece) break;
    kept.push(piece);
    used += piece.length;
  }
  return { round: input.reviseRound, reasons: kept };
}

/** Round 0 keeps the original cache extra. A revision adds the round and a hash of the reasons. */
export function scriptCacheExtra(inputHash: string, round: number, reasons: string[]): string {
  if (round <= 0) return inputHash;
  const digest = createHash("sha256").update(reasons.join("\n")).digest("hex").slice(0, 12);
  return `${inputHash}:rev${round}:${digest}`;
}

/** One-shot hints the quality repair loop leaves for the next SCRIPT run (TASK-121). */
export type ScriptRepairHint = { stronger?: boolean; newAngle?: boolean; targetWords?: number; extraQueries?: string[] };

const hintKey = (projectId: string) => `repair.hint.${projectId}`;

export function readScriptRepairHint(sqlite: Database.Database, projectId: string): ScriptRepairHint | null {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(hintKey(projectId)) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ScriptRepairHint;
  } catch {
    return null;
  }
}

export function writeScriptRepairHint(sqlite: Database.Database, projectId: string, hint: ScriptRepairHint | null): void {
  if (!hint || Object.keys(hint).length === 0) {
    sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(hintKey(projectId));
    return;
  }
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(hintKey(projectId), JSON.stringify(hint), new Date().toISOString());
}

export function scriptRepairHintPrompt(hint: ScriptRepairHint): string {
  const lines: string[] = [];
  if (hint.newAngle) lines.push("Viết lại từ cùng nguồn nghiên cứu nhưng đổi góc tiếp cận và câu mở đầu so với bản trước.");
  if (hint.targetWords && hint.targetWords > 0) lines.push(`Độ dài mục tiêu khoảng ${Math.round(hint.targetWords)} từ lời đọc.`);
  return lines.join(" ");
}

export function scriptRepairHintDigest(hint: ScriptRepairHint): string {
  return createHash("sha256").update(JSON.stringify(hint)).digest("hex").slice(0, 10);
}

export function resetScriptReviseRound(sqlite: Database.Database, projectId: string): void {
  sqlite.prepare("UPDATE scripts SET revise_round = 0 WHERE project_id = ?").run(projectId);
}

export function recordHeld(sqlite: Database.Database, projectId: string, check: string): void {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'autonomy.heldGates'").get() as { value: string } | undefined;
  const current = row ? JSON.parse(row.value) as Array<{ projectId: string; check: string }> : [];
  const next = [...current.filter((item) => item.projectId !== projectId), { projectId, check }];
  sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('autonomy.heldGates', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify(next), new Date().toISOString());
}

export function renderGateInputs(sqlite: Database.Database, projectId: string): {
  exists: boolean;
  durationSec: number;
  targetSec: number;
  silent: boolean;
  subtitlesInSync: boolean;
  freezeSegments: number;
  blackSegments: number;
  failed: string[];
} {
  const project = sqlite.prepare("SELECT settings FROM projects WHERE id = ?").get(projectId) as { settings: string } | undefined;
  let targetSec = 0;
  if (project) {
    try {
      targetSec = Number((JSON.parse(project.settings) as { targetDurationSec?: number }).targetDurationSec ?? 0);
    } catch {
      targetSec = 0;
    }
  }
  const render = sqlite.prepare(
    "SELECT output_path, duration_sec, report FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
  ).get(projectId) as { output_path: string; duration_sec: number; report: string } | undefined;
  const failed: string[] = [];
  if (!render) {
    return { exists: false, durationSec: 0, targetSec, silent: true, subtitlesInSync: false, freezeSegments: 0, blackSegments: 0, failed: ["chưa có video"] };
  }
  const exists = existsSync(render.output_path);
  let report: { maxVolumeDb?: number | null; subtitlesInSync?: boolean; freezeSegments?: number; blackSegments?: number } = {};
  try {
    report = JSON.parse(render.report) as typeof report;
  } catch {
    report = {};
  }
  const silent = typeof report.maxVolumeDb !== "number" || report.maxVolumeDb < SILENT_MAX_VOLUME_DB;
  const subtitlesInSync = report.subtitlesInSync === true;
  const freezeSegments = report.freezeSegments ?? 0;
  const blackSegments = report.blackSegments ?? 0;
  if (!exists) failed.push("không thấy file");
  if (silent) failed.push("âm thanh im");
  if (!subtitlesInSync) failed.push("phụ đề lệch");
  if (freezeSegments > 0) failed.push("video có đoạn đứng hình");
  if (blackSegments > 0) failed.push("video có đoạn đen");
  if (targetSec > 0) {
    const ratio = render.duration_sec / targetSec;
    if (ratio < 0.85 || ratio > 1.15) failed.push("độ dài lệch");
  } else failed.push("thiếu độ dài mục tiêu");
  return { exists, durationSec: render.duration_sec, targetSec, silent, subtitlesInSync, freezeSegments, blackSegments, failed };
}

export function projectPublishFailures(sqlite: Database.Database, projectId: string): string[] {
  const failures: string[] = [];
  const meta = sqlite.prepare(
    "SELECT COUNT(*) AS n FROM guideline_findings WHERE project_id = ? AND severity = 'MUST' AND status = 'OPEN' AND stage = 'TIMELINE'",
  ).get(projectId) as { n: number };
  const project = sqlite.prepare("SELECT title, thumbnail_path FROM projects WHERE id = ?").get(projectId) as
    | { title: string; thumbnail_path: string | null }
    | undefined;
  if ((meta?.n ?? 0) > 0 || !project?.title.trim()) failures.push("metadata");
  if (!project?.thumbnail_path || !existsSync(project.thumbnail_path)) failures.push("thumbnail");
  return failures;
}

export function accountPublishFailures(sqlite: Database.Database, accountId: string, publishAt: string | null): string[] {
  const failures: string[] = [];
  if (publishAt) {
    const slot = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM publications WHERE account_id = ? AND scheduled_for = ? AND status NOT IN ('CANCELLED', 'FAILED')",
    ).get(accountId, publishAt) as { n: number };
    if ((slot?.n ?? 0) > 0) failures.push("slot");
  }
  const day = localDateString(new Date(), "Asia/Ho_Chi_Minh");
  const account = sqlite.prepare("SELECT profile_id FROM platform_accounts WHERE id = ?").get(accountId) as
    | { profile_id: string }
    | undefined;
  const cap = readAutonomyBudget(sqlite, account?.profile_id).maxPublishesPerDayPerAccount
    ?? readAutonomyBudget(sqlite).maxPublishesPerDayPerAccount;
  if (cap != null) {
    const used = sqlite.prepare(
      "SELECT COUNT(*) AS n FROM autonomy_job_claims WHERE day = ? AND account_id = ?",
    ).get(day, accountId) as { n: number };
    if ((used?.n ?? 0) >= cap) failures.push("quota");
  }
  return failures;
}

export function publishGateCheck(
  sqlite: Database.Database,
  projectId: string,
  accountId: string,
  publishAt: string | null,
): { ok: boolean; failures: string[] } {
  const failures = [...projectPublishFailures(sqlite, projectId), ...accountPublishFailures(sqlite, accountId, publishAt)];
  return { ok: failures.length === 0, failures };
}

export function flagUntrustedText(sqlite: Database.Database, dedupeKey: string, text: string): boolean {
  if (!untrustedTextHasInstructions(text)) return false;
  const at = new Date().toISOString();
  sqlite.prepare(`INSERT INTO supervisor_findings
    (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
    VALUES (?, NULL, 'untrusted_text', 'info', ?, ?, ?, ?, 'open')
    ON CONFLICT(dedupe_key) DO NOTHING`).run(
    randomUUID(), dedupeKey, JSON.stringify({ text: text.slice(0, 200) }), at, at,
  );
  return true;
}

export function notePublicationClaim(sqlite: Database.Database, input: {
  publicationId: string;
  reason: string;
}): void {
  const row = sqlite.prepare(
    `SELECT p.id, p.project_id, a.profile_id FROM publications p JOIN platform_accounts a ON a.id = p.account_id WHERE p.id = ?`,
  ).get(input.publicationId) as { id: string; project_id: string; profile_id: string } | undefined;
  if (!row) return;
  const profile = sqlite.prepare("SELECT automation FROM profiles WHERE id = ?").get(row.profile_id) as
    | { automation: string | null }
    | undefined;
  if (profile) {
    const automation = profile.automation ? JSON.parse(profile.automation) as { enabled?: boolean } : {};
    automation.enabled = false;
    sqlite.prepare("UPDATE profiles SET automation = ? WHERE id = ?").run(JSON.stringify(automation), row.profile_id);
  }
  const at = new Date().toISOString();
  sqlite.prepare(`INSERT INTO supervisor_findings
    (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
    VALUES (?, ?, 'strike', 'critical', ?, ?, ?, ?, 'open')
    ON CONFLICT(dedupe_key) DO NOTHING`).run(
    randomUUID(),
    row.profile_id,
    `strike:${input.publicationId}`,
    JSON.stringify({ publicationId: input.publicationId, reason: input.reason }),
    at,
    at,
  );
  createUserRequest(sqlite, {
    profileId: row.profile_id,
    kind: "info",
    title: "Nền tảng báo bản quyền hoặc khiếu nại",
    whyVi: `Lượt đăng bị từ chối vì ${input.reason}. Tự động hóa của hồ sơ đã tạm dừng.`,
    actionUrl: `/projects/${row.project_id}/overview`,
    dedupeKey: `strike:${input.publicationId}`,
    checkKind: "info",
  });
}
