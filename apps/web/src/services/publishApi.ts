import type {
  AccountConnectionDetail,
  CreatePublicationsBody,
  PlatformAppCredentialsInput,
  Publication,
  PublicationListResponse,
  PublishVisibility,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export type { AccountConnectionDetail };

/** API origin for OAuth popup (must hit the server, not the Vite host). */
export function apiOrigin(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:3001";
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3001`;
  }
  return window.location.origin;
}

export function oauthStartUrl(platform: string, accountId: string): string {
  return `${apiOrigin()}/api/oauth/${encodeURIComponent(platform)}/start?accountId=${encodeURIComponent(accountId)}`;
}

export function listProjectPublications(projectId: string): Promise<PublicationListResponse> {
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/publications`);
}

export function createPublications(
  projectId: string,
  body: CreatePublicationsBody,
): Promise<{ items: Publication[] }> {
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/publications`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPublications(query: { status?: string; profileId?: string } = {}): Promise<PublicationListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.profileId) params.set("profileId", query.profileId);
  const qs = params.toString();
  return apiRequest(`/publications${qs ? `?${qs}` : ""}`);
}

export function cancelPublication(id: string): Promise<Publication> {
  return apiRequest(`/publications/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function retryPublication(id: string): Promise<Publication> {
  return apiRequest(`/publications/${encodeURIComponent(id)}/retry`, { method: "POST" });
}

export function getAccountConnection(profileId: string, accountId: string): Promise<AccountConnectionDetail> {
  return apiRequest(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}/connection`,
  );
}

export function disconnectAccount(profileId: string, accountId: string): Promise<{ ok: true }> {
  return apiRequest(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}/connection`,
    { method: "DELETE" },
  );
}

export function checkAccountConnection(profileId: string, accountId: string): Promise<AccountConnectionDetail> {
  return apiRequest(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}/connection/check`,
    { method: "POST" },
  );
}

export function saveAppCredentials(
  profileId: string,
  accountId: string,
  body: PlatformAppCredentialsInput,
): Promise<{ configured: true; idHint: string }> {
  return apiRequest(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}/app-credentials`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export function deleteAppCredentials(profileId: string, accountId: string): Promise<{ ok: true }> {
  return apiRequest(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}/app-credentials`,
    { method: "DELETE" },
  );
}

export type PublishFormVisibility = PublishVisibility;

export const accountConnectionKeys = {
  all: ["account-connection"] as const,
  detail: (profileId: string, accountId: string) =>
    ["account-connection", profileId, accountId] as const,
};
