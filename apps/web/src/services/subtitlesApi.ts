import type { SubtitleCue } from "@vg/shared";
import { apiRequest } from "./apiClient";

export type ProjectSubtitlesSummary = {
  cues: SubtitleCue[];
  totalDurationSec: number;
  updatedAt: string;
};

export function getProjectSubtitles(projectId: string): Promise<ProjectSubtitlesSummary> {
  return apiRequest<ProjectSubtitlesSummary>(`/projects/${projectId}/subtitles`);
}

export function patchProjectSubtitleCue(projectId: string, index: number, text: string): Promise<ProjectSubtitlesSummary> {
  return apiRequest<ProjectSubtitlesSummary>(`/projects/${projectId}/subtitles/cues/${index}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function downloadProjectSubtitle(projectId: string, extension: "srt" | "ass"): string {
  return `/api/projects/${projectId}/subtitles/file.${extension}`;
}
