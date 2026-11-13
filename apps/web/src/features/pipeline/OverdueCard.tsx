import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OVERDUE_LABEL_VI, type OverdueCheckRow, type OverdueJob } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { documentHidden } from "../../hooks/usePageVisible";
import { useCan } from "../../hooks/useCan";

type OverdueData = { job: OverdueJob | null; checks: OverdueCheckRow[] };

const ACTION_VI: Record<string, string> = {
  wait: "Chờ thêm",
  escalate: "Chuyển cho Hermes xem",
  abort_retry: "Dừng và thử lại",
  abort_fail: "Dừng hẳn",
  ask_user: "Hỏi bạn",
};
const SOURCE_VI: Record<string, string> = {
  ladder: "quy tắc", llm: "AI kiểm tra", override: "quy tắc", hermes: "Hermes", user: "bạn",
};

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} phút`;

/** TASK-125: a stage past its expected time, what was checked, and the three buttons that decide. */
export function OverdueCard({ projectId, active }: { projectId: string; active: boolean }) {
  const client = useQueryClient();
  const mayRun = useCan("stage.run");
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["overdue", projectId],
    queryFn: () => apiRequest<OverdueData>(`/projects/${projectId}/overdue`),
    enabled: active,
    refetchInterval: () => (documentHidden() ? false : 15_000),
  });
  const decide = useMutation({
    mutationFn: (input: { jobId: string; action: "wait" | "abort_retry" | "abort_fail" }) =>
      apiRequest(`/jobs/${input.jobId}/overdue-decision`, { method: "POST", body: JSON.stringify({ action: input.action }) }),
    onSuccess: () => {
      setError("");
      void client.invalidateQueries({ queryKey: ["overdue", projectId] });
      void client.invalidateQueries({ queryKey: ["pipeline", projectId] });
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Không gửi được quyết định."),
  });

  const job = query.data?.job;
  if (!active || !job) return null;
  const checks = query.data?.checks ?? [];
  const last = checks[checks.length - 1];
  const waiting = job.state === "waiting_decision";
  return (
    <section className="panel overdue-card" aria-label="Bước quá thời gian dự kiến" role="status">
      <div className="overdue-card-header">
        <span className="status-badge status-badge-warn">Quá dự kiến</span>
        <strong>{job.stage.replaceAll("_", " ")}</strong>
        <span>
          đã chạy {minutes(job.elapsedMs)}
          {job.expectedMs ? ` / dự kiến ${minutes(job.expectedMs)}` : ""}
        </span>
      </div>
      <p className="overdue-card-state">
        {waiting ? "Đang chờ quyết định (Hermes hoặc bạn)." : OVERDUE_LABEL_VI}
        {job.nextCheckAt && !waiting ? ` Kiểm tra tiếp lúc ${new Date(job.nextCheckAt).toLocaleTimeString("vi-VN")}.` : ""}
      </p>
      {last && (
        <p className="overdue-card-last">
          Lần kiểm gần nhất: <strong>{ACTION_VI[last.action] ?? last.action}</strong> ({SOURCE_VI[last.source] ?? last.source}) — {last.reason}
        </p>
      )}
      {mayRun && (
        <div className="overdue-card-actions">
          <button type="button" className="button button-secondary button-sm" disabled={decide.isPending}
            onClick={() => decide.mutate({ jobId: job.jobId, action: "wait" })}>Chờ thêm</button>
          <button type="button" className="button button-secondary button-sm" disabled={decide.isPending}
            onClick={() => decide.mutate({ jobId: job.jobId, action: "abort_retry" })}>Dừng và thử lại</button>
          <button type="button" className="button button-danger-outline button-sm" disabled={decide.isPending}
            onClick={() => decide.mutate({ jobId: job.jobId, action: "abort_fail" })}>Dừng hẳn</button>
        </div>
      )}
      {error && <p role="alert" className="stage-error">{error}</p>}
      {checks.length > 0 && (
        <details className="overdue-card-history">
          <summary>Lịch sử kiểm tra ({checks.length})</summary>
          <ol>
            {checks.map((check) => (
              <li key={check.id}>
                {new Date(check.at).toLocaleTimeString("vi-VN")} · lần {check.checkNo} · {ACTION_VI[check.action] ?? check.action}
                {" "}({SOURCE_VI[check.source] ?? check.source}) — {check.reason}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
