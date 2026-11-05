import type { ProjectVoiceSummary, TtsVoice, VoiceTrack } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getTtsVoices(query?: { provider?: string; language?: string; gender?: string }): Promise<{ voices: TtsVoice[] }> {
  const params = new URLSearchParams();
  if (query?.provider) params.set("provider", query.provider);
  if (query?.language) params.set("language", query.language);
  if (query?.gender) params.set("gender", query.gender);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return apiRequest<{ voices: TtsVoice[] }>(`/tts/voices${suffix}`);
}

export function getProjectVoice(projectId: string): Promise<ProjectVoiceSummary> {
  return apiRequest<ProjectVoiceSummary>(`/projects/${projectId}/voice`);
}

export function regenerateVoice(projectId: string, sceneId: string): Promise<VoiceTrack> {
  return apiRequest<VoiceTrack>(`/projects/${projectId}/scenes/${sceneId}/voice/regenerate`, { method: "POST" });
}

export function uploadVoice(projectId: string, sceneId: string, file: File): Promise<VoiceTrack> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<VoiceTrack>(`/projects/${projectId}/scenes/${sceneId}/voice/upload`, {
    method: "POST",
    body: form,
  });
}
