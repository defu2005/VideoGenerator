import { apiRequest } from "./apiClient";

export type AuditItem = {
  id: string; at: number | string; actorKind: string; actorUserId: string | null; actorKeyId: string | null;
  actorName: string | null; actorKeyName: string | null; action: string; targetType: string | null; targetId: string | null;
  outcome: "ok" | "denied" | "error"; statusCode: number | null; source: string; summary: string | null;
  payload: string | null; requestId: string | null;
};
export type AuditFilters = { actor?: string; action?: string; source?: string; outcome?: string; from?: string; to?: string };

export function fetchAudit(filters: AuditFilters, cursor?: string | null) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  params.set("limit", "50");
  return apiRequest<{ items: AuditItem[]; nextCursor: string | null }>(`/audit?${params.toString()}`);
}
