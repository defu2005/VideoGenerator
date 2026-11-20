import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { containsProtectedProject, redactExportText } from "@vg/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { consumeSelfImprovementBudget, selfImprovementBudgetStatus } from "./autonomyBudget.js";
import { effectiveImprovementRequestLimit, improvementSelfTuneStats } from "./improvementSelfTune.js";

const JsonObjectSchema = z.record(z.string(), z.json()).refine((value) => value.type === "object",
  "Schema phải khai báo type object.");
export const ToolProposalArgs = z.object({
  kind: z.enum(["internal", "external_mcp"]),
  name: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
  operation: z.string().trim().min(8).max(500),
  reproduction: z.string().trim().min(8).max(1000),
  impact: z.string().trim().min(8).max(500),
  inputSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema,
  permissions: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  dataSent: z.string().trim().min(2).max(500),
  requiresConfirmation: z.boolean(),
  acceptance: z.array(z.string().trim().min(5).max(300)).min(1).max(6),
  sourceUrl: z.url({ protocol: /^https$/ }).optional(),
}).strict().refine((value) => value.kind !== "external_mcp" || Boolean(value.sourceUrl), "MCP bên ngoài cần URL nguồn.");

type Proposal = z.output<typeof ToolProposalArgs>;

/** TASK-074c-1: tool requests live in improvement_requests (kind = 'tool'). The original internal/external kind stays in the fingerprint and the stored proposal. */
function toolFingerprint(kind: string, name: string): string {
  return `tool:${kind}:${name}`;
}

const MAX_EVIDENCE = 10;

/** TASK-074c-2: a repeat adds one evidence entry and only the latest MAX_EVIDENCE are kept. Stored evidence that is not an array is replaced. */
function mergeEvidence(stored: string, proposal: Proposal): string {
  let list: unknown[] = [];
  try {
    const parsedStored: unknown = JSON.parse(stored);
    if (Array.isArray(parsedStored)) list = parsedStored;
  } catch {
    list = [];
  }
  return JSON.stringify([...list, { type: "error", ref: "propose_missing_tool", note: proposal.reproduction }].slice(-MAX_EVIDENCE));
}

