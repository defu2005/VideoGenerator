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

export function rescoreScript(projectId: string): Promise<ScriptData> {
  return apiRequest<ScriptData>(`/projects/${projectId}/script/critique`, {
    method: "POST",
  });
}
