import type { NodeDetail, NodePlacementSettings, NodeSecretGrant, VideoNode } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

export type NodesResponse = {
  nodes: VideoNode[];
  settings: NodePlacementSettings;
  /** Version of the control plane; nodes must match it. */
  targetVersion?: string;
  nodeTargetVersion?: "control";
};
export type JoinToken = { id: string; token: string; expiresAt: string };

export const listNodes = () => apiRequest<NodesResponse>("/nodes");
export const getNodeDetail = (id: string) => apiRequest<NodeDetail>(`/nodes/${id}`);
export const createJoinToken = () => apiRequest<JoinToken>("/nodes/join-tokens", { method: "POST", body: "{}" });
/** A partial update: only the fields given change. */
export type NodePlacementPatch = {
  mode?: NodePlacementSettings["mode"];
  stages?: Partial<Pick<NodePlacementSettings["stages"], "VOICE" | "MEDIA_FETCH">>;
  localOnlyKeys?: string[];
};
export const listSecretGrants = () => apiRequest<{ grants: NodeSecretGrant[] }>("/nodes/secrets");
export const saveNodeSettings = (value: NodePlacementPatch) =>
  apiRequest<NodePlacementSettings>("/nodes/settings", { method: "PUT", body: JSON.stringify(value) });
export const patchNode = (id: string, body: Record<string, unknown>) =>
  apiRequest(`/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const revokeNode = (id: string) => apiRequest(`/nodes/${id}/revoke`, { method: "POST", body: "{}" });
