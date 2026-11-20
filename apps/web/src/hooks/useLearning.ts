import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InsightApplyField, LearningMode } from "@vg/shared";
import {
  applyInsight,
  decideStageNote,
  dismissInsight,
  getLearning,
  getStageNotes,
  runInsight,
  saveLearningSettings,
  undoInsight,
} from "../services/learningApi";

export const learningKeys = {
  view: (id: string) => ["learning", id] as const,
};

export function useLearning(profileId: string) {
  return useQuery({
    queryKey: learningKeys.view(profileId),
    queryFn: () => getLearning(profileId),
    enabled: Boolean(profileId),
  });
}

export function useSaveLearningSettings(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { learningMode?: LearningMode; titleAbTest?: boolean }) => saveLearningSettings(profileId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.view(profileId) });
    },
  });
}

export function useRunInsight(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runInsight(profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.view(profileId) });
    },
  });
}

export function useApplyInsight(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { insightId: string; fields: InsightApplyField[] }) =>
      applyInsight(profileId, input.insightId, input.fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.view(profileId) });
    },
  });
}

export function useDismissInsight(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { insightId: string; fields?: InsightApplyField[] }) =>
      dismissInsight(profileId, input.insightId, input.fields),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.view(profileId) });
    },
  });
}

export function useStageNotes(profileId: string) {
  return useQuery({
    queryKey: ["stage-notes", profileId] as const,
    queryFn: () => getStageNotes(profileId),
    enabled: Boolean(profileId),
  });
}

export function useDecideStageNote(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { noteId: string; decision: "approve" | "reject" | "retire" | "undo" }) =>
      decideStageNote(profileId, input.noteId, input.decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["stage-notes", profileId] });
    },
  });
}

export function useUndoInsight(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => undoInsight(profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: learningKeys.view(profileId) });
    },
  });
}
