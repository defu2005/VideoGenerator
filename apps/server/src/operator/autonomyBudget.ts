import type Database from "better-sqlite3";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { AutonomyBudgetSchema, DEFAULT_AUTONOMY_BUDGET, localDateString, type AutonomyBudget } from "@vg/shared";
import type { UsageService } from "../services/usageService.js";

const budgetContext = new AsyncLocalStorage<() => BudgetState>();
const spendHolds = new Map<string, number>();
let holdSeq = 0;
export type BudgetState = { state: "normal" | "warn" | "stop"; retryAt: string | null };

/** Reserve estimated spend so overlapping paid calls see one another. */
export function holdAutonomyUsd(usd: number): () => void {
  const id = String(++holdSeq);
  spendHolds.set(id, usd);
  return () => { spendHolds.delete(id); };
}

export function heldAutonomyUsd(): number {
  let total = 0;
  for (const value of spendHolds.values()) total += value;
  return total;
}

export const BRAVE_IMAGE_REQUEST_USD = 0.005;

export function recordAutomaticMediaCost(sqlite: Database.Database, input: {
  profileId?: string | null;
  projectId?: string | null;
  amountUsd: number;
  note: string;
  now?: Date;
}): void {
  if (!(input.amountUsd > 0)) return;
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cost_entries'").get();
  if (!table) return;
  const now = input.now ?? new Date();
  const day = localDateString(now, "Asia/Ho_Chi_Minh");
  sqlite.prepare(`INSERT INTO cost_entries
    (id, profile_id, project_id, kind, date, amount, currency, source, note, created_at, workspace_id)
    VALUES (?, ?, ?, 'image', ?, ?, 'USD', 'auto', ?, ?,
      COALESCE((SELECT workspace_id FROM projects WHERE id = ?), (SELECT workspace_id FROM profiles WHERE id = ?), ?))`).run(
    randomUUID(), input.profileId ?? null, input.projectId ?? null, day, input.amountUsd, input.note, now.toISOString(),
    input.projectId ?? null, input.profileId ?? null, currentWorkspaceId(sqlite),
  );
}

export function runWithAutonomyBudget<T>(read: () => BudgetState, execute: () => T): T {
  return budgetContext.run(read, execute);
}

export function currentAutonomyBudget(): BudgetState | undefined {
  return budgetContext.getStore()?.();
}

export function hasAutonomySpendLimit(db: Database.Database, profileId?: string): boolean {
  const row = db.prepare(`SELECT 1 FROM app_settings WHERE key IN ('autonomy.budget', ?)
    AND (json_type(value, '$.dailyUsd') IN ('integer', 'real') OR json_type(value, '$.monthlyUsd') IN ('integer', 'real')) LIMIT 1`)
    .get(profileId ? `autonomy.budget.${profileId}` : "autonomy.budget");
  return Boolean(row);
}

function budgetKey(profileId?: string): string {
  return profileId ? `autonomy.budget.${profileId}` : "autonomy.budget";
}

export function readAutonomyBudget(db: Database.Database, profileId?: string): Partial<AutonomyBudget> {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(budgetKey(profileId)) as { value: string } | undefined;
  return row ? AutonomyBudgetSchema.partial().parse(JSON.parse(row.value)) : {};
}

export function saveAutonomyBudget(db: Database.Database, budget: Partial<AutonomyBudget>, profileId?: string): void {
  const value = AutonomyBudgetSchema.partial().parse(budget);
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(budgetKey(profileId), JSON.stringify(value), new Date().toISOString());
}

export function autonomyBudgetStatus(db: Database.Database, usage: UsageService, profileId?: string, now = new Date()) {
  const timezone = "Asia/Ho_Chi_Minh";
  const day = localDateString(now, timezone);
  const appLimits = { ...DEFAULT_AUTONOMY_BUDGET, ...readAutonomyBudget(db) };
  const scopes = [{ profileId: null as string | null, limits: appLimits, spend: usage.getAutomationSpend(day, timezone) }];
  if (profileId) {
    scopes.push({
      profileId,
      limits: { ...appLimits, ...readAutonomyBudget(db, profileId) },
      spend: usage.getAutomationSpend(day, timezone, profileId),
    });
  }
  let retryAt: string | null = null;
  const ratio = Math.max(0, ...scopes.flatMap(({ limits, spend }) => (["dailyUsd", "monthlyUsd"] as const).map((key) => {
    const limit = limits[key];
    const fraction = limit === null ? 0 : limit === 0 ? Infinity : (spend[key] + heldAutonomyUsd()) / limit;
    if (fraction >= 1) {
      const [year, month, date] = day.split("-").map(Number) as [number, number, number];
      // The existing operator budget calendar uses Vietnam local time (UTC+07).
      const boundary = new Date(key === "dailyUsd" ? Date.UTC(year, month - 1, date + 1, -7)
        : Date.UTC(year, month, 1, -7)).toISOString();
      if (!retryAt || boundary > retryAt) retryAt = boundary;
    }
    return fraction;
  })));
  const state: BudgetState["state"] = ratio >= 1 ? "stop" : ratio >= 0.8 ? "warn" : "normal";
  return { day, state, retryAt, scopes };
}

export function recordBudgetFindings(db: Database.Database, status: ReturnType<typeof autonomyBudgetStatus>, now: Date) {
  if (status.state === "normal") return [];
  const insert = db.prepare(`INSERT INTO supervisor_findings
    (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
    VALUES (?, ?, ?, 'warn', ?, ?, ?, ?, 'open') ON CONFLICT(dedupe_key) DO NOTHING`);
  const findings: { id: string; profileId: string | null; message: string }[] = [];
  for (const scope of status.scopes) {
    for (const key of ["dailyUsd", "monthlyUsd"] as const) {
      const limit = scope.limits[key];
      if (limit === null || scope.spend[key] < 0.8 * limit) continue;
      const stop = scope.spend[key] >= limit;
      const kind = stop ? "budget_stop" : "budget_warn";
      const period = key === "dailyUsd" ? status.day : status.day.slice(0, 7);
      const dedupe = `${kind}:${scope.profileId ?? "app"}:${period}`;
      const id = randomUUID();
      const message = `Mức chi ${key === "dailyUsd" ? "trong ngày" : "trong tháng"} đạt ${stop ? "100%" : "80%"} hạn mức.`;
      const at = now.toISOString();
      if (insert.run(id, scope.profileId, kind, dedupe, JSON.stringify({ period, limit, spent: scope.spend[key], message }), at, at).changes) {
        findings.push({ id, profileId: scope.profileId, message });
      }
    }
  }
  return findings;
}
