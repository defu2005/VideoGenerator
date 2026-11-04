import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApproveTopicsBody,
  ProfileTopicInput,
  ReorderTopicsBody,
  SuggestTopicsBody,
  TopicStatus,
} from "@vg/shared";
import {
  addTopic,
  approveTopics,
  getAutomationPaused,
  getAutomationStatus,
  getProfileAutomation,
  listTopics,
  reorderTopics,
  setAutomationPaused,
  suggestTopics,
} from "../services/automationApi";
import { updateProfile } from "../services/profilesApi";
import type { ProfileUpdate } from "@vg/shared";
import { profileKeys } from "./useProfiles";

export const automationKeys = {
  paused: ["automation", "paused"] as const,
  status: ["automation", "status"] as const,
  profile: (id: string) => ["automation", "profile", id] as const,
  topics: (id: string, status?: TopicStatus) => ["automation", "topics", id, status ?? "all"] as const,
};

export function useAutomationPaused() {
  return useQuery({ queryKey: automationKeys.paused, queryFn: getAutomationPaused });
}

export function useSetAutomationPaused() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAutomationPaused,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.paused });
      void queryClient.invalidateQueries({ queryKey: automationKeys.status });
    },
  });
}

export function useAutomationStatus() {
  return useQuery({ queryKey: automationKeys.status, queryFn: getAutomationStatus });
}

export function useProfileAutomation(profileId: string) {
  return useQuery({
    queryKey: automationKeys.profile(profileId),
    queryFn: () => getProfileAutomation(profileId),
    enabled: Boolean(profileId),
  });
}

export function useTopics(profileId: string, status?: TopicStatus) {
  return useQuery({
    queryKey: automationKeys.topics(profileId, status),
    queryFn: () => listTopics(profileId, status),
    enabled: Boolean(profileId),
  });
}

export function useAddTopic(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileTopicInput) => addTopic(profileId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.topics(profileId) });
      void queryClient.invalidateQueries({ queryKey: automationKeys.profile(profileId) });
    },
  });
}

export function useApproveTopics(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApproveTopicsBody) => approveTopics(profileId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.topics(profileId) });
      void queryClient.invalidateQueries({ queryKey: automationKeys.profile(profileId) });
    },
  });
}

export function useReorderTopics(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReorderTopicsBody) => reorderTopics(profileId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.topics(profileId) });
    },
  });
}

export function useSuggestTopics(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SuggestTopicsBody) => suggestTopics(profileId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationKeys.topics(profileId) });
      void queryClient.invalidateQueries({ queryKey: automationKeys.profile(profileId) });
    },
  });
}

export function useSaveProfileAutomation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileUpdate) => updateProfile(profileId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) });
      void queryClient.invalidateQueries({ queryKey: automationKeys.profile(profileId) });
      void queryClient.invalidateQueries({ queryKey: automationKeys.status });
    },
  });
}
