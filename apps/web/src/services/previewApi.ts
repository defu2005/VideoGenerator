import { apiRequest } from "./apiClient";

export type PreviewFile = { id: string; name: string; mime: string; bytes: number; url: string };

export type PreviewFacts = {
  sceneId: string;
  sceneIndex: number;
  shotId: string;
  kind: string;
  template: string | null;
  startSec: number;
  endSec: number;
  videoStartSec: number;
  textOnScreen: string[];
  charsPerSecond: number | null;
  luma: number | null;
  lumaFlag: "dark" | "bright" | null;
  nearDuplicateOfPrev: boolean;
};

export type PreviewResult = {
  kind: "frame" | "contact_sheet" | "clip";
  basis: "timeline" | "selection";
  notes: string[];
  file: PreviewFile;
  cached: boolean;
  width: number;
  height: number;
  facts: PreviewFacts[];
  warnings: string[];
  elapsedMs: number;
  atSec?: number;
  sceneId?: string;
  durationSec?: number;
};

function post(projectId: string, kind: string, body: Record<string, unknown>): Promise<PreviewResult> {
  return apiRequest<PreviewResult>(`/projects/${projectId}/preview/${kind}`, { method: "POST", body: JSON.stringify(body) });
}

/** Frame of one scene at `offsetSec` seconds into the scene. */
export function previewFrame(projectId: string, sceneId: string, offsetSec: number): Promise<PreviewResult> {
  return post(projectId, "frame", { sceneId, offsetSec });
}

export function previewContactSheet(projectId: string, sceneId: string | "all" = "all"): Promise<PreviewResult> {
  return post(projectId, "contact-sheet", { sceneId });
}

export function previewClip(projectId: string, sceneId: string): Promise<PreviewResult> {
  return post(projectId, "clip", { sceneId });
}
