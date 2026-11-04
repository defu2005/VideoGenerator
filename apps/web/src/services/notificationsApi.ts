import type {
  NotificationLogList,
  NotificationSettings,
  NotificationSettingsStatus,
  PairingCodeResponse,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getNotificationSettings(): Promise<NotificationSettingsStatus> {
  return apiRequest<NotificationSettingsStatus>("/notifications/settings");
}

export function saveNotificationSettings(
  settings: NotificationSettings,
): Promise<NotificationSettingsStatus> {
  return apiRequest<NotificationSettingsStatus>("/notifications/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function saveTelegramToken(token: string): Promise<NotificationSettingsStatus> {
  return apiRequest<NotificationSettingsStatus>("/notifications/telegram/token", {
    method: "PUT",
    body: JSON.stringify({ token }),
  });
}

export function deleteTelegramToken(): Promise<NotificationSettingsStatus> {
  return apiRequest<NotificationSettingsStatus>("/notifications/telegram/token", {
    method: "DELETE",
  });
}

export function createPairingCode(): Promise<PairingCodeResponse> {
  return apiRequest<PairingCodeResponse>("/notifications/telegram/pair", {
    method: "POST",
  });
}

export function sendTestNotification(): Promise<{ ok: boolean; error?: string }> {
  return apiRequest<{ ok: boolean; error?: string }>("/notifications/test", {
    method: "POST",
  });
}

export function getNotificationLog(): Promise<NotificationLogList> {
  return apiRequest<NotificationLogList>("/notifications/log");
}
