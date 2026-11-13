import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";

type State = {
  heartbeat: { observedAt: string; runningJobs: number; queuedJobs: number } | null;
  findings: { id: string; kind: string; severity: string; status: string }[];
};

const LABELS: Record<string, string> = {
  job_stalled: "Job vượt thời gian chạy",
  breaker_open: "Bước pipeline tạm dừng",
  account_attention: "Tài khoản cần kiểm tra kết nối",
  disk_low: "Dung lượng trống thấp",
  worker_idle: "Worker chưa nhận job",
  topics_low: "Thiếu chủ đề đã duyệt",
  slot_at_risk: "Lịch đăng chưa có bản render",
  llm_failover_storm: "AI đổi nhà cung cấp liên tục (quota/giới hạn)",
  quota_wait: "Chờ quota nhà cung cấp",
  budget_warn: "Chi phí gần chạm hạn mức",
  budget_stop: "Chi phí đã chạm hạn mức",
  loop_guard: "Đã dừng thao tác lặp",
  restarted: "Server đã khởi động lại",
  missed_publish: "Lịch đăng bị lỡ cần xem lại",
};

export function SupervisorStatusPanel({ profileId }: { profileId?: string }) {
  const [open, setOpen] = useState(false);
  const scope = profileId ?? "app";
  const state = useQuery({
    queryKey: ["supervisor", scope],
    queryFn: () => apiRequest<State>(`/autonomy/${scope}/supervisor`),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });
  const heartbeat = state.data?.heartbeat;
  return <details className="panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Giám sát tự vận hành</summary>
    {open && <>
      {state.isPending && <p role="status">Đang tải tình trạng giám sát…</p>}
      {state.isError && <p role="alert">{state.error.message}</p>}
      {state.isSuccess && <>
        <p>{heartbeat ? `Kiểm tra gần nhất ${new Date(heartbeat.observedAt).toLocaleString("vi-VN")}. Toàn app có ${heartbeat.runningJobs} job đang chạy và ${heartbeat.queuedJobs} job chờ.`
          : "Chưa có lần kiểm tra nào. Supervisor chạy khi worker được bật."}</p>
        {state.data.findings.length ? <ul>{state.data.findings.map((finding) => (
          <li key={finding.id}>{LABELS[finding.kind] ?? finding.kind}{finding.status === "escalated" ? " · Cần xử lý" : ""}</li>
        ))}</ul> : <p>Chưa có sự cố đang theo dõi.</p>}
      </>}
    </>}
  </details>;
}
