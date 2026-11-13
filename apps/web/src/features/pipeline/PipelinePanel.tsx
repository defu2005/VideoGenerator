import { estimateBudget, GATES, STAGE_DEPENDS, STAGE_ORDER, isSideJobStage, type Project } from "@vg/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiRequestError, apiRequest } from "../../services/apiClient";
import { usePipeline } from "../../hooks/usePipeline";
import { ErrorState } from "../../components/ErrorState";
import { useToast } from "../../components/ui/Toast";
import { Spinner } from "../../components/Spinner";
import { pipelineJobs, stageBlocked } from "./activeJobs";
import { StageRow } from "./StageRow";
import { OverdueCard } from "./OverdueCard";
import { getProjectLlmRoutes } from "../../services/llmApi";

export function PipelinePanel({ projectId, project }: { projectId: string; project?: Project }) {
  const pipeline = usePipeline(projectId);
  const routes = useQuery({
    queryKey: ["project-llm-routes", projectId],
    queryFn: () => getProjectLlmRoutes(projectId),
    enabled: Boolean(project),
  });
  const health = useQuery({
    queryKey: ["server-health"],
    queryFn: () => apiRequest<{ render?: string }>("/health"),
    staleTime: 15_000,
  });
  const toast = useToast();
  const [actionError, setActionError] = useState("");

  if (pipeline.isPending) return <section className="panel pipeline-card"><Spinner label="Đang tải quy trình" /></section>;
  if (pipeline.isError) {
    return <section className="panel pipeline-card"><ErrorState message={pipeline.error instanceof Error ? pipeline.error.message : "Unable to load pipeline"} onRetry={() => void pipeline.refetch()} /></section>;
  }

  const state = pipeline.data;
  const jobs = pipelineJobs(state);
  const active = jobs.length > 0;
  const waitingAtGate = state.stages.some((stage) => stage.state === "WAITING_USER");
  const laneStillRunning = waitingAtGate && jobs.some((job) => !isSideJobStage(job.stage));
  const busy = active || pipeline.isMutating;
  const stages = STAGE_ORDER.map((stage) => state.stages.find((record) => record.stage === stage)).filter((record) => record !== undefined);
  const estimate = project ? estimateBudget(project, routes.data, state.stages) : undefined;
  const estimateCalls = estimate
    ? estimate.total.min === estimate.total.max
      ? String(estimate.total.min)
      : `${estimate.total.min}–${estimate.total.max}`
    : undefined;
  const perform = async (action: Parameters<typeof pipeline.action>[0]) => {
    setActionError("");
    try {
      await pipeline.action(action);
      const message = action.type === "approve"
        ? "Đã duyệt cổng"
        : action.type === "cancel"
          ? action.stage ? "Đã hủy làn này" : "Đã hủy bước đang chạy"
          : action.type === "retry"
            ? "Đã chạy lại bước"
            : "Đã xếp bước chạy";
      toast.success(message);
    } catch (error) {
      const message = error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "Pipeline action failed";
      setActionError(message);
      toast.error(message);
    }
  };
  const canRunStage = (recordIndex: number) => {
    const record = stages[recordIndex];
    if (!record || GATES.includes(record.stage) || stageBlocked(record.stage, state)) return false;
    const done = new Set(stages.filter((item) => item.state === "DONE" || item.state === "SKIPPED").map((item) => item.stage));
    return STAGE_DEPENDS[record.stage].every((dep) => done.has(dep));
  };

  return (
    <section className="panel pipeline-card" aria-label="Pipeline">
      <div className="pipeline-panel-heading">
        <div><p className="eyebrow">PIPELINE</p><h2>Production stages</h2></div>
        <div className="pipeline-top-actions">
          <button className="button button-primary" type="button" disabled={busy || waitingAtGate} onClick={() => void perform({ type: "run" })}>
            {state.status === "COMPLETED" ? "Regenerate All" : "Generate All"}
          </button>
          {active && <button className="button button-danger-outline" type="button" title="Hủy mọi việc của dự án" disabled={pipeline.isMutating} onClick={() => void perform({ type: "cancel" })}>Cancel</button>}
        </div>
      </div>
      <OverdueCard projectId={projectId} active={active} />
      {estimate && (
        <p className="pipeline-budget-estimate" role="status">
          <span>{estimate.total.min === 0 && estimate.total.max === 0
            ? "Ước tính: 0 lượt gọi AI (đã có kết quả, dùng cache)"
            : <>Ước tính: ~{estimateCalls} lượt gọi AI ({estimate.mode})
              {estimate.tokens ? ` · ~${estimate.tokens.input + estimate.tokens.output} tokens` : ""}</>}</span>
          <span>{estimate.perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls.max
            ? ` · Visual Search: up to ${estimate.perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls.max} LLM calls`
            : " · Visual Search: 0 LLM calls"}</span>
          {routes.isError && <span> · Unable to load resolved model routes</span>}
        </p>
      )}
      {estimate?.perStage.flatMap((stage) => stage.tasks ?? [])
        .filter((task) => task.calls.max > 0)
        .map((task) => (
          <p className="pipeline-budget-task" key={task.task}>
            {task.task}: {task.provider ?? "provider not configured"}{task.model ? ` · ${task.model}` : ""}
            {" · "}{task.calls.min === task.calls.max ? task.calls.min : `${task.calls.min}–${task.calls.max}`} calls
          </p>
        ))}
      {waitingAtGate && <p className="pipeline-mode-hint">Approve the review gate to continue</p>}
      {laneStillRunning && <p className="pipeline-mode-hint">Giọng, phụ đề và nhạc vẫn chạy khi ảnh đang chờ bạn.</p>}
      {typeof health.data?.render === "string" && health.data.render.startsWith("render:") && (
        <p className="pipeline-mode-hint">{health.data.render}</p>
      )}
      <p className="pipeline-mode-hint">{state.mode}: {state.mode === "MANUAL" ? "run each stage when you are ready" : state.mode === "AUTO" ? "the agent continues through review gates automatically" : "the agent pauses at review gates"}.</p>
      {actionError && <p className="request-error" role="alert">{actionError}</p>}
      <ol className="pipeline-stage-list">
        {stages.map((record, index) => (
          <StageRow
            key={record.stage}
            record={record}
            canRun={canRunStage(index)}
            busy={pipeline.isMutating}
            onRun={() => void perform({ type: "run", stage: record.stage })}
            onRetry={() => void perform({ type: "retry", stage: record.stage })}
            onApprove={() => void perform({ type: "approve", stage: record.stage })}
            onCancel={GATES.includes(record.stage) ? undefined : () => void perform({ type: "cancel", stage: record.stage })}
            machine={record.stage === "RENDER" ? machineOf(jobs.find((job) => job.stage === "RENDER")) : undefined}
          />
        ))}
      </ol>
    </section>
  );
}

/** Worker name of an active job, null when it runs on the main machine, undefined when there is no job. */
function machineOf(job: { nodeName?: string | null } | undefined): string | null | undefined {
  if (!job) return undefined;
  return job.nodeName ?? null;
}
