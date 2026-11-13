import { apiRequest } from "./apiClient";

export type TeamRole = "owner" | "admin" | "editor" | "reviewer" | "publisher" | "viewer";
export type GrantRole = "editor" | "reviewer" | "publisher" | "viewer";
export type Grant = { profileId: string; role?: GrantRole };

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Chủ sở hữu",
  admin: "Quản trị viên",
  editor: "Biên tập",
  reviewer: "Duyệt",
  publisher: "Đăng bài",
  viewer: "Chỉ xem",
};

export const ROLE_HINT: Record<TeamRole, string> = {
  owner: "Toàn quyền, kể cả cài đặt nhóm.",
  admin: "Quản lý thành viên và mọi kênh, trừ chủ sở hữu.",
  editor: "Tạo và sửa dự án trong kênh được giao.",
  reviewer: "Xem và duyệt các bước cần duyệt.",
  publisher: "Duyệt và đăng bài lên nền tảng.",
  viewer: "Chỉ xem, không sửa được gì.",
};

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  twoFactorEnabled: boolean;
  lastActiveAt: string | null;
  joinedAt: string;
  grants: Array<{ profileId: string; role: TeamRole }>;
  isSelf: boolean;
};
export type TeamChannel = { id: string; name: string };
export type MembersResponse = { members: TeamMember[]; channels: TeamChannel[] };

export type Invitation = {
  id: string;
  email: string;
  role: TeamRole;
  grants: Grant[];
  expiresAt: string;
  createdAt?: string;
  link: string;
};

export type WorkspaceSettings = { name: string; flags: { requireTwoFactor?: boolean } & Record<string, unknown>; canEdit: boolean };

export type ServiceKey = {
  id: string; name: string; preview: string; ownerName: string; enabled: boolean; isLocalService: boolean; canRevoke: boolean;
  createdAt: string; lastUsedAt: string | null; expiresAt: string | null;
};

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const fetchMembers = () => apiRequest<MembersResponse>("/workspace/members");
export const changeRole = (userId: string, role: TeamRole) =>
  apiRequest<{ ok: true }>(`/workspace/members/${userId}`, { method: "PATCH", ...json({ role }) });
export const saveGrants = (userId: string, grants: Grant[]) =>
  apiRequest<{ ok: true }>(`/workspace/members/${userId}/grants`, { method: "PUT", ...json({ grants }) });
export const removeMember = (userId: string) => apiRequest<{ ok: true }>(`/workspace/members/${userId}`, { method: "DELETE" });
export const fetchInvitations = () => apiRequest<{ invitations: Invitation[] }>("/workspace/invitations");
export const createInvitation = (input: { email: string; role: TeamRole; grants: Grant[] }) =>
  apiRequest<Invitation>("/workspace/invitations", { method: "POST", ...json(input) });
export const cancelInvitation = (id: string) => apiRequest<{ ok: true }>(`/workspace/invitations/${id}`, { method: "DELETE" });
export const fetchWorkspaceSettings = () => apiRequest<WorkspaceSettings>("/workspace/settings");
export const saveWorkspaceSettings = (input: { requireTwoFactor: boolean }) =>
  apiRequest<{ ok: true }>("/workspace/settings", { method: "PATCH", ...json(input) });
export const fetchServiceKeys = () => apiRequest<{ keys: ServiceKey[] }>("/workspace/service-keys");
export const revokeServiceKey = (id: string) => apiRequest<{ ok: true }>(`/workspace/service-keys/${id}`, { method: "DELETE" });

/** Roles a person with `myRole` may hand out. The server enforces this; the web only hides the rest. */
export function assignableRoles(myRole: string): TeamRole[] {
  const base: TeamRole[] = ["editor", "reviewer", "publisher", "viewer"];
  return myRole === "owner" ? ["owner", "admin", ...base] : base;
}

/** The lower of the workspace role and the channel grant, as the server computes it (display only). */
const RANK: Record<TeamRole, number> = { owner: 6, admin: 5, editor: 4, publisher: 3, reviewer: 2, viewer: 1 };
export function effectiveRole(workspaceRole: TeamRole, grantRole: TeamRole | undefined): TeamRole {
  if (!grantRole) return workspaceRole;
  return RANK[grantRole] < RANK[workspaceRole] ? grantRole : workspaceRole;
}
