import { apiRequest } from "./apiClient";

export type MeResponse = {
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; flags: Record<string, boolean> };
  workspaces: Array<{ id: string; name: string; role: string }>;
  role: string;
  channelIds: string[] | "all";
  isInstanceOwner: boolean;
  twoFactorEnabled?: boolean;
  /** True when the workspace demands 2FA from this owner/admin and it is not on yet. */
  twoFactorRequired?: boolean;
  /** Actions the server says this user may take; the web never copies the role matrix. */
  allowed: string[];
};

export const fetchMe = () => apiRequest<MeResponse>("/me");

export async function setActiveWorkspace(organizationId: string): Promise<void> {
  const response = await fetch("/api/auth/organization/set-active", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) throw new Error("Không đổi được không gian làm việc.");
}

export async function listMyWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch("/api/auth/organization/list", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return [];
  const body = await response.json() as Array<{ id: string; name: string }> | null;
  return Array.isArray(body) ? body.map((org) => ({ id: org.id, name: org.name })) : [];
}

export const WORKSPACE_REQUIRED_EVENT = "vg:workspace-required";
export const FORBIDDEN_EVENT = "vg:forbidden";
