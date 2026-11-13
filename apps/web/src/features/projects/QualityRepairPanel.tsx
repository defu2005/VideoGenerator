import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

type RepairLog = {
  attempts: number;
  maxAttempts: number;
  renders: number;
  sceneChanges: number;
  summary: string;
  rows: Array<{
    id: string; issueKind: string; action: string; chosenBy: "agent" | "ladder"; outcome: string; costUsd: number; createdAt: string; sceneId: string | null;
  }>;
};

const OUTCOME_VI: Record<string, string> = { passed: "đạt", failed: "chưa đạt", error: "lỗi", pending: "đang chờ kiểm" };

/** Read-only list of what the agent repaired (TASK-121). Shelved projects get a reopen button. */
export function QualityRepairPanel({ project }: { project: Project }) {
  const client = useQueryClient();
  const log = useQuery({
    queryKey: ["quality-repairs", project.id],
    queryFn: () => apiRequest<RepairLog>(`/projects/${project.id}/quality-repairs`),
  });
  const reopen = useMutation({
    mutationFn: () => apiRequest(`/projects/${project.id}/quality-repairs/reopen`, { method: "POST" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["quality-repairs", project.id] });
      void client.invalidateQueries({ queryKey: ["project", project.id] });
    },
  });
  const shelved = project.status === "SHELVED";
  const rows = Array.isArray(log.data?.rows) ? log.data.rows : [];
  if (!shelved && rows.length === 0) return null;
  return (
    <section className="panel" aria-label="Tự sửa chất lượng">
      <h2>Tự sửa chất lượng</h2>
      {shelved ? <p role="status">Video đã được gác vì hết lượt tự sửa. Bấm Mở lại để làm tiếp.</p> : null}
      {log.data ? <p>{log.data.attempts}/{log.data.maxAttempts} lượt{log.data.summary ? ` · ${log.data.summary}` : ""}</p> : null}
      {rows.length ? (
        <table>
          <thead><tr><th>Lỗi</th><th>Cách sửa</th><th>Do</th><th>Kết quả</th><th>Chi phí</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.issueKind}</td><td>{row.action}</td>
                <td>{row.chosenBy === "agent" ? "Agent" : "Thang mặc định"}</td>
                <td>{OUTCOME_VI[row.outcome] ?? row.outcome}</td><td>${row.costUsd.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {shelved ? <button type="button" className="button" disabled={reopen.isPending} onClick={() => reopen.mutate()}>Mở lại</button> : null}
      {reopen.isError ? <p role="alert">{reopen.error.message}</p> : null}
    </section>
  );
}
