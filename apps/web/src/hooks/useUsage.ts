import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UsageQuery } from "@vg/shared";
import { getProjectUsage, getUsage } from "../services/usageApi";

export const usageKeys = {
  project: (id: string) => ["usage", "project", id] as const,
  app: (query: UsageQuery) => ["usage", "app", query] as const,
};

export function useProjectUsage(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: usageKeys.project(projectId),
    queryFn: () => getProjectUsage(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!projectId || typeof EventSource === "undefined") return undefined;
    const source = new EventSource(`/api/projects/${projectId}/events`);
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: usageKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["usage", "app"] });
    };
    source.addEventListener("job.updated", refresh);
    return () => source.close();
  }, [projectId, queryClient]);

  return query;
}

export function useUsage(query: UsageQuery) {
  return useQuery({
    queryKey: usageKeys.app(query),
    queryFn: () => getUsage(query),
    refetchInterval: 5_000,
  });
}