export function recordToolProposal(
  db: Database.Database, proposal: Proposal, registry: ReadonlySet<string>,
): { status: "existing_tool" | "duplicate" | "proposed"; id?: string; name: string } {
  if (registry.has(proposal.name)) return { status: "existing_tool", name: proposal.name };
  const json = JSON.stringify(proposal);
  if (json.length > 12_000 || containsProtectedProject(proposal) || redactExportText(json) !== json
      || (proposal.sourceUrl && (new URL(proposal.sourceUrl).username || new URL(proposal.sourceUrl).password))) {
    throw new AppError(400, "INVALID_TOOL_PROPOSAL", "Đề xuất chứa dữ liệu nhạy cảm hoặc vượt giới hạn.");
  }
  return db.transaction(() => {
    const fingerprint = toolFingerprint(proposal.kind, proposal.name);
    const open = db.prepare("SELECT id, evidence, status, proposal FROM improvement_requests WHERE kind = 'tool' AND fingerprint = ? AND status IN ('open', 'accepted', 'in_progress')")
      .get(fingerprint) as { id: string; evidence: string; status: string; proposal: string } | undefined;
    if (open) {
      const now = new Date().toISOString();
      // TASK-074c-2 fix2: an open row whose stored proposal does not parse is hidden from the list, so a valid repeat repairs it in place.
      if (open.status === "open" && !parseLegacyDetails(open.proposal)) {
        db.prepare("UPDATE improvement_requests SET weight = weight + 1, evidence = ?, proposal = ?, problem = ?, acceptance = ?, updated_at = ? WHERE id = ?")
          .run(mergeEvidence(open.evidence, proposal), json, proposal.reproduction, JSON.stringify(proposal.acceptance), now, open.id);
      } else {
        db.prepare("UPDATE improvement_requests SET weight = weight + 1, evidence = ?, updated_at = ? WHERE id = ?")
          .run(mergeEvidence(open.evidence, proposal), now, open.id);
      }
      return { status: "duplicate", id: open.id, name: proposal.name } as const;
    }
    // TASK-074c-5a: the halved limit is derived on each call and never stored. The user's own limit still bounds it.
    const budgetNow = new Date();
    const budget = selfImprovementBudgetStatus(db, budgetNow);
    const userLimit = budget.limits.improvementRequests;
    const limit = effectiveImprovementRequestLimit(userLimit, improvementSelfTuneStats(db));
    try {
      consumeSelfImprovementBudget(db, "improvementRequests", { limit, now: budgetNow });
    } catch (error) {
      if (error instanceof AppError && error.code === "SELF_IMPROVEMENT_BUDGET_LIMIT") {
        // TASK-074c-5c: name the halved limit only when halving is what refused the call. Otherwise the old message stays byte-identical.
        const used = budget.used.improvementRequests ?? 0;
        if (limit < userLimit && used < userLimit) {
          throw new AppError(429, "TOOL_PROPOSAL_LIMIT",
            `Đã đạt giới hạn đề xuất công cụ trong ngày. Hạn mức hôm nay đã được hạ xuống còn ${limit} vì tỉ lệ đề xuất được chấp nhận dưới 30%; người dùng đặt ${userLimit}.`,
            { halved: true, userLimit, effectiveLimit: limit });
        }
        throw new AppError(429, "TOOL_PROPOSAL_LIMIT", "Đã đạt giới hạn đề xuất công cụ trong ngày.");
      }
      throw error;
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const evidence = JSON.stringify([{ type: "error", ref: "propose_missing_tool", note: proposal.reproduction }]);
    db.prepare(`INSERT INTO improvement_requests
      (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
      VALUES (?, 'tool', ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?)`)
      .run(id, proposal.name, proposal.reproduction, json, evidence, JSON.stringify(proposal.acceptance), fingerprint, now, now);
    return { status: "proposed", id, name: proposal.name } as const;
  }).immediate();
}

/** TASK-074c-1 fix1: one bad stored row is skipped and warned, so it cannot break the whole list. */
export function listToolProposals(db: Database.Database, logger?: { warn: (obj: unknown, msg?: string) => void }) {
  const rows = db.prepare(
    "SELECT id, proposal, created_at FROM improvement_requests WHERE kind = 'tool' AND status = 'open' ORDER BY created_at DESC, id LIMIT 50",
  ).all() as StoredToolRow[];
  return toListedProposals(rows, logger);
}

/** TASK-074c-4b-2: read-only list of accepted tool rows. Same item shape, order, cap and skip rule as the open list. No transition here. */
export function listAcceptedToolProposals(db: Database.Database, logger?: { warn: (obj: unknown, msg?: string) => void }) {
  const rows = db.prepare(
    "SELECT id, proposal, created_at, imp_number, drafted_at FROM improvement_requests WHERE kind = 'tool' AND status = 'accepted' ORDER BY created_at DESC, id LIMIT 50",
  ).all() as AcceptedToolRow[];
  const markers = new Map(rows.map((row) => [row.id, { impNumber: row.imp_number, draftedAt: row.drafted_at }]));
  return toListedProposals(rows, logger).map((item) => ({
    ...item,
    impNumber: markers.get(item.id)?.impNumber ?? null,
    draftedAt: markers.get(item.id)?.draftedAt ?? null,
  }));
}

/** TASK-074c-6b: read-only list of in_progress tool rows. Same item shape, order, cap and skip rule as the accepted list. No transition here. */
export function listInProgressToolProposals(db: Database.Database, logger?: { warn: (obj: unknown, msg?: string) => void }) {
  const rows = db.prepare(
    "SELECT id, proposal, created_at, imp_number, drafted_at FROM improvement_requests WHERE kind = 'tool' AND status = 'in_progress' ORDER BY created_at DESC, id LIMIT 50",
  ).all() as AcceptedToolRow[];
  const markers = new Map(rows.map((row) => [row.id, { impNumber: row.imp_number, draftedAt: row.drafted_at }]));
  return toListedProposals(rows, logger).map((item) => ({
    ...item,
    impNumber: markers.get(item.id)?.impNumber ?? null,
    draftedAt: markers.get(item.id)?.draftedAt ?? null,
  }));
}

/**
 * TASK-074c-6g: read-only list of done tool rows, with the task_ref that check-done stored. Same item shape and skip rule as the
 * in-progress list, plus taskRef. Newest first by updated_at, since a row's done time is when it moved, not when it was created.
 * No transition here. The other lists stay as they are and carry no taskRef.
 */
export function listDoneToolProposals(db: Database.Database, logger?: { warn: (obj: unknown, msg?: string) => void }) {
  const rows = db.prepare(
    "SELECT id, proposal, created_at, imp_number, drafted_at, task_ref FROM improvement_requests WHERE kind = 'tool' AND status = 'done' ORDER BY updated_at DESC, id LIMIT 50",
  ).all() as DoneToolRow[];
  const markers = new Map(rows.map((row) => [row.id, { impNumber: row.imp_number, draftedAt: row.drafted_at, taskRef: row.task_ref }]));
  return toListedProposals(rows, logger).map((item) => ({
    ...item,
    impNumber: markers.get(item.id)?.impNumber ?? null,
    draftedAt: markers.get(item.id)?.draftedAt ?? null,
    taskRef: markers.get(item.id)?.taskRef ?? null,
  }));
}

type StoredToolRow = { id: string; proposal: string; created_at: string };
type AcceptedToolRow = StoredToolRow & { imp_number: number | null; drafted_at: string | null };
type DoneToolRow = AcceptedToolRow & { task_ref: string | null };

function toListedProposals(rows: StoredToolRow[], logger?: { warn: (obj: unknown, msg?: string) => void }) {
  const listed: Array<z.output<typeof ToolProposalArgs> & { id: string; createdAt: string }> = [];
  for (const row of rows) {
    const parsed = parseLegacyDetails(row.proposal);
    if (!parsed) {
      (logger ?? console).warn({ id: row.id }, "Skipped an improvement request whose stored proposal is not valid JSON or fails the schema.");
      continue;
    }
    listed.push({ id: row.id, ...parsed, createdAt: row.created_at });
  }
  return listed;
}

export function dismissToolProposal(db: Database.Database, id: string): void {
  db.prepare("UPDATE improvement_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND kind = 'tool' AND status = 'open'")
    .run(new Date().toISOString(), id);
}

/** TASK-074c-4b-1: the user's accept. Only an open tool row moves; anything else is a silent no-op, like dismiss. */
export function acceptToolProposal(db: Database.Database, id: string): void {
  db.prepare("UPDATE improvement_requests SET status = 'accepted', updated_at = ? WHERE id = ? AND kind = 'tool' AND status = 'open'")
    .run(new Date().toISOString(), id);
}

/**
 * TASK-074c-6a: the user marks a drafted accepted tool row as in progress. Only a row with a draft (drafted_at set) moves,
 * so a draft still running cannot lose its marker. Silent no-op otherwise, like accept.
 */
export function startToolProposal(db: Database.Database, id: string): void {
  db.prepare("UPDATE improvement_requests SET status = 'in_progress', updated_at = ? WHERE id = ? AND kind = 'tool' AND status = 'accepted' AND drafted_at IS NOT NULL")
    .run(new Date().toISOString(), id);
}

/** TASK-074c-6e: the TASK-… name the user gives when a task is confirmed done. It must match the .done file name exactly. */
export const ToolProposalTaskRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/);

