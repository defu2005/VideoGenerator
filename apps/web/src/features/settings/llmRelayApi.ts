import type { LlmRelayGrantPatch, LlmRelayStatus } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

/** TASK-136: the control server's LLM relay (status, per-caller usage today and grants). */
export const relayStatusKey = ["llm-relay", "status"] as const;
export const getRelayStatus = () => apiRequest<LlmRelayStatus>("/llm/relay-admin/status");
export const saveRelayGrant = (caller: string, patch: LlmRelayGrantPatch) =>
  apiRequest("/llm/relay-admin/grants", { method: "PUT", body: JSON.stringify({ caller, ...patch }) });
export const deleteRelayGrant = (caller: string) =>
  apiRequest(`/llm/relay-admin/grants?caller=${encodeURIComponent(caller)}`, { method: "DELETE" });
