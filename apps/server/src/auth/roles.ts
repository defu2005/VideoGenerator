import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "reviewer", "publisher", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return typeof value === "string" && (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export const organizationAc = createAccessControl(defaultStatements);

/**
 * Roles registered with Better Auth so its own endpoints (invite, update role) know them.
 * Only membership management lives here; what a role may do in the app is decided in `policy.ts`.
 */
export const organizationRoles = {
  owner: organizationAc.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  admin: organizationAc.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  }),
  editor: organizationAc.newRole({}),
  reviewer: organizationAc.newRole({}),
  publisher: organizationAc.newRole({}),
  viewer: organizationAc.newRole({}),
};
