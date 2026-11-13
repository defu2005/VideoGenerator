import type { WorkspaceRole } from "./roles.js";

export type WorkspaceFlags = {
  hideFinanceFromViewers?: boolean;
  adminsCanUseOperator?: boolean;
  /** Owners and admins must have two-factor on before they can use anything but the account page. */
  requireTwoFactor?: boolean;
};

export type AuthActor = {
  kind: "user" | "apikey" | "system";
  userId: string;
  keyId?: string;
  workspaceId: string;
  role: WorkspaceRole;
  /** Channels the actor may see: every channel, or only the granted ones. */
  channelIds: string[] | "all";
  /** Per-channel role from a grant. The effective role is never higher than `role`. */
  grants?: Record<string, WorkspaceRole>;
  isInstanceOwner: boolean;
  flags?: WorkspaceFlags;
  /** True when rows with a NULL workspace_id (legacy or just created without a request) count as this workspace's. */
  ownsUnassigned?: boolean;
};
