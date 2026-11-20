import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { consumeSelfImprovementBudget } from "./autonomyBudget.js";
import { checkProposalTarget, writeProposalDraft, type ProposalDraftResult } from "./proposalWriter.js";
import { assignImpNumber } from "./toolProposals.js";

// TASK-074c-4b-3b: write the IMP-<n>.md draft for an accepted tool row. The runner (the LLM) and the root directory are
// injected, so this module makes no model call of its own and tests use a temp root.
// Order: assign number, check the target, spend llmCalls, run, write the file, then set drafted_at. A failure before the
// last step leaves the row accepted with its number kept and drafted_at NULL.
// TASK-074c-3c-1: the target check runs before the spend, so a retry against an existing file spends nothing. An
// in-process guard, keyed by the database handle and the row id, stops a second call from running while the first is
// still in the runner. The guard is per process only; it is not a database lock.

export type DraftRequest = { impNumber: number; title: string; problem: string; proposal: string };
export type DraftRunner = (request: DraftRequest) => Promise<string>;
type RefusedReason = Extract<ProposalDraftResult, { status: "refused" }>["reason"];

export type DraftResult =
  | { status: "drafted"; impNumber: number; path: string }
  | { status: "pending"; reason: "budget_limit"; impNumber: number }
  | { status: "refused"; reason: RefusedReason; impNumber: number }
  | { status: "skipped"; reason: "not_accepted" | "already_drafted" | "state_changed" | "in_flight" };

type Row = { title: string; problem: string; proposal: string; drafted_at: string | null };

const inFlight = new WeakMap<Database.Database, Set<string>>();

export async function draftProposal(
  db: Database.Database, id: string, options: { runner: DraftRunner; root: string; ensureRoot?: (root: string) => void },
): Promise<DraftResult> {
  const row = db.prepare("SELECT title, problem, proposal, drafted_at FROM improvement_requests WHERE id = ? AND kind = 'tool' AND status = 'accepted'")
    .get(id) as Row | undefined;
  if (!row) return { status: "skipped", reason: "not_accepted" };
  if (row.drafted_at !== null) return { status: "skipped", reason: "already_drafted" };

  // No await between the check and the add, so two calls in one process cannot both pass.
  let running = inFlight.get(db);
  if (!running) {
    running = new Set<string>();
    inFlight.set(db, running);
  }
  if (running.has(id)) return { status: "skipped", reason: "in_flight" };
  running.add(id);
  try {
    return await runDraft(db, id, row, options);
  } finally {
    running.delete(id);
  }
}

async function runDraft(
  db: Database.Database, id: string, row: Row, options: { runner: DraftRunner; root: string; ensureRoot?: (root: string) => void },
): Promise<DraftResult> {
  const impNumber = assignImpNumber(db, id);
  if (impNumber === null) return { status: "skipped", reason: "not_accepted" };

  // Optional hook (production creates the leaf directory). A throw is swallowed: the target check below decides.
  try {
    options.ensureRoot?.(options.root);
  } catch {
    // ignored on purpose
  }

  // Refuse before any spend when the target cannot be written (existing file, unsafe target or bad root).
  const target = checkProposalTarget(options.root, `IMP-${impNumber}.md`);
  if (target.status === "refused") return { status: "refused", reason: target.reason, impNumber };

  try {
    consumeSelfImprovementBudget(db, "llmCalls");
  } catch (error) {
    if (error instanceof AppError && error.code === "SELF_IMPROVEMENT_BUDGET_LIMIT") return { status: "pending", reason: "budget_limit", impNumber };
    throw error;
  }

  const content = await options.runner({ impNumber, title: row.title, problem: row.problem, proposal: row.proposal });
  const written = writeProposalDraft(options.root, `IMP-${impNumber}.md`, content);
  if (written.status === "refused") return { status: "refused", reason: written.reason, impNumber };

  // Conditional write: only an accepted row with no draft yet gets the marker. Zero changes means the state moved during the run.
  const now = new Date().toISOString();
  const mark = db.prepare("UPDATE improvement_requests SET drafted_at = ?, updated_at = ? WHERE id = ? AND status = 'accepted' AND drafted_at IS NULL")
    .run(now, now, id);
  if (mark.changes === 0) return { status: "skipped", reason: "state_changed" };
  return { status: "drafted", impNumber, path: written.path };
}
