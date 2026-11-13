import { ApiRequestError } from "./apiClient";

export type InviteInfo = { email: string; role: string; workspaceName: string; accountExists: boolean; expiresAt: string };

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/setup${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new ApiRequestError(response.status, body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? "Không thực hiện được.");
  return body as T;
}

export const fetchInvite = (id: string) => call<InviteInfo>(`/invite/${encodeURIComponent(id)}`);
export const acceptInvite = (input: { id: string; name: string; password: string }) =>
  call<{ ok: true }>("/accept-invite", { method: "POST", body: input });
export const joinInvite = (id: string) => call<{ ok: true }>(`/invite/${encodeURIComponent(id)}/join`, { method: "POST", body: {} });
