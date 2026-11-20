import type {
  ApplyInsightBody,
  InsightApplyField,
  InsightRunResult,
  LearningSettingsBody,
  LearningView,
  ProfileInsight,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getLearning(profileId: string): Promise<LearningView> {
  return apiRequest<LearningView>(`/profiles/${encodeURIComponent(profileId)}/learning`);
}

export function saveLearningSettings(profileId: string, body: LearningSettingsBody): Promise<LearningView> {
  return apiRequest<LearningView>(`/profiles/${encodeURIComponent(profileId)}/learning/settings`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function runInsight(profileId: string): Promise<InsightRunResult> {
  return apiRequest<InsightRunResult>(`/profiles/${encodeURIComponent(profileId)}/learning/run`, {
    method: "POST",
  });
}

export function undoInsight(profileId: string): Promise<LearningView> {
  return apiRequest<LearningView>(`/profiles/${encodeURIComponent(profileId)}/learning/undo`, {
    method: "POST",
  });
}

export function applyInsight(profileId: string, insightId: string, fields: InsightApplyField[]): Promise<ProfileInsight> {
  const body: ApplyInsightBody = { fields };
  return apiRequest<ProfileInsight>(
    `/profiles/${encodeURIComponent(profileId)}/insights/${encodeURIComponent(insightId)}/apply`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** TASK-148a/b: lessons per stage, proposed by the weekly job and decided by a human. */
export type StageNoteStatus = "proposed" | "approved" | "rejected" | "retired";
export type StageNote = {
  id: string;
  profileId: string | null;
  stage: string;
  text: string;
  evidenceIds: string[];
  status: StageNoteStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  uses: number;
  lastUsedAt: string | null;
};

export function getStageNotes(profileId: string): Promise<StageNote[]> {
  return apiRequest<StageNote[]>(`/profiles/${encodeURIComponent(profileId)}/stage-notes`);
}

export function decideStageNote(
  profileId: string,
  noteId: string,
  decision: "approve" | "reject" | "retire" | "undo",
): Promise<{ status: StageNoteStatus }> {
  return apiRequest<{ status: StageNoteStatus }>(
    `/profiles/${encodeURIComponent(profileId)}/stage-notes/${encodeURIComponent(noteId)}/decision`,
    { method: "POST", body: JSON.stringify({ decision }) },
  );
}

export function dismissInsight(
  profileId: string,
  insightId: string,
  fields?: InsightApplyField[],
): Promise<ProfileInsight> {
  return apiRequest<ProfileInsight>(
    `/profiles/${encodeURIComponent(profileId)}/insights/${encodeURIComponent(insightId)}/dismiss`,
    { method: "POST", body: JSON.stringify(fields ? { fields } : {}) },
  );
}
