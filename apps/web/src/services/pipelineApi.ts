import type { Job, PipelineStage, PipelineState } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getPipeline(projectId: string): Promise<PipelineState> {
  return apiRequest<PipelineState>(`/projects/${projectId}/pipeline`);
}

export function runPipeline(projectId: string, stage?: PipelineStage, confirmOverwrite = false): Promise<PipelineState> {
  return apiRequest<PipelineState>(`/projects/${projectId}/pipeline/run`, {
    method: "POST",
    body: JSON.stringify({ ...(stage ? { stage } : {}), ...(confirmOverwrite ? { confirmOverwrite: true } : {}) }),
  });
}

export function approvePipelineGate(projectId: string, gate: PipelineStage): Promise<PipelineState> {
  return apiRequest<PipelineState>(`/projects/${projectId}/pipeline/gates/${gate}/approve`, { method: "POST" });
}

export function cancelPipeline(projectId: string): Promise<PipelineState> {
  return apiRequest<PipelineState>(`/projects/${projectId}/pipeline/cancel`, { method: "POST" });
}

export function retryPipelineStage(projectId: string, stage: PipelineStage): Promise<PipelineState> {
  return apiRequest<PipelineState>(`/projects/${projectId}/pipeline/stages/${stage}/retry`, { method: "POST" });
}

export function getProjectJobs(projectId: string, limit = 20): Promise<Job[]> {
  return apiRequest<Job[]>(`/projects/${projectId}/jobs?limit=${limit}`);
}
