import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PipelineEvent, PipelineStage, PipelineState } from "@vg/shared";
import { projectKeys } from "./useProjects";
import { scriptKeys } from "./useScript";
import { pipelinePollingDelay } from "./pipelinePolling";
import {
  approvePipelineGate,
  cancelPipeline,
  getPipeline,
  retryPipelineStage,
  runPipeline,
} from "../services/pipelineApi";

export const pipelineKeys = {
  detail: (id: string) => ["pipeline", id] as const,
};

type PipelineAction =
  | { type: "run"; stage?: PipelineStage; confirmOverwrite?: boolean }
  | { type: "approve"; stage: PipelineStage }
  | { type: "cancel" }
  | { type: "retry"; stage: PipelineStage };

function isPipelineState(value: unknown): value is PipelineState {
  return typeof value === "object" && value !== null && "stages" in value && "projectId" in value;
}

export function usePipeline(projectId: string) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: pipelineKeys.detail(projectId),
    queryFn: () => getPipeline(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!projectId || typeof EventSource === "undefined") return undefined;
    const source = new EventSource(`/api/projects/${projectId}/events`);
    let polling: ReturnType<typeof setTimeout> | undefined;
    let pollingAttempt = 0;
    let refetchTimeout: ReturnType<typeof setTimeout> | undefined;
    const stopPolling = () => {
      if (polling !== undefined) clearTimeout(polling);
      polling = undefined;
      pollingAttempt = 0;
    };
    const scheduleRefetch = () => {
      if (refetchTimeout) clearTimeout(refetchTimeout);
      refetchTimeout = setTimeout(() => {
        refetchTimeout = undefined;
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(projectId) });
      }, 500);
    };
    const startPolling = () => {
      if (polling) return;
      const poll = () => {
        polling = setTimeout(() => {
          polling = undefined;
          pollingAttempt += 1;
          void queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(projectId) });
          poll();
        }, pipelinePollingDelay(pollingAttempt));
      };
      poll();
    };
    const onSnapshot = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as { data?: unknown };
      if (isPipelineState(event.data)) {
        queryClient.setQueryData(pipelineKeys.detail(projectId), event.data);
      }
    };
    const onEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as PipelineEvent;
      if (event.type === "stage.updated") {
        if (event.data.stage === "SCENE_PLAN") {
          void queryClient.invalidateQueries({ queryKey: ["scenes", projectId] });
        }
        if ((event.data.stage === "RESEARCH" || event.data.stage === "SCRIPT") && event.data.state === "DONE") {
          void queryClient.invalidateQueries({ queryKey: scriptKeys.detail(projectId) });
          void queryClient.invalidateQueries({ queryKey: ["project-jobs", projectId] });
        }
        queryClient.setQueryData<PipelineState>(pipelineKeys.detail(projectId), (current) => {
          if (!current) return current;
          const record = event.data;
          return { ...current, stages: current.stages.map((stage) => stage.stage === record.stage ? record : stage) };
        });
      } else if (event.type === "job.updated") {
        queryClient.setQueryData<PipelineState>(pipelineKeys.detail(projectId), (current) => {
          if (!current) return current;
          if (event.data.status === "QUEUED" || event.data.status === "RUNNING") {
            return { ...current, activeJob: event.data };
          }
          if (current.activeJob?.id === event.data.id) {
            return { ...current, activeJob: null };
          }
          return current;
        });
      } else if (event.type === "project.updated") {
        queryClient.setQueryData<PipelineState>(pipelineKeys.detail(projectId), (current) => {
          if (!current) return current;
          return {
            ...current,
            currentStage: event.data.stage,
            status: event.data.status,
            runMode: event.data.status === "COMPLETED" || event.data.status === "DRAFT"
              ? null
              : current.runMode,
          };
        });
        void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
        void queryClient.invalidateQueries({ queryKey: projectKeys.dashboard });
      }
      if (event.type !== "heartbeat") {
        scheduleRefetch();
      }
    };
    const onOpen = () => stopPolling();
    source.addEventListener("pipeline.snapshot", onSnapshot as EventListener);
    source.addEventListener("job.updated", onEvent as EventListener);
    source.addEventListener("stage.updated", onEvent as EventListener);
    source.addEventListener("project.updated", onEvent as EventListener);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", startPolling);
    return () => {
      stopPolling();
      if (refetchTimeout) clearTimeout(refetchTimeout);
      source.close();
    };
  }, [projectId, queryClient]);

  const mutation = useMutation({
    mutationFn: (action: PipelineAction) => {
      switch (action.type) {
        case "run": return runPipeline(projectId, action.stage, action.confirmOverwrite);
        case "approve": return approvePipelineGate(projectId, action.stage);
        case "cancel": return cancelPipeline(projectId);
        case "retry": return retryPipelineStage(projectId, action.stage);
      }
    },
    onSuccess: (pipeline) => {
      queryClient.setQueryData(pipelineKeys.detail(projectId), pipeline);
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.dashboard });
    },
  });

  return { ...query, action: mutation.mutateAsync, isMutating: mutation.isPending };
}
