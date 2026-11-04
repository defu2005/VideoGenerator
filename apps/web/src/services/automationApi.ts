import type {
  ApproveTopicsBody,
  AutomationPaused,
  AutomationStatus,
  ProfileAutomationView,
  ProfileTopic,
  ProfileTopicInput,
  ProfileTopicUpdate,
  ReorderTopicsBody,
  SuggestTopicsBody,
  SuggestTopicsResponse,
  TopicListResponse,
  TopicStatus,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getAutomationPaused(): Promise<AutomationPaused> {
  return apiRequest<AutomationPaused>("/settings/automation");
}

export function setAutomationPaused(paused: boolean): Promise<AutomationPaused> {
  return apiRequest<AutomationPaused>("/settings/automation", {
    method: "PUT",
    body: JSON.stringify({ paused }),
  });
}

export function getAutomationStatus(): Promise<AutomationStatus> {
  return apiRequest<AutomationStatus>("/automation/status");
}

export function getProfileAutomation(profileId: string): Promise<ProfileAutomationView> {
  return apiRequest<ProfileAutomationView>(`/profiles/${encodeURIComponent(profileId)}/automation`);
}

export function listTopics(profileId: string, status?: TopicStatus): Promise<TopicListResponse> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  return apiRequest<TopicListResponse>(
    `/profiles/${encodeURIComponent(profileId)}/topics${qs ? `?${qs}` : ""}`,
  );
}

export function addTopic(profileId: string, input: ProfileTopicInput): Promise<ProfileTopic> {
  return apiRequest<ProfileTopic>(`/profiles/${encodeURIComponent(profileId)}/topics`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTopic(
  profileId: string,
  topicId: string,
  input: ProfileTopicUpdate,
): Promise<ProfileTopic> {
  return apiRequest<ProfileTopic>(
    `/profiles/${encodeURIComponent(profileId)}/topics/${encodeURIComponent(topicId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function approveTopics(profileId: string, body: ApproveTopicsBody): Promise<TopicListResponse> {
  return apiRequest<TopicListResponse>(`/profiles/${encodeURIComponent(profileId)}/topics/approve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reorderTopics(profileId: string, body: ReorderTopicsBody): Promise<TopicListResponse> {
  return apiRequest<TopicListResponse>(`/profiles/${encodeURIComponent(profileId)}/topics/reorder`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function suggestTopics(profileId: string, body: SuggestTopicsBody): Promise<SuggestTopicsResponse> {
  return apiRequest<SuggestTopicsResponse>(`/profiles/${encodeURIComponent(profileId)}/topics/suggest`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
