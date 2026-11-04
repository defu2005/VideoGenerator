import type {
  AssistantActionResult,
  AssistantConversation,
  AssistantMessagesResponse,
  AssistantSendResponse,
  AssistantSettings,
  AssistantSettingsUpdate,
  CreateAssistantConversationBody,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function listAssistantConversations(channel?: "web" | "telegram") {
  const query = channel ? `?channel=${channel}` : "";
  return apiRequest<{ items: AssistantConversation[] }>(`/assistant/conversations${query}`);
}

export function createAssistantConversation(
  body: CreateAssistantConversationBody = { channel: "web" },
): Promise<AssistantConversation> {
  return apiRequest<AssistantConversation>("/assistant/conversations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getAssistantMessages(conversationId: string): Promise<AssistantMessagesResponse> {
  return apiRequest<AssistantMessagesResponse>(`/assistant/conversations/${conversationId}/messages`);
}

export function sendAssistantMessage(
  conversationId: string,
  text: string,
): Promise<AssistantSendResponse> {
  return apiRequest<AssistantSendResponse>(`/assistant/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function confirmAssistantAction(actionId: string): Promise<AssistantActionResult> {
  return apiRequest<AssistantActionResult>(`/assistant/actions/${actionId}/confirm`, {
    method: "POST",
  });
}

export function rejectAssistantAction(actionId: string): Promise<AssistantActionResult> {
  return apiRequest<AssistantActionResult>(`/assistant/actions/${actionId}/reject`, {
    method: "POST",
  });
}

export function confirmAllAssistantActions(conversationId: string): Promise<{ actions: AssistantActionResult["action"][] }> {
  return apiRequest<{ actions: AssistantActionResult["action"][] }>(
    `/assistant/conversations/${conversationId}/confirm-all`,
    { method: "POST" },
  );
}

export function getAssistantSettings(): Promise<AssistantSettings> {
  return apiRequest<AssistantSettings>("/assistant/settings");
}

export function updateAssistantSettings(update: AssistantSettingsUpdate): Promise<AssistantSettings> {
  return apiRequest<AssistantSettings>("/assistant/settings", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}
