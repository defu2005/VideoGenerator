import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../../services/apiClient";
import { OperatorEventRules } from "./OperatorEventRules";

const labels: Record<string, string> = {
  job_failed: "Job lỗi", render_completed: "Render hoàn tất",
  quota_wait: "Chờ quota", approval_wait: "Chờ duyệt", job_overdue: "Bước chạy quá giờ", computer_use: "Computer Use",
};
const outcomes: Record<string, string> = {
  ok: "Xong", stopped: "Đã dừng", needs_check: "Cần kiểm tra", use_tool: "Dùng công cụ API",
};

function ComputerUseDetail({ detail }: { detail: string }) {
  try {
    const parsed = JSON.parse(detail) as { app?: string | null; steps?: string[]; outcome?: string; reason?: string };
    return (
      <p>
        {parsed.app ?? "Computer Use"} · {outcomes[parsed.outcome ?? ""] ?? parsed.outcome}
        {parsed.steps?.length ? ` · Bước: ${parsed.steps.join(", ")}` : ""}
        {parsed.reason ? ` · ${parsed.reason}` : ""}
      </p>
    );
  } catch {
    return null;
  }
}

type Event = {
  id: string; kind: string; projectId: string | null; pendingId: string | null; occurredAt: string; detail?: string | null;
};
type Trace = {
  run: { runtime_id: string | null; model: string | null; status: string } | null;
  message: { id: string; created_at: string } | null;
  pending: { status: string } | null;
  tools: Array<{ tool: string; decision: string; created_at: string }>;
  job: {
    stage: string; status: string; attempt: number; error: { code: string; message: string } | null;
    usage: { inputTokens?: number; outputTokens?: number; costUsd?: number;
      calls?: Array<{ provider: string; model: string; fallback: boolean; fallbackReason?: string }> } | null;
  } | null;
};

export function OperatorEvents() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Event | null>(null);
  const events = useQuery({
    queryKey: ["operator", "events"], enabled: open,
    queryFn: () => apiRequest<{ items: Event[] }>("/operator/events"),
  });
  const trace = useQuery({
    queryKey: ["operator", "events", selected?.id], enabled: open && selected !== null,
    queryFn: () => apiRequest<Trace>(`/operator/events/${encodeURIComponent(selected!.id)}`),
  });
  const error = events.error ?? trace.error;
  const details = trace.data;
  return (
    <section className="panel">
      <h2>Sự kiện</h2>
      <details>
        <summary>Quy tắc thông báo và đánh thức</summary>
        <OperatorEventRules />
      </details>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Xem sự kiện gần đây</summary>
        {open && events.isPending ? <p>Đang tải sự kiện…</p> : null}
        {error ? <p role="alert">{error.message}</p> : null}
        {events.data?.items.length === 0 ? <p>Chưa có sự kiện.</p> : null}
        <ul>{events.data?.items.map((item) => (
          <li key={item.id}>
            <button type="button" aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}>
              {labels[item.kind] ?? item.kind} · <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString("vi-VN")}</time>
            </button>
          </li>
        ))}</ul>
        {selected && trace.isPending ? <p>Đang tải chi tiết…</p> : null}
        {details ? (
          <div>
            {selected?.detail ? <ComputerUseDetail detail={selected.detail} /> : null}
            {selected?.projectId ? <Link to={`/projects/${selected.projectId}`}>Mở dự án</Link> : null}
            {selected?.pendingId && details.pending?.status === "pending" ? <a href={`#operator-approval-${selected.pendingId}`}>Đến thẻ duyệt</a> : null}
            {details.run ? <p>Agent: {details.run.runtime_id ?? "Chưa rõ"} · Model: {details.run.model ?? "Chưa rõ"} · {details.run.status}</p> : null}
            {details.message ? <p>Tin nhắn nguồn: <code>{details.message.id}</code></p> : null}
            {details.job ? <p>{details.job.stage} · {details.job.status} · Lần thử {details.job.attempt}</p> : null}
            {details.job?.error ? <p>{details.job.error.code} · {details.job.error.message}</p> : null}
            {details.job?.usage ? <p>Token vào: {details.job.usage.inputTokens ?? "Chưa rõ"} · Token ra: {details.job.usage.outputTokens ?? "Chưa rõ"} · Chi phí: {details.job.usage.costUsd ?? "Chưa rõ"} USD</p> : null}
            <ul>{details.job?.usage?.calls?.map((call, index) => (
              <li key={index}>{call.provider}/{call.model}{call.fallback ? ` · Dự phòng${call.fallbackReason ? ` (${call.fallbackReason})` : ""}` : ""}</li>
            ))}</ul>
            <ul>{details.tools.map((tool, index) => <li key={index}>{tool.tool} · {tool.decision}</li>)}</ul>
          </div>
        ) : null}
      </details>
    </section>
  );
}
