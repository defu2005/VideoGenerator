import { apiRequest } from "./apiClient";
import type { OperatorRuntimeChannel, OperatorSettingsUpdate } from "@vg/shared";

export type OperatorOverview = {
  killed: boolean;
  cli: { found: boolean; version: string | null; loggedIn: boolean | null; model: string | null };
  runtimeOptions?: Array<{ id: string; label: string; available: boolean; reason?: string }>;
  queue: Array<{ id: string; prompt: string; position: number; status: string }>;
  activeRunId: string | null;
  pending: Array<{ id: string; summary: string; status: string }>;
  orders: Array<{ id: string; title: string; prompt: string; cron: string | null; enabled: boolean }>;
  runs: Array<{ id: string; status: string; prompt: string; result: string | null; partialText?: string; toolChips: string[]; outcome: string | null; createdAt: string; workflowId?: string | null; canResume?: boolean }>;
  audit: Array<{ id: string; source: string; tool: string; decision: string; summary: string; created_at: string }>;
  notes: Array<{ name: string; text: string }>;
  settings: { killed: boolean; cursorPath: string; tickCron: string | null; maxRunsPerDay: number; runtimeByChannel?: Record<OperatorRuntimeChannel, string> };
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

export function resumeOperatorWorkflow(id: string): Promise<{ runId: string; message: string }> {
  return apiRequest(`/operator/runs/${id}/resume`, { method: "POST" });
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

export function saveOperatorSettings(body: OperatorSettingsUpdate): Promise<unknown> {
  return apiRequest("/operator/settings", { method: "PUT", body: JSON.stringify(body) });
}

export function saveStandingOrder(body: { id?: string; title: string; prompt: string; cron?: string | null; enabled?: boolean }): Promise<{ id: string }> {
  const payload = {
    title: body.title,
    prompt: body.prompt,
    cron: body.cron ?? null,
    enabled: body.enabled ?? true,
  };
  if (body.id) {
    return apiRequest(`/operator/orders/${body.id}`, { method: "PUT", body: JSON.stringify(payload) });
  }
  return apiRequest("/operator/orders", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteStandingOrder(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/operator/orders/${id}`, { method: "DELETE" });
}

export function openOperatorFolder(): Promise<{ opened: boolean }> {
  return apiRequest("/operator/open", { method: "POST" });
}

export type SupervisionData = {
  duty: { instance: string; expiresAt: string; lastSeenAt: string } | null;
  instances: Array<{
    instance: string;
    kind: string;
    environment: string;
    version: string | null;
    lastSeenAt: string;
    lastToolAt: string | null;
    onDuty: boolean;
  }>;
  escalations: Array<{
    id: string;
    fromKind: string;
    fromInstance: string;
    toKind: "hermes" | "user";
    kind: string;
    objectRef: string;
    summary: string;
    evidence: Record<string, unknown>;
    status: "open" | "claimed" | "resolved" | "forwarded";
    deadlineAt: string | null;
    hops: number;
    claimedBy: string | null;
    resolvedBy: string | null;
    outcome: string | null;
    note: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  actions: Array<{
    id: string;
    tool: string;
    summary: string;
    decision: string;
    created_at: string;
    agent_name: string | null;
    agent_model: string | null;
  }>;
  leases: Array<{
    resourceKind: string;
    resourceId: string;
    holderKind: string;
    holderInstance: string;
    rank: number;
    acquiredAt: string;
    expiresAt: string;
    preemptedBy: string | null;
  }>;
  pause: { by: string; until: string; reason: string; since: string } | null;
};

export function getSupervisionData(): Promise<SupervisionData> {
  return apiRequest<SupervisionData>("/operator/supervision");
}
