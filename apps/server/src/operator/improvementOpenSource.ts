import type Database from "better-sqlite3";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { consumeSelfImprovementBudget } from "./autonomyBudget.js";

// TASK-074c-3: fill `openSource` for M/L tool requests. The research runner is injected, so this module
// makes no web or LLM call on its own. Wiring a real runner must not spend `researchRuns` a second time,
// because ResearchService.run already spends one per run.

/** One open-source candidate. Only https links are kept, so a plain http link is dropped. */
export const OpenSourceItemSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().max(500).url().refine((value) => value.startsWith("https://"), "must be https"),
  licence: z.string().min(1).max(80),
  note: z.string().min(1).max(500),
});
export type OpenSourceItem = z.output<typeof OpenSourceItemSchema>;

export type OpenSourceRequest = { id: string; title: string; problem: string };
export type OpenSourceRunner = (request: OpenSourceRequest) => Promise<unknown>;

export type OpenSourceResult =
  | { status: "filled"; count: number }
  | { status: "pending"; reason: "budget_limit" | "disabled" }
  | { status: "skipped"; reason: "missing" | "already_filled" | "not_m_or_l" };

type Row = { id: string; title: string; problem: string; effort: string | null; open_source: string | null };

/** Pending means an M or L request that still has no open-source list (NULL, not an empty list). */
export function isOpenSourcePending(row: { effort: string | null; openSource: string | null }): boolean {
  return (row.effort === "M" || row.effort === "L") && row.openSource === null;
}

/**
 * Runs the injected research once for an M/L row that has no list yet.
 * A spent or disabled research budget leaves the row NULL and does not throw, so the row stays pending.
 * A runner error is rethrown; the budget is already spent by then, which is intended.
 */
export async function fillOpenSource(db: Database.Database, id: string, runner: OpenSourceRunner): Promise<OpenSourceResult> {
  const row = db.prepare("SELECT id, title, problem, effort, open_source FROM improvement_requests WHERE id = ?").get(id) as Row | undefined;
  if (!row) return { status: "skipped", reason: "missing" };
  if (row.open_source !== null) return { status: "skipped", reason: "already_filled" };
  if (row.effort !== "M" && row.effort !== "L") return { status: "skipped", reason: "not_m_or_l" };

  try {
    consumeSelfImprovementBudget(db, "researchRuns");
  } catch (error) {
    if (error instanceof AppError && error.code === "SELF_IMPROVEMENT_BUDGET_LIMIT") return { status: "pending", reason: "budget_limit" };
    if (error instanceof AppError && error.code === "SELF_IMPROVEMENT_DISABLED") return { status: "pending", reason: "disabled" };
    throw error;
  }

  const raw = await runner({ id: row.id, title: row.title, problem: row.problem });
  const items: OpenSourceItem[] = Array.isArray(raw)
    ? raw.flatMap((candidate) => {
      const parsed = OpenSourceItemSchema.safeParse(candidate);
      return parsed.success ? [parsed.data] : [];
    })
    : [];

  // The IS NULL guard keeps a concurrent fill from overwriting an existing list. If it wrote nothing, another fill won, so report that instead of "filled".
  const write = db.prepare("UPDATE improvement_requests SET open_source = ?, updated_at = ? WHERE id = ? AND open_source IS NULL")
    .run(JSON.stringify(items), new Date().toISOString(), id);
  if (write.changes === 0) return { status: "skipped", reason: "already_filled" };
  return { status: "filled", count: items.length };
}
