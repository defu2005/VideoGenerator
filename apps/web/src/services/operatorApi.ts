import { apiRequest } from "./apiClient";

export type OperatorOverview = {
  killed: boolean;
  cli: { found: boolean; version: string | null; loggedIn: boolean | null; model: string | null };
  queue: Array<{ id: string; prompt: string; position: number; status: string }>;
  activeRunId: string | null;
  pending: Array<{ id: string; summary: string; status: string }>;
  orders: Array<{ id: string; title: string; prompt: string; cron: string | null; enabled: boolean }>;
  runs: Array<{ id: string; status: string; prompt: string; result: string | null; partialText?: string; toolChips: string[]; outcome: string | null; createdAt: string }>;
  audit: Array<{ id: string; source: string; tool: string; decision: string; summary: string; created_at: string }>;
  notes: Array<{ name: string; text: string }>;
  settings: { killed: boolean; cursorPath: string; tickCron: string | null; maxRunsPerDay: number };
  resumeCommand: string;
  workspacePath: string;
  usage: { today: number; month: number; cap: number };
  conversationId: string;
};

export type OperatorMessages = {
  messages: Array<{ id: string; role: string; text: string; createdAt: string }>;
};

export function getOperatorOverview(): Promise<OperatorOverview> {
  return apiRequest<OperatorOverview>("/operator/overview");
}

export function getOperatorMessages(conversationId: string): Promise<OperatorMessages> {
  return apiRequest<OperatorMessages>(`/operator/conversations/${conversationId}`);
}

export function sendOperatorMessage(conversationId: string, text: string): Promise<{ message: string; runId: string }> {
  return apiRequest(`/operator/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function stopOperator(conversationId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/operator/conversations/${conversationId}/stop`, { method: "POST" });
}

export function newOperatorSession(conversationId: string): Promise<{ ok: boolean }> {
  return apiRequest(`/operator/conversations/${conversationId}/new-session`, { method: "POST" });
}

export function saveOperatorSettings(body: { killed?: boolean; cursorPath?: string; tickCron?: string | null }): Promise<unknown> {
  return apiRequest("/operator/settings", { method: "PUT", body: JSON.stringify(body) });
}

export function saveStandingOrder(body: { id?: string; title: string; prompt: string; cron?: string | null; enabled?: boolean }): Promise<{ id: string }> {
  if (body.id) {
    return apiRequest(`/operator/orders/${body.id}`, { method: "PUT", body: JSON.stringify(body) });
  }
  return apiRequest("/operator/orders", { method: "POST", body: JSON.stringify(body) });
}

export function deleteStandingOrder(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/operator/orders/${id}`, { method: "DELETE" });
}

export function openOperatorFolder(): Promise<{ opened: boolean; path: string }> {
  return apiRequest("/operator/open", { method: "POST" });
}
