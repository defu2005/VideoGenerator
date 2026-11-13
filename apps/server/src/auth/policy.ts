import type { AuthActor } from "./actor.js";
import { WORKSPACE_ROLES, type WorkspaceRole } from "./roles.js";

export const ACTIONS = [
  "project.read", "project.write",
  "stage.run", "gate.approve",
  "publish",
  "channel.read", "channel.manage",
  "comments.reply",
  "analytics.read", "finance.read", "finance.write",
  "settings.read", "settings.write", "secrets.write",
  "members.manage", "audit.read",
  "operator.use", "automation.manage",
  "nodes.manage",
] as const;
export type Action = (typeof ACTIONS)[number];

export type PolicyResource = {
  workspaceId?: string | null;
  /** string: a channel. null: owned by the workspace, no channel. undefined: not channel-scoped. */
  profileId?: string | null;
};

export type PolicyDecision =
  | { ok: true; role: WorkspaceRole }
  | { ok: false; status: 403 | 404; reason: string };

export const FORBIDDEN_MESSAGE = "Bạn không có quyền làm việc này.";
export const NOT_FOUND_MESSAGE = "Không tìm thấy.";

const READ: Action[] = ["project.read", "channel.read", "analytics.read", "finance.read"];
const EDITOR: Action[] = [...READ, "project.write", "stage.run", "settings.read"];
const REVIEWER: Action[] = [...EDITOR, "gate.approve"];
const PUBLISHER: Action[] = [...REVIEWER, "publish", "comments.reply"];
const ADMIN: Action[] = [
  ...PUBLISHER, "channel.manage", "finance.write", "settings.write", "members.manage",
  "audit.read", "automation.manage", "nodes.manage",
];
const OWNER: Action[] = [...ADMIN, "secrets.write", "operator.use"];

/** Role × action table. The only place that says what a role may do. */
export const ROLE_ACTIONS: Record<WorkspaceRole, ReadonlySet<Action>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  publisher: new Set(PUBLISHER),
  reviewer: new Set(REVIEWER),
  editor: new Set(EDITOR),
  viewer: new Set(READ),
};

const RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, reviewer: 2, publisher: 3, admin: 4, owner: 5 };

export function lowerRole(a: WorkspaceRole, b: WorkspaceRole): WorkspaceRole {
  return RANK[a] <= RANK[b] ? a : b;
}

export function seesAllChannels(actor: AuthActor): boolean {
  return actor.channelIds === "all" || actor.role === "owner" || actor.role === "admin";
}

/** The role that applies to a channel: the workspace role lowered by that channel's grant. */
export function effectiveRole(actor: AuthActor, profileId?: string | null): WorkspaceRole {
  if (actor.role === "owner" || actor.role === "admin") return actor.role;
  const grant = profileId ? actor.grants?.[profileId] : undefined;
  return grant ? lowerRole(actor.role, grant) : actor.role;
}

function roleAllows(role: WorkspaceRole, action: Action, actor: AuthActor): boolean {
  if (action === "operator.use") {
    return role === "owner" || (role === "admin" && actor.flags?.adminsCanUseOperator === true);
  }
  if (action === "finance.read" && role === "viewer" && actor.flags?.hideFinanceFromViewers === true) return false;
  return ROLE_ACTIONS[role].has(action);
}

export function canSeeChannel(actor: AuthActor, profileId: string | null | undefined): boolean {
  if (seesAllChannels(actor)) return true;
  if (profileId === undefined) return true;
  if (profileId === null) return false;
  return (actor.channelIds as string[]).includes(profileId);
}

export function can(actor: AuthActor, action: Action, resource: PolicyResource = {}): PolicyDecision {
  if (resource.workspaceId != null && resource.workspaceId !== actor.workspaceId) {
    return { ok: false, status: 404, reason: NOT_FOUND_MESSAGE };
  }
  if (!canSeeChannel(actor, resource.profileId)) {
    return { ok: false, status: 404, reason: NOT_FOUND_MESSAGE };
  }
  const role = effectiveRole(actor, resource.profileId);
  if (!roleAllows(role, action, actor)) return { ok: false, status: 403, reason: FORBIDDEN_MESSAGE };
  return { ok: true, role };
}

/** Actions the actor may take at workspace level (the web hides buttons with this). */
export function allowedActions(actor: AuthActor): Action[] {
  return ACTIONS.filter((action) => roleAllows(actor.role, action, actor));
}

export type Scope = {
  workspaceId: string;
  profileIds: string[] | "all";
  includeUnassigned: boolean;
};

export function visibleProfileIds(actor: AuthActor): string[] | "all" {
  return seesAllChannels(actor) ? "all" : [...(actor.channelIds as string[])];
}

export function scopeFor(actor: AuthActor): Scope {
  return {
    workspaceId: actor.workspaceId,
    profileIds: visibleProfileIds(actor),
    includeUnassigned: actor.ownsUnassigned === true,
  };
}

export { WORKSPACE_ROLES };
