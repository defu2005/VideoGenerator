import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AuthActor, WorkspaceFlags } from "./actor.js";
import { isWorkspaceRole, type WorkspaceRole } from "./roles.js";

export const DEFAULT_WORKSPACE_NAME = "Không gian chính";
export const DEFAULT_WORKSPACE_SLUG = "khong-gian-chinh";

/** Root tables that carry workspace_id. Child tables reach the workspace through these. */
export const WORKSPACE_ROOT_TABLES = [
  "profiles", "projects", "style_packs", "video_looks", "knowledge_entries", "webhook_endpoints",
  "assistant_conversations", "operator_conversations", "standing_orders", "operator_goals",
  "operator_preferences", "revenue_entries", "cost_entries", "payout_thresholds", "monthly_reports",
  "agents", "assistant_pending_actions",
] as const;

type Log = { info: (msg: string) => void } | undefined;

export function parseFlags(metadata: string | null | undefined): WorkspaceFlags {
  if (!metadata) return {};
  try {
    const raw = JSON.parse(metadata) as Record<string, unknown>;
    return {
      hideFinanceFromViewers: raw.hideFinanceFromViewers === true,
      adminsCanUseOperator: raw.adminsCanUseOperator === true,
      requireTwoFactor: raw.requireTwoFactor === true,
    };
  } catch {
    return {};
  }
}

export function roleOf(value: string | null | undefined): WorkspaceRole {
  const first = (value ?? "").split(",").map((part) => part.trim()).find(isWorkspaceRole);
  return first && isWorkspaceRole(first) ? first : "viewer";
}

export function defaultWorkspaceId(sqlite: Database.Database): string | null {
  const row = sqlite.prepare("SELECT id FROM organization ORDER BY created_at ASC, id ASC LIMIT 1").get() as { id: string } | undefined;
  return row?.id ?? null;
}

/** Create the default workspace (once) and put every untagged root row in it. Idempotent. */
export function ensureDefaultWorkspace(sqlite: Database.Database, ownerId: string, log?: Log): { workspaceId: string; backfilled: Record<string, number> } {
  const run = sqlite.transaction(() => {
    let workspaceId = defaultWorkspaceId(sqlite);
    if (!workspaceId) {
      workspaceId = randomUUID();
      sqlite.prepare("INSERT INTO organization (id, name, slug, created_at, metadata) VALUES (?, ?, ?, ?, ?)")
        .run(workspaceId, DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_SLUG, Date.now(), JSON.stringify({}));
    }
    const hasOwner = sqlite.prepare("SELECT 1 FROM member WHERE organization_id = ? AND user_id = ?").get(workspaceId, ownerId);
    if (!hasOwner) {
      sqlite.prepare("INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)")
        .run(randomUUID(), workspaceId, ownerId, Date.now());
    }
    const backfilled: Record<string, number> = {};
    for (const table of WORKSPACE_ROOT_TABLES) {
      const result = sqlite.prepare(`UPDATE ${table} SET workspace_id = ? WHERE workspace_id IS NULL`).run(workspaceId);
      if (result.changes > 0) backfilled[table] = result.changes;
    }
    return { workspaceId, backfilled };
  });
  const result = run();
  const total = Object.values(result.backfilled).reduce((a, b) => a + b, 0);
  if (log && total > 0) log.info(`Đã gán ${total} bản ghi vào không gian mặc định: ${JSON.stringify(result.backfilled)}`);
  return result;
}

type Membership = { workspaceId: string; role: WorkspaceRole; metadata: string | null };

export function membershipsOf(sqlite: Database.Database, userId: string): Membership[] {
  const rows = sqlite.prepare(
    `SELECT m.organization_id AS workspaceId, m.role AS role, o.metadata AS metadata
       FROM member m JOIN organization o ON o.id = m.organization_id
      WHERE m.user_id = ? ORDER BY m.created_at ASC`,
  ).all(userId) as Array<{ workspaceId: string; role: string; metadata: string | null }>;
  return rows.map((row) => ({ workspaceId: row.workspaceId, role: roleOf(row.role), metadata: row.metadata }));
}

export function grantsOf(sqlite: Database.Database, workspaceId: string, userId: string): Record<string, WorkspaceRole> {
  const rows = sqlite.prepare("SELECT profile_id AS profileId, role FROM channel_grants WHERE workspace_id = ? AND user_id = ?")
    .all(workspaceId, userId) as Array<{ profileId: string; role: string }>;
  const out: Record<string, WorkspaceRole> = {};
  for (const row of rows) out[row.profileId] = roleOf(row.role);
  return out;
}

export function buildActor(sqlite: Database.Database, input: {
  kind: AuthActor["kind"];
  userId: string;
  keyId?: string;
  membership: Membership;
}): AuthActor {
  const grants = grantsOf(sqlite, input.membership.workspaceId, input.userId);
  const ids = Object.keys(grants);
  const user = sqlite.prepare("SELECT role FROM user WHERE id = ?").get(input.userId) as { role: string | null } | undefined;
  return {
    kind: input.kind,
    userId: input.userId,
    keyId: input.keyId,
    workspaceId: input.membership.workspaceId,
    role: input.membership.role,
    channelIds: ids.length > 0 ? ids : "all",
    grants: ids.length > 0 ? grants : undefined,
    isInstanceOwner: user?.role === "owner",
    flags: parseFlags(input.membership.metadata),
  };
}

export function workspaceOwnerId(sqlite: Database.Database, workspaceId: string): string | null {
  const row = sqlite.prepare(
    "SELECT user_id AS userId FROM member WHERE organization_id = ? AND role LIKE '%owner%' ORDER BY created_at ASC LIMIT 1",
  ).get(workspaceId) as { userId: string } | undefined;
  return row?.userId ?? null;
}

/** In-process callers (scheduler, operator, autopilot, Telegram) act as the workspace owner. */
export function systemActorFor(sqlite: Database.Database, workspaceId?: string | null): AuthActor {
  const id = workspaceId ?? defaultWorkspaceId(sqlite);
  if (!id) {
    return { kind: "system", userId: "system", workspaceId: "", role: "owner", channelIds: "all", isInstanceOwner: true };
  }
  const org = sqlite.prepare("SELECT metadata FROM organization WHERE id = ?").get(id) as { metadata: string | null } | undefined;
  return {
    kind: "system",
    userId: workspaceOwnerId(sqlite, id) ?? "system",
    workspaceId: id,
    role: "owner",
    channelIds: "all",
    isInstanceOwner: true,
    flags: parseFlags(org?.metadata),
  };
}

export type ResolveFailure = { status: 404 | 409; code: string; message: string };

/** Pick the workspace for a request. `active` is the session's active organization. */
export function pickMembership(memberships: Membership[], requested: string | undefined | null): Membership | ResolveFailure {
  if (requested) {
    const found = memberships.find((item) => item.workspaceId === requested);
    return found ?? { status: 404, code: "NOT_FOUND", message: "Không tìm thấy không gian làm việc." };
  }
  if (memberships.length === 1) return memberships[0]!;
  if (memberships.length === 0) return { status: 404, code: "NOT_FOUND", message: "Bạn chưa thuộc không gian làm việc nào." };
  return { status: 409, code: "WORKSPACE_REQUIRED", message: "Chọn một không gian làm việc để tiếp tục." };
}
