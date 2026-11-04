import type { ImageSourcesSettings, ImageSourcesSettingsStatus } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getImageSourcesSettings(): Promise<ImageSourcesSettingsStatus> {
  return apiRequest<ImageSourcesSettingsStatus>("/settings/image-sources");
}

export function saveImageSourcesSettings(settings: ImageSourcesSettings): Promise<ImageSourcesSettingsStatus> {
  return apiRequest<ImageSourcesSettingsStatus>("/settings/image-sources", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}
