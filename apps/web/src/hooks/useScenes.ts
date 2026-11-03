import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ScenePatch } from "@vg/shared";
import { deleteScene, getScenes, mergeScenes, reorderScenes, splitScene, updateScene } from "../services/scenesApi";

export const sceneKeys = {
  detail: (projectId: string) => ["scenes", projectId] as const,
};

export function useScenes(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: sceneKeys.detail(projectId),
    queryFn: () => getScenes(projectId),
    enabled: Boolean(projectId),
  });
  const mutation = useMutation({
    mutationFn: async (action:
      | { type: "update"; sceneId: string; patch: ScenePatch }
      | { type: "reorder"; sceneIds: string[] }
      | { type: "split"; sceneId: string; sentenceIndex: number }
      | { type: "merge"; sceneIds: [string, string] }
      | { type: "delete"; sceneId: string }) => {
      switch (action.type) {
        case "update": return updateScene(projectId, action.sceneId, action.patch);
        case "reorder": return reorderScenes(projectId, action.sceneIds);
        case "split": return splitScene(projectId, action.sceneId, action.sentenceIndex);
        case "merge": return mergeScenes(projectId, action.sceneIds);
        case "delete": return deleteScene(projectId, action.sceneId);
      }
    },
    onSuccess: (summary) => queryClient.setQueryData(sceneKeys.detail(projectId), summary),
  });
  return { ...query, mutate: mutation.mutateAsync, isMutating: mutation.isPending };
}
