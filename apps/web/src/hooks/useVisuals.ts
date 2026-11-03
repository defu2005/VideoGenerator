import { useQuery } from "@tanstack/react-query";
import { getProjectVisuals } from "../services/visualsApi";

export const visualKeys = {
  project: (projectId: string) => ["visuals", projectId] as const,
};

export function useVisuals(projectId: string) {
  return useQuery({
    queryKey: visualKeys.project(projectId),
    queryFn: () => getProjectVisuals(projectId),
    enabled: Boolean(projectId),
  });
}
