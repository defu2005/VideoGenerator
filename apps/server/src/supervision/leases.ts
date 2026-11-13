import type Database from "better-sqlite3";
import { publishAgentEvent } from "../events/agentBus.js";

export const LEASE_TTL_MS = 10 * 60 * 1000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type ResourceKind = "project" | "profile_automation" | "publication" | "account" | "operator_run" | "duty";
export type ResourceRef = { kind: ResourceKind; id: string };

/** user > Hermes on duty > other Hermes > everything else (operator, Codex, Cursor...). */
export const RANK = { user: 40, hermesDuty: 30, hermes: 20, other: 10 } as const;

export type LeaseHolder = { kind: string; instance: string; rank: number; runId?: string | null };

type Spec = { kind: ResourceKind; arg: string } | "global";
const project = (arg = "projectId"): Spec => ({ kind: "project", arg });
const profile = (arg = "profileId"): Spec => ({ kind: "profile_automation", arg });

/**
 * Every tool that changes something is listed here: the object it changes, or "global" (no single object).
 * `supervision.test.ts` fails when a mutating tool is missing, so a new tool must pick one.
 */
export const RESOURCE_MAP: Record<string, Spec> = {
  update_stage_timeouts: project(), run_pipeline: project(), approve_gate: project(), repair_script: project(),
  repair_scene: project(), repair_render_stage: project(), publish_project: project(), make_shorts: project(),
  make_translation: project(), research_scene_visuals: project(), crop_scene_images: project(), dedupe_scene_visuals: project(),
  delete_project: project(), apply_review_proposal: project(), undo_timeline_edit: project(),
  update_profile_direction: profile(), set_profile_automation: profile(), add_topic: profile(), approve_topics: profile(),
  reject_topics: profile(), delete_topic: profile(), add_trend_topic: profile(), run_insight: profile(), apply_insight: profile(),
  suggest_topics: profile(), set_style_pack: profile(), propose_style_pack: profile(), create_project: profile(),
  cancel_publication: { kind: "publication", arg: "publicationId" },
  add_revenue_entry: { kind: "account", arg: "accountId" },
  operator_stop_run: { kind: "operator_run", arg: "runId" },
  decide_overdue: "global", pause_automation_all: "global", resume_automation_all: "global", propose_models: "global",
  update_notification_toggles: "global", apply_models: "global", update_llm_settings: "global", clear_llm_cooldown: "global",
  reply_comment: "global", hide_comment: "global", request_user_action: "global", claim_skill_run: "global",
  propose_skill: "global", save_skill_report: "global", complete_skill_report: "global", import_skill_reports: "global",
  propose_missing_tool: "global", computer_act: "global", set_node_drain: "global", propose_route_change: "global",
  apply_routing_proposal: "global", update_omniroute_combos: "global", mark_change_reviewed: "global",
  omniroute_test_provider: "global", omniroute_set_provider_state: "global", omniroute_upsert_combo: "global",
  omniroute_delete_combo: "global", propose_knowledge_change: "global", import_knowledge: "global",
  resolve_change_event: "global", report_change: "global",
  hermes_duty_heartbeat: "global", operator_pause: "global", operator_resume: "global", operator_new_session: "global",
  operator_enqueue: "global", operator_order_upsert: "global", operator_order_disable: "global", operator_override: "global",
  escalation_claim: "global", escalation_resolve: "global", escalation_forward_to_user: "global", notify_user: "global",
};

/** The object a tool call changes, or null when it is global or not a known writer. */
export function resourceOf(toolName: string, args: unknown): ResourceRef | null {
  const spec = RESOURCE_MAP[toolName];
  if (!spec || spec === "global") return null;
  const id = (args as Record<string, unknown> | null)?.[spec.arg];
  return typeof id === "string" && id ? { kind: spec.kind, id } : null;
}

export function holderRank(kind: string, onDuty: boolean): number {
  if (kind === "user") return RANK.user;
  if (kind === "hermes") return onDuty ? RANK.hermesDuty : RANK.hermes;
  return RANK.other;
}

export type LeaseRow = {
  resourceKind: string; resourceId: string; holderKind: string; holderInstance: string; rank: number;
  fence: number; runId: string | null; acquiredAt: string; expiresAt: string; preemptedBy: string | null;
};

type RawLease = {
  resource_kind: string; resource_id: string; holder_kind: string; holder_instance: string; rank: number;
  fence: number; run_id: string | null; acquired_at: string; expires_at: string; preempted_by: string | null;
};
const toRow = (r: RawLease): LeaseRow => ({
  resourceKind: r.resource_kind, resourceId: r.resource_id, holderKind: r.holder_kind, holderInstance: r.holder_instance,
  rank: r.rank, fence: r.fence, runId: r.run_id, acquiredAt: r.acquired_at, expiresAt: r.expires_at, preemptedBy: r.preempted_by,
});

export type AcquireResult =
  | { ok: true; fence: number; preempted?: { holderInstance: string; runId: string | null } }
  | { ok: false; code: "LEASED"; holder: { kind: string; instance: string; rank: number; expiresAt: string; fence: number } };

const lossKey = (runId: string) => `lease.lost.${runId}`;