/**
 * TASK-074c-6e: the user's check that the task behind an in_progress tool row is done. The .done file with that exact name must
 * exist under tasksRoot (existence only, nothing is read). The name is checked before any path is built, so it cannot leave tasksRoot.
 * Only an in_progress tool row moves to done, and task_ref is stored in the same UPDATE. Any other row is refused and left as it is.
 * TASK-074c-5e: done_at is set in that same UPDATE, to the same timestamp as updated_at.
 */
export function checkToolProposalDone(db: Database.Database, id: string, task: string, tasksRoot: string): void {
  const name = ToolProposalTaskRef.parse(task);
  if (!existsSync(join(tasksRoot, `${name}.done`))) {
    throw new AppError(409, "OPERATOR_TASK_NOT_DONE", "Chưa có file .done cho task này.");
  }
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE improvement_requests SET task_ref = ?, status = 'done', updated_at = ?, done_at = ? WHERE id = ? AND kind = 'tool' AND status = 'in_progress'")
    .run(name, now, now, id);
  if (result.changes === 0) throw new AppError(409, "OPERATOR_TOOL_PROPOSAL_NOT_IN_PROGRESS", "Đề xuất này không ở trạng thái đang làm.");
}

/**
 * TASK-074c-4b-3a: the stable IMP number of an accepted tool row. Assigned once, at first use; a repeat returns the stored number.
 * Only an accepted tool row gets one. MAX+1 is safe because nothing deletes improvement_requests rows (checked 2026-11-20).
 */
export function assignImpNumber(db: Database.Database, id: string): number | null {
  return db.transaction(() => {
    const row = db.prepare("SELECT imp_number FROM improvement_requests WHERE id = ? AND kind = 'tool' AND status = 'accepted'")
      .get(id) as { imp_number: number | null } | undefined;
    if (!row) return null;
    if (row.imp_number !== null) return row.imp_number;
    const { next } = db.prepare("SELECT COALESCE(MAX(imp_number), 0) + 1 AS next FROM improvement_requests").get() as { next: number };
    db.prepare("UPDATE improvement_requests SET imp_number = ? WHERE id = ?").run(next, id);
    return next;
  }).immediate();
}

