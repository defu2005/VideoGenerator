import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveScriptInput } from "@vg/shared";
import { getScript, saveScript } from "../services/scriptApi";

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
    },
  });
  return { ...query, save: mutation.mutateAsync, isSaving: mutation.isPending };
}
