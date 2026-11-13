import type {
  AccountDuplicates,
  AccountList,
  AccountListRow,
  ConnectionCheck,
  ConnectionsOverview,
  LlmConnectionList,
  LlmConnectionRow,
  LlmConnectionUpdate,
  LlmCustomProviderInput,
  PlatformAppSave,
  PlatformAppStatus,
  SecretList,
  SecretRow,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

// AI providers
export const getLlmConnections = () => apiRequest<LlmConnectionList>("/settings/llm-providers");
export const updateLlmConnection = (id: string, update: LlmConnectionUpdate) =>
  apiRequest<LlmConnectionRow>(`/settings/llm-providers/${encodeURIComponent(id)}`, json("PUT", update));
export const removeLlmKey = (id: string) =>
  apiRequest<LlmConnectionRow>(`/settings/llm-providers/${encodeURIComponent(id)}/key`, json("DELETE"));
export const addCustomLlm = (input: LlmCustomProviderInput) =>
  apiRequest<LlmConnectionRow>("/settings/llm-providers/custom", json("POST", input));
export const removeCustomLlm = (slug: string) =>
  apiRequest<{ ok: true }>(`/settings/llm-providers/custom/${encodeURIComponent(slug)}`, json("DELETE"));
export const testLlmConnection = (id: string) =>
  apiRequest<ConnectionCheck>(`/settings/llm-providers/${encodeURIComponent(id)}/test`, json("POST"));
export const startOpenRouterLogin = () =>
  apiRequest<{ url: string }>("/settings/llm-providers/openrouter/start", json("POST"));

// .env import
export const getImportableEnv = () => apiRequest<{ ids: string[] }>("/settings/import-env");
export const importEnv = () => apiRequest<{ copied: string[] }>("/settings/import-env", json("POST"));

// Image sources, Brave, platform apps
export const getSecrets = () => apiRequest<SecretList>("/connections/secrets");
export const saveSecret = (id: string, value: string) =>
  apiRequest<SecretRow>(`/connections/secrets/${encodeURIComponent(id)}`, json("PUT", { value }));
export const removeSecret = (id: string) =>
  apiRequest<SecretRow>(`/connections/secrets/${encodeURIComponent(id)}`, json("DELETE"));
export const testSecret = (id: string) =>
  apiRequest<ConnectionCheck>(`/connections/secrets/${encodeURIComponent(id)}/test`, json("POST"));

// Overview and first-run checklist
export const getConnectionsOverview = () => apiRequest<ConnectionsOverview>("/connections/overview");
export const setSetupHidden = (hidden: boolean) =>
  apiRequest<ConnectionsOverview>("/connections/setup", json("PUT", { hidden }));

// Platform accounts
export const getAllAccounts = () => apiRequest<AccountList>("/accounts");
export const moveAccount = (id: string, profileId: string) =>
  apiRequest<AccountListRow>(`/accounts/${encodeURIComponent(id)}/move`, json("POST", { profileId }));
export function findDuplicateAccounts(platform: string, externalId: string, excludeId?: string): Promise<AccountDuplicates> {
  const params = new URLSearchParams({ platform, externalId });
  if (excludeId) params.set("excludeId", excludeId);
  return apiRequest<AccountDuplicates>(`/accounts/duplicates?${params.toString()}`);
}
export function getPlatformApp(platform: string, profileId?: string, accountId?: string): Promise<PlatformAppStatus> {
  const params = new URLSearchParams();
  if (profileId) params.set("profileId", profileId);
  if (accountId) params.set("accountId", accountId);
  const query = params.toString();
  return apiRequest<PlatformAppStatus>(`/connections/platform-apps/${encodeURIComponent(platform)}${query ? `?${query}` : ""}`);
}
export const savePlatformApp = (platform: string, input: PlatformAppSave) =>
  apiRequest<PlatformAppStatus>(`/connections/platform-apps/${encodeURIComponent(platform)}`, json("PUT", input));

export function verifyPlatformApp(platform: string, profileId?: string, accountId?: string) {
  const query = new URLSearchParams();
  if (profileId) query.set("profileId", profileId);
  if (accountId) query.set("accountId", accountId);
  return apiRequest<{ ok: boolean | null; reason?: string }>(
    `/connections/platform-apps/${encodeURIComponent(platform)}/verify?${query}`, { method: "POST" },
  );
}