function parseLegacyDetails(details: string): z.output<typeof ToolProposalArgs> | null {
  try {
    const parsed = ToolProposalArgs.safeParse(JSON.parse(details));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * TASK-074c-1: idempotent copy of operator_tool_proposals into improvement_requests.
 * Keyed on the old id with INSERT OR IGNORE, so repeated runs add nothing and a row the user rejected stays rejected.
 * The old table is left as it is. Rows that do not parse or have an unknown status are skipped and counted.
 */
export function copyLegacyToolProposals(db: Database.Database): { copied: number; skipped: number } {
  const legacy = db.prepare("SELECT id, kind, name, details, status, created_at FROM operator_tool_proposals")
    .all() as Array<{ id: string; kind: string; name: string; details: string; status: string; created_at: string }>;
  const insert = db.prepare(`INSERT OR IGNORE INTO improvement_requests
    (id, kind, title, problem, proposal, evidence, acceptance, status, weight, fingerprint, created_at, updated_at)
    VALUES (?, 'tool', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
  return db.transaction(() => {
    let copied = 0;
    let skipped = 0;
    for (const row of legacy) {
      const status = row.status === "pending" ? "open" : row.status === "dismissed" ? "rejected" : null;
      const parsed = parseLegacyDetails(row.details);
      if (!status || !parsed) {
        skipped += 1;
        continue;
      }
      const evidence = JSON.stringify([{ type: "error", ref: `operator_tool_proposals:${row.id}`, note: parsed.reproduction }]);
      const result = insert.run(row.id, parsed.name, parsed.reproduction, row.details, evidence,
        JSON.stringify(parsed.acceptance), status, toolFingerprint(row.kind, row.name), row.created_at, row.created_at);
      copied += result.changes;
    }
    return { copied, skipped };
  })();
}

/** TASK-074c-5e-2a-1: one verdict per acceptance item, in acceptance order. Stored as JSON in acceptance_result. */
export const AcceptanceVerdict = z.enum(["passed", "failed", "not_checkable"]);
export const AcceptanceResults = z.array(z.object({ verdict: AcceptanceVerdict }).strict()).min(1).max(6);

/**
 * TASK-074c-5e-2a-1 (storage only): records the acceptance verdicts of a done tool row. Writes only acceptance_result and
 * acceptance_checked_at. The conditional UPDATE is the guard: kind = 'tool', status = 'done', acceptance_result IS NULL.
 * A refusal is classified only after the UPDATE changed nothing, so no JS check repeats those guards.
 * The result count must equal the number of acceptance items in proposal (not the acceptance column).
 */
export function recordAcceptanceResult(db: Database.Database, id: string, results: unknown): void {
  const parsed = AcceptanceResults.safeParse(results);
  if (!parsed.success) throw new AppError(400, "INVALID_ACCEPTANCE_RESULT", "Kết quả kiểm không hợp lệ.");
  const row = db.prepare("SELECT proposal FROM improvement_requests WHERE id = ?").get(id) as { proposal: string } | undefined;
  if (!row) throw new AppError(404, "NOT_FOUND", "Không tìm thấy đề xuất này.");
  let acceptanceCount: number;
  try {
    acceptanceCount = ToolProposalArgs.parse(JSON.parse(row.proposal)).acceptance.length;
  } catch {
    throw new AppError(409, "OPERATOR_TOOL_PROPOSAL_UNREADABLE", "Không đọc được nội dung đề xuất.");
  }
  if (parsed.data.length !== acceptanceCount) {
    throw new AppError(409, "OPERATOR_ACCEPTANCE_MISMATCH", "Số kết quả kiểm không khớp số tiêu chí chấp nhận.");
  }
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE improvement_requests SET acceptance_result = ?, acceptance_checked_at = ? WHERE id = ? AND kind = 'tool' AND status = 'done' AND acceptance_result IS NULL")
    .run(JSON.stringify(parsed.data), now, id);
  if (result.changes === 1) return;
  const current = db.prepare("SELECT kind, status, acceptance_result FROM improvement_requests WHERE id = ?")
    .get(id) as { kind: string; status: string; acceptance_result: string | null } | undefined;
  if (!current || current.kind !== "tool") throw new AppError(404, "NOT_FOUND", "Không tìm thấy đề xuất này.");
  if (current.status !== "done") throw new AppError(409, "OPERATOR_TOOL_PROPOSAL_NOT_DONE", "Đề xuất này chưa hoàn thành.");
  throw new AppError(409, "OPERATOR_ACCEPTANCE_ALREADY_RECORDED", "Đề xuất này đã có kết quả kiểm.");
}
