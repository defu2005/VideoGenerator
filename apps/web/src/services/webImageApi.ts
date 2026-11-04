import type { WebImageSettings, WebImageSettingsStatus } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getWebImageSettings(): Promise<WebImageSettingsStatus> {
  return apiRequest<WebImageSettingsStatus>("/settings/web-image");
}

export function saveWebImageSettings(settings: WebImageSettings): Promise<WebImageSettingsStatus> {
  return apiRequest<WebImageSettingsStatus>("/settings/web-image", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
