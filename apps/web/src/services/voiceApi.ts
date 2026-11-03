import type { ProjectVoiceSummary, TtsVoice, VoiceTrack } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getTtsVoices(): Promise<{ voices: TtsVoice[] }> {
  return apiRequest<{ voices: TtsVoice[] }>("/tts/voices");
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
