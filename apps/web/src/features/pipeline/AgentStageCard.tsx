import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isPlannedTimeoutStage, STAGE_TIMEOUT_LABELS_VI, type Job } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { useCan } from "../../hooks/useCan";
import { pipelineKeys } from "../../hooks/usePipeline";

const clock = (value: string) => new Date(value).toLocaleTimeString("vi-VN");
export function AgentStageCard({ projectId, job }: { projectId: string; job: Job }) {
  const client = useQueryClient(), mayRun = useCan("stage.run");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(timer); }, []);
  const takeBack = useMutation({
    mutationFn: () => apiRequest(`/stage-agents/jobs/${job.id}/take-back`, { method: "POST", body: "{}" }),
    onSuccess: () => client.invalidateQueries({ queryKey: pipelineKeys.detail(projectId) }),
  });
  const queued = job.status === "QUEUED";
  const since = job.startedAt ?? job.handoffAt;
  const age = job.heartbeatAt ? Math.max(0, Math.floor((now - Date.parse(job.heartbeatAt)) / 1000)) : null;
  return <section className="agent-stage-card" aria-label="Stage do agent xử lý">
    <div className="agent-stage-heading">
      <strong>{isPlannedTimeoutStage(job.stage) ? STAGE_TIMEOUT_LABELS_VI[job.stage] : job.stage}</strong>
      <span className="status-badge status-badge-warn">{queued ? "Chờ agent nhận" : "Agent đang xử lý"}</span>
    </div>
    <p>{job.agentInstance ? `Agent ${job.agentInstance} đang xử lý` : "Đang chờ agent phù hợp"}{since && <> · từ <time dateTime={since}>{clock(since)}</time></>}</p>
    {job.handoffReason && <p>Lý do: {job.handoffReason}</p>}
    <p role="status">{job.heartbeatAt ? <>Heartbeat: <time dateTime={job.heartbeatAt}>{clock(job.heartbeatAt)}</time> · {age! < 60 ? `${age} giây trước` : `${Math.floor(age! / 60)} phút trước`}</> : "Chưa có heartbeat từ agent."}
      {!queued && job.leaseUntil && Date.parse(job.leaseUntil) <= now && " · Đã hết hạn, đang chờ nhận lại."}</p>
    {mayRun && <button type="button" className="button button-secondary" disabled={takeBack.isPending} onClick={() => takeBack.mutate()}>{takeBack.isPending ? "Đang lấy lại…" : "Lấy lại cho app"}</button>}
    {takeBack.isError && <p role="alert" className="request-error">{takeBack.error instanceof Error ? takeBack.error.message : "Không lấy lại được stage."}</p>}
  </section>;
}