/** One transaction: take a free or expired lease, renew your own, or preempt a lower rank. Equal or higher rank holds. */
export function acquireLease(
  sqlite: Database.Database, ref: ResourceRef, holder: LeaseHolder, now = new Date(),
): AcquireResult {
  const nowIso = now.toISOString();
  const expires = new Date(now.getTime() + LEASE_TTL_MS).toISOString();
  let preempted: { holderInstance: string; runId: string | null } | undefined;
  const result = sqlite.transaction((): AcquireResult => {
    const row = sqlite.prepare("SELECT * FROM agent_leases WHERE resource_kind = ? AND resource_id = ?")
      .get(ref.kind, ref.id) as RawLease | undefined;
    if (!row) {
      sqlite.prepare(`INSERT INTO agent_leases (resource_kind, resource_id, holder_kind, holder_instance, rank, fence, run_id, acquired_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(ref.kind, ref.id, holder.kind, holder.instance, holder.rank, holder.runId ?? null, nowIso, expires);
      return { ok: true, fence: 1 };
    }
    const same = row.holder_instance === holder.instance;
    const live = row.expires_at > nowIso;
    if (live && !same && holder.rank <= row.rank) {
      return { ok: false, code: "LEASED", holder: { kind: row.holder_kind, instance: row.holder_instance, rank: row.rank, expiresAt: row.expires_at, fence: row.fence } };
    }
    const takeover = !same;
    const fence = takeover ? row.fence + 1 : row.fence;
    const by = live && takeover ? holder.instance : null;
    sqlite.prepare(`UPDATE agent_leases SET holder_kind = ?, holder_instance = ?, rank = ?, fence = ?, run_id = ?,
      acquired_at = CASE WHEN ? THEN ? ELSE acquired_at END, expires_at = ?, preempted_by = ?
      WHERE resource_kind = ? AND resource_id = ?`).run(
      holder.kind, holder.instance, holder.rank, fence, holder.runId ?? null, takeover ? 1 : 0, nowIso, expires, by, ref.kind, ref.id,
    );
    if (live && takeover) preempted = { holderInstance: row.holder_instance, runId: row.run_id };
    return { ok: true, fence, ...(preempted ? { preempted } : {}) };
  })();
  if (preempted) {
    if (preempted.runId) {
      sqlite.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(
        lossKey(preempted.runId), JSON.stringify({ by: holder.instance, kind: holder.kind, resource: `${ref.kind}:${ref.id}` }), nowIso);
    }
    publishAgentEvent({
      type: "lease.preempted",
      summary: `${holder.instance} tiếp quản ${ref.kind} ${ref.id} từ ${preempted.holderInstance}.`,
      ...(ref.kind === "project" ? { projectId: ref.id } : {}),
    });
  }
  return result;
}

/** The operator run that lost a lease reads this once at its next step. */
export function takeLeaseLoss(sqlite: Database.Database, runId: string): { by: string; kind: string; resource: string } | null {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(lossKey(runId)) as { value: string } | undefined;
  if (!row) return null;
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(lossKey(runId));
  try { return JSON.parse(row.value) as { by: string; kind: string; resource: string }; } catch { return { by: "?", kind: "?", resource: "?" }; }
}

export function getLease(sqlite: Database.Database, ref: ResourceRef, now = new Date()): LeaseRow | null {
  const row = sqlite.prepare("SELECT * FROM agent_leases WHERE resource_kind = ? AND resource_id = ? AND expires_at > ?")
    .get(ref.kind, ref.id, now.toISOString()) as RawLease | undefined;
  return row ? toRow(row) : null;
}

export function listLiveLeases(sqlite: Database.Database, now = new Date()): LeaseRow[] {
  return (sqlite.prepare("SELECT * FROM agent_leases WHERE expires_at > ? ORDER BY acquired_at DESC").all(now.toISOString()) as RawLease[]).map(toRow);
}

export function releaseLeasesOfRun(sqlite: Database.Database, instance: string, runId?: string | null): number {
  return runId
    ? sqlite.prepare("DELETE FROM agent_leases WHERE holder_instance = ? AND run_id = ?").run(instance, runId).changes
    : sqlite.prepare("DELETE FROM agent_leases WHERE holder_instance = ?").run(instance).changes;
}

/**
 * A user action always wins: the lease goes to the user, the previous holder is told through the event bus.
 * Returns the holder that was displaced, if any.
 */
export function userBreakLease(sqlite: Database.Database, ref: ResourceRef, now = new Date()): string | null {
  const live = getLease(sqlite, ref, now);
  if (!live || live.holderKind === "user") return null;
  const result = acquireLease(sqlite, ref, { kind: "user", instance: "user", rank: RANK.user }, now);
  // The user lease is only a marker for this instant; drop it so the object is free again.
  sqlite.prepare("DELETE FROM agent_leases WHERE resource_kind = ? AND resource_id = ? AND holder_instance = 'user'").run(ref.kind, ref.id);
  return result.ok ? live.holderInstance : null;
}

export function purgeExpiredLeases(sqlite: Database.Database, now = new Date()): number {
  return sqlite.prepare("DELETE FROM agent_leases WHERE expires_at <= ?").run(now.toISOString()).changes;
}

/** Idempotency: the same agent instance repeating a key within 24 hours gets the stored result. */
export function readIdempotent(sqlite: Database.Database, instance: string, key: string, now = new Date()): { result: unknown } | null {
  sqlite.prepare("DELETE FROM agent_idempotency WHERE created_at < ?").run(new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString());
  const row = sqlite.prepare("SELECT result FROM agent_idempotency WHERE instance = ? AND key = ?").get(instance, key) as { result: string } | undefined;
  return row ? { result: JSON.parse(row.result) } : null;
}

export function writeIdempotent(sqlite: Database.Database, instance: string, key: string, tool: string, result: unknown, now = new Date()): void {
  sqlite.prepare("INSERT OR IGNORE INTO agent_idempotency (instance, key, tool, result, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(instance, key, tool, JSON.stringify(result ?? null), now.toISOString());
}
