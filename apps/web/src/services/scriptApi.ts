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
