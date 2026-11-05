import type { ClipProposal, ReframeMode, SpeechToTextSettings } from "@vg/shared";
import { apiRequest } from "./apiClient";

export type ClipView = {
  eligible: boolean;
  reason: string | null;
  renderId: string | null;
  options: { count: number; minSec: number; maxSec: number; reframe: ReframeMode };
  proposals: ClipProposal[];
  children: Array<{ id: string; title: string; status: string; stage: string }>;
  jobs: Array<{ id: string; proposalId: string; status: string; progress: number; message: string | null }>;
};

export function getClips(projectId: string): Promise<ClipView> {
  return apiRequest<ClipView>(`/projects/${projectId}/clips`);
}

export function proposeClips(projectId: string, body: { count?: number; minSec?: number; maxSec?: number; reframe?: ReframeMode }): Promise<ClipView> {
  return apiRequest<ClipView>(`/projects/${projectId}/clips/propose`, { method: "POST", body: JSON.stringify(body) });
}

export function updateClips(projectId: string, proposals: Array<{ id: string; start?: number; end?: number; hook?: string; title?: string; selected?: boolean }>): Promise<ClipView> {
  return apiRequest<ClipView>(`/projects/${projectId}/clips`, { method: "PATCH", body: JSON.stringify({ proposals }) });
}

export function exportClips(projectId: string, ids: string[]): Promise<ClipView> {
  return apiRequest<ClipView>(`/projects/${projectId}/clips/export`, { method: "POST", body: JSON.stringify({ ids }) });
}

export function importLongVideo(body: {
  videoPath: string;
  title?: string;
  transcript?: string;
  ownershipConfirmed: boolean;
}): Promise<{ projectId: string; view: ClipView }> {
  return apiRequest(`/clips/import`, { method: "POST", body: JSON.stringify(body) });
}

export function getSpeechSettings(): Promise<SpeechToTextSettings> {
  return apiRequest<SpeechToTextSettings>("/settings/speech-to-text");
}

export function saveSpeechSettings(body: { tool: SpeechToTextSettings["tool"]; path: string; args: string }): Promise<SpeechToTextSettings> {
  return apiRequest<SpeechToTextSettings>("/settings/speech-to-text", { method: "PUT", body: JSON.stringify(body) });
}
