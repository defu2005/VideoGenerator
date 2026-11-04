import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformAccountInput, PlatformAccountUpdate, ProfileInput, ProfileListQuery, ProfileUpdate } from "@vg/shared";
import {
  addPlatformAccount,
  createProfile,
  deletePlatformAccount,
  getProfile,
  getProfiles,
  setProfileArchived,
  updatePlatformAccount,
  updateProfile,
} from "../services/profilesApi";

export const profileKeys = {
  all: ["profiles"] as const,
  list: (query: ProfileListQuery) => ["profiles", query] as const,
  detail: (id: string) => ["profile", id] as const,
};

function invalidateProfiles(queryClient: ReturnType<typeof useQueryClient>, id?: string): void {
  void queryClient.invalidateQueries({ queryKey: profileKeys.all });
  if (id) void queryClient.invalidateQueries({ queryKey: profileKeys.detail(id) });
}

export function useProfiles(query: ProfileListQuery = { includeArchived: false }) {
  return useQuery({
    queryKey: profileKeys.list(query),
    queryFn: () => getProfiles(query),
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: profileKeys.detail(id),
    queryFn: () => getProfile(id),
    enabled: Boolean(id),
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProfile,
    onSuccess: (profile) => invalidateProfiles(queryClient, profile.id),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProfileUpdate }) => updateProfile(id, input),
    onSuccess: (profile) => invalidateProfiles(queryClient, profile.id),
  });
}

export function useSetProfileArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setProfileArchived(id, archived),
    onSuccess: (profile) => invalidateProfiles(queryClient, profile.id),
  });
}

export function useAddPlatformAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, input }: { profileId: string; input: PlatformAccountInput }) =>
      addPlatformAccount(profileId, input),
    onSuccess: (_account, vars) => invalidateProfiles(queryClient, vars.profileId),
  });
}

export function useUpdatePlatformAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      profileId,
      accountId,
      input,
    }: { profileId: string; accountId: string; input: PlatformAccountUpdate }) =>
      updatePlatformAccount(profileId, accountId, input),
    onSuccess: (_account, vars) => invalidateProfiles(queryClient, vars.profileId),
  });
}

export function useDeletePlatformAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, accountId }: { profileId: string; accountId: string }) =>
      deletePlatformAccount(profileId, accountId),
    onSuccess: (_void, vars) => invalidateProfiles(queryClient, vars.profileId),
  });
}

export type { ProfileInput };
