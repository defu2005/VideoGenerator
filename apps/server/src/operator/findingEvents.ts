import type Database from "better-sqlite3";
import { publishAgentEvent } from "../events/agentBus.js";
import { defaultWorkspaceId } from "../auth/workspaces.js";

/**
 * TASK-129a: supervisor_finding is published only when a finding opens or reopens, never on every pass.
 * Call findingWillOpen BEFORE the write, then publishFindingOpened AFTER it commits.
 */
export function findingWillOpen(db: Database.Database, dedupeKey: string): boolean {
  const row = db.prepare("SELECT status FROM supervisor_findings WHERE dedupe_key = ?").get(dedupeKey) as { status: string } | undefined;
  return !row || row.status === "resolved";
}

/**
 * Scope follows the finding's profile workspace; a profile without a workspace falls back to the default workspace.
 * A finding with no profile stays global (no workspace filter), so every workspace sees it.
 */
/** Shared scope rule (TASK-149): profile's workspace, else the default workspace; no profile means no filter. */
export function workspaceForProfile(db: Database.Database, profileId: string | null): string | undefined {
  if (!profileId) return undefined;
  const row = db.prepare("SELECT workspace_id AS w FROM profiles WHERE id = ?").get(profileId) as { w: string | null } | undefined;
  return row?.w ?? (defaultWorkspaceId(db) ?? undefined);
}

export function publishFindingOpened(db: Database.Database, finding: { summary: string; profileId: string | null; projectId?: string }) {
  const workspaceId = workspaceForProfile(db, finding.profileId);
  publishAgentEvent({ type: "supervisor_finding", summary: finding.summary.slice(0, 200), ...(finding.projectId ? { projectId: finding.projectId } : {}) },
    { workspaceId });
}

/** TASK-149: budget_wait is published only when a budget reaches 100% (budget_stop), never at 80%. Guarded: a failing listener must not break the budget loop. */
export function publishBudgetWait(db: Database.Database, input: { profileId: string | null; key: "dailyUsd" | "monthlyUsd" }) {
  const period = input.key === "dailyUsd" ? "trong ngày" : "trong tháng";
  const scopeText = input.profileId ? "Ngân sách kênh" : "Ngân sách toàn ứng dụng";
  try {
    publishAgentEvent({ type: "budget_wait", summary: `${scopeText} đã đạt 100% hạn mức (${period})`.slice(0, 200) },
      { workspaceId: workspaceForProfile(db, input.profileId) });
  } catch (err) {
    console.error("[budget_wait] publish failed", err);
  }
}
