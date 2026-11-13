import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectListQuery } from "@vg/shared";
import {
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  getProjects,
  setProjectArchived,
  updateProject,
} from "../services/projectsApi";
import { getDashboardStats } from "../services/dashboardApi";

export const projectKeys = {
  all: ["projects"] as const,
  list: (query: ProjectListQuery) => ["projects", query] as const,
  detail: (id: string) => ["project", id] as const,
  dashboard: ["dashboard"] as const,
};

function invalidateProjectData(queryClient: ReturnType<typeof useQueryClient>, id?: string): void {
  void queryClient.invalidateQueries({ queryKey: projectKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectKeys.dashboard });
  if (id) void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
}

export function useProjects(query: ProjectListQuery) {
  return useQuery({
    queryKey: projectKeys.list(query),
    queryFn: () => getProjects(query),
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      const hasActive = items?.some((p) => p.status === "GENERATING" || p.status === "RENDERING");
      return hasActive ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const project = query.state.data;
      const isActive = project?.status === "GENERATING" || project?.status === "RENDERING";
      return isActive ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useDashboardStats() {
  return useQuery({
    queryKey: projectKeys.dashboard,
    queryFn: getDashboardStats,
    refetchInterval: (query) => {
      const recent = query.state.data?.recent;
      const hasActive = recent?.some((p) => p.status === "GENERATING" || p.status === "RENDERING");
      return hasActive ? 3000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: (project) => invalidateProjectData(queryClient, project.id),
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateProject>[1] }) => updateProject(id, input),
    onSuccess: (project) => invalidateProjectData(queryClient, project.id),
  });
}

export function useDuplicateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: duplicateProject,
    onSuccess: (project) => invalidateProjectData(queryClient, project.id),
  });
}

export function useSetProjectArchived() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setProjectArchived(id, archived),
    onSuccess: (project) => invalidateProjectData(queryClient, project.id),
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_result, id) => {
      void queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
      invalidateProjectData(queryClient);
    },
  });
}
