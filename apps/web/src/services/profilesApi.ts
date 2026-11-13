import type {
  PlatformAccount,
  PlatformAccountInput,
  PlatformAccountUpdate,
  ProfileDetail,
  ProfileInput,
  ProfileListQuery,
  ProfileListResponse,
  ProfileUpdate,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getProfiles(query: ProfileListQuery = { includeArchived: false }): Promise<ProfileListResponse> {
  const params = new URLSearchParams();
  if (query.includeArchived) params.set("includeArchived", "true");
  const qs = params.toString();
  return apiRequest<ProfileListResponse>(`/profiles${qs ? `?${qs}` : ""}`);
}

export function getProfile(id: string): Promise<ProfileDetail> {
  return apiRequest<ProfileDetail>(`/profiles/${encodeURIComponent(id)}`);
}

export function createProfile(input: ProfileInput): Promise<ProfileDetail> {
  return apiRequest<ProfileDetail>("/profiles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProfile(id: string, input: ProfileUpdate): Promise<ProfileDetail> {
  return apiRequest<ProfileDetail>(`/profiles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function setProfileArchived(id: string, archived: boolean): Promise<ProfileDetail> {
  const action = archived ? "archive" : "unarchive";
  return apiRequest<ProfileDetail>(`/profiles/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export function addPlatformAccount(profileId: string, input: PlatformAccountInput): Promise<PlatformAccount> {
  return apiRequest<PlatformAccount>(`/profiles/${encodeURIComponent(profileId)}/accounts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePlatformAccount(
  profileId: string,
  accountId: string,
  input: PlatformAccountUpdate,
): Promise<PlatformAccount> {
  return apiRequest<PlatformAccount>(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deletePlatformAccount(profileId: string, accountId: string, unfinishedOnly = false): Promise<void> {
  return apiRequest<void>(
    `/profiles/${encodeURIComponent(profileId)}/accounts/${encodeURIComponent(accountId)}${unfinishedOnly ? "?unfinished=true" : ""}`,
    { method: "DELETE" },
  );
}
