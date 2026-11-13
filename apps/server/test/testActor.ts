import type { AuthActor } from "../src/auth/actor.js";
import type { WorkspaceFlags } from "../src/auth/actor.js";
import type { WorkspaceRole } from "../src/auth/roles.js";

export const TEST_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000a1";
export const TEST_OTHER_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000a2";

/** Fixed actor for existing API tests: owner of the default workspace, sees every channel. */
export const testActor: AuthActor = {
  kind: "user",
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: TEST_WORKSPACE_ID,
  role: "owner",
  channelIds: "all",
  isInstanceOwner: true,
};

/** An actor with any role, workspace and channel grants (grants map profileId to its role). */
export function actorWith(input: {
  role: WorkspaceRole;
  workspaceId?: string;
  userId?: string;
  grants?: Record<string, WorkspaceRole>;
  flags?: WorkspaceFlags;
  kind?: AuthActor["kind"];
}): AuthActor {
  const ids = input.grants ? Object.keys(input.grants) : [];
  return {
    kind: input.kind ?? "user",
    userId: input.userId ?? "00000000-0000-4000-8000-000000000002",
    workspaceId: input.workspaceId ?? TEST_WORKSPACE_ID,
    role: input.role,
    channelIds: ids.length > 0 ? ids : "all",
    grants: ids.length > 0 ? input.grants : undefined,
    isInstanceOwner: input.role === "owner",
    flags: input.flags,
  };
}
