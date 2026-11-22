import type { SaveScriptInput, ScriptData } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getScript(projectId: string): Promise<ScriptData> {
  return apiRequest<ScriptData>(`/projects/${projectId}/script`);
}

export function saveScript(projectId: string, script: SaveScriptInput): Promise<ScriptData> {
  return apiRequest<ScriptData>(`/projects/${projectId}/script`, {
    method: "PUT",
    body: JSON.stringify(script),
  });
}

export function switchScriptHook(projectId: string, hookId: string): Promise<ScriptData> {
  return apiRequest<ScriptData>(`/projects/${projectId}/script/hook`, {
    method: "POST",
    body: JSON.stringify({ hookId }),
  });
}

// TASK-146: only the central question and beat concrete moments are editable while the outline is parked.
export type OutlineEditInput = {
  centralQuestion?: string;
  beats?: { id: string; concreteMoment: string }[];
};

export function editScriptOutline(projectId: string, edit: OutlineEditInput): Promise<ScriptData> {
  return apiRequest<ScriptData>(`/projects/${projectId}/script/outline`, {
    method: "POST",
    body: JSON.stringify(edit),
  });
}

export function rescoreScript(projectId: string): Promise<ScriptData> {
  return apiRequest<ScriptData>(`/projects/${projectId}/script/critique`, {
    method: "POST",
  });
}
