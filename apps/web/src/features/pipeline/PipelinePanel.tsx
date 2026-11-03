import { estimateBudget, GATES, STAGE_ORDER, type Project } from "@vg/shared";
import { useState } from "react";
import { ApiRequestError } from "../../services/apiClient";
import { usePipeline } from "../../hooks/usePipeline";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { StageRow } from "./StageRow";

export function PipelinePanel({ projectId, project }: { projectId: string; project?: Project }) {
  const pipeline = usePipeline(projectId);
  const [actionError, setActionError] = useState("");

  if (pipeline.isPending) return <section className="panel pipeline-card"><Spinner label="Loading pipeline" /></section>;
  if (pipeline.isError) {
    return <section className="panel pipeline-card"><ErrorState message={pipeline.error instanceof Error ? pipeline.error.message : "Unable to load pipeline"} onRetry={() => void pipeline.refetch()} /></section>;
  }

  const state = pipeline.data;
  const active = state.activeJob !== null;
  const waitingAtGate = state.stages.some((stage) => stage.state === "WAITING_USER");
  const busy = active || pipeline.isMutating;
  const stages = STAGE_ORDER.map((stage) => state.stages.find((record) => record.stage === stage)).filter((record) => record !== undefined);
  const estimate = project ? estimateBudget(
    project,
    [
      project.settings.llm?.research?.provider,
      project.settings.llm?.script?.provider,
      project.settings.llm?.default?.provider,
    ].filter((provider): provider is string => provider !== undefined),
    state.stages,
  ) : undefined;
  const estimateCalls = estimate
    ? estimate.total.min === estimate.total.max
      ? String(estimate.total.min)
      : `${estimate.total.min}–${estimate.total.max}`
    : undefined;
  const perform = async (action: Parameters<typeof pipeline.action>[0]) => {
    setActionError("");
    try {
      await pipeline.action(action);
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "Pipeline action failed");
    }
  };
  const canRunStage = (recordIndex: number) => {
    const record = stages[recordIndex];
    if (!record || GATES.includes(record.stage) || active) return false;
    return stages.slice(0, recordIndex).every((previous) => previous.state === "DONE" || previous.state === "SKIPPED");
  };

  return (
    <section className="panel pipeline-card" aria-label="Pipeline">
      <div className="pipeline-panel-heading">
        <div><p className="eyebrow">PIPELINE</p><h2>Production stages</h2></div>
        <div className="pipeline-top-actions">
          <button className="button button-primary" type="button" disabled={busy || waitingAtGate} onClick={() => void perform({ type: "run" })}>
            {state.status === "COMPLETED" ? "Regenerate All" : "Generate All"}
          </button>
          {active && <button className="button button-danger-outline" type="button" disabled={pipeline.isMutating} onClick={() => void perform({ type: "cancel" })}>Cancel</button>}
        </div>
      </div>
      {estimate && (
        <p className="pipeline-budget-estimate" role="status">
          <span>{estimate.total.min === 0 && estimate.total.max === 0
            ? "Ước tính: 0 lượt gọi AI (đã có kết quả, dùng cache)"
            : <>Ước tính: ~{estimateCalls} lượt gọi AI ({estimate.mode})
              {estimate.tokens ? ` · ~${estimate.tokens.input + estimate.tokens.output} tokens` : ""}</>}</span>
          <span>{estimate.perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls.max
            ? ` · Visual Search: up to ${estimate.perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls.max} LLM calls`
            : " · Visual Search: 0 LLM calls"}</span>
        </p>
      )}
      {waitingAtGate && <p className="pipeline-mode-hint">Approve the review gate to continue</p>}
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
          />
        ))}
      </ol>
    </section>
  );
}
