import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveScriptInput } from "@vg/shared";
import { getScript, rescoreScript, saveScript, switchScriptHook } from "../services/scriptApi";
import { projectKeys } from "./useProjects";

export const scriptKeys = {
  detail: (projectId: string) => ["script", projectId] as const,
};

export function useScript(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: scriptKeys.detail(projectId),
    queryFn: () => getScript(projectId),
    enabled: Boolean(projectId),
  });
  const mutation = useMutation({
    mutationFn: (script: SaveScriptInput) => saveScript(projectId, script),
    onSuccess: (data) => {
      queryClient.setQueryData(scriptKeys.detail(projectId), data);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
  const hookMutation = useMutation({
    mutationFn: (hookId: string) => switchScriptHook(projectId, hookId),
    onSuccess: (data) => {
      queryClient.setQueryData(scriptKeys.detail(projectId), data);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
  const critiqueMutation = useMutation({
    mutationFn: () => rescoreScript(projectId),
    onSuccess: (data) => {
      queryClient.setQueryData(scriptKeys.detail(projectId), data);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
  return {
    ...query,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    switchHook: hookMutation.mutateAsync,
    isSwitchingHook: hookMutation.isPending,
    rescore: critiqueMutation.mutateAsync,
    isRescoring: critiqueMutation.isPending,
  };
}
