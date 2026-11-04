import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LLM_TASKS, type LlmTaskId, type ModelAdvisorProposal, type ModelAdvisorScope } from "@vg/shared";
import { applyLlmAdvisor, proposeLlmAdvisor } from "../../services/llmApi";

const ROUTABLE_TASKS = LLM_TASKS.filter((task) => task.id !== "modelAdvisor");

export function ModelAdvisorPanel({
  scope,
  id,
  budgetMode,
}: {
  scope: ModelAdvisorScope;
  id?: string;
  budgetMode?: "ECO" | "BALANCED" | "QUALITY" | "MAX" | "CUSTOM";
}) {
  const queryClient = useQueryClient();
  const [proposal, setProposal] = useState<ModelAdvisorProposal | null>(null);
  const [selected, setSelected] = useState<Set<LlmTaskId>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const propose = useMutation({
    mutationFn: () => proposeLlmAdvisor({ scope, id, budgetMode }),
    onSuccess: (data) => {
      setProposal(data);
      setSelected(new Set(data.diff.filter((row) => row.changed).map((row) => row.taskId)));
      setError("");
      setMessage(data.cached ? "Dùng lại đề xuất đã lưu (24 giờ)." : "Đã tạo đề xuất model.");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Không tạo được đề xuất");
      setMessage("");
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (!proposal) throw new Error("Chưa có đề xuất");
      const taskIds = [...selected];
      if (taskIds.length === 0) throw new Error("Chọn ít nhất một tác vụ");
      return applyLlmAdvisor({
        scope,
        id,
        proposalId: proposal.proposalId,
        taskIds,
      });
    },
    onSuccess: async (result) => {
      setMessage(`Đã áp dụng ${result.applied.length} tác vụ.`);
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["llm-routing"] });
      await queryClient.invalidateQueries({ queryKey: ["project-llm-routes"] });
      if (scope === "profile" && id) {
        await queryClient.invalidateQueries({ queryKey: ["profile", id] });
        await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      }
      if (scope === "project" && id) {
        await queryClient.invalidateQueries({ queryKey: ["project", id] });
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Không áp dụng được đề xuất");
      setMessage("");
    },
  });

  const rows = useMemo(() => {
    if (!proposal) return [];
    return ROUTABLE_TASKS.map((task) => {
      const diff = proposal.diff.find((row) => row.taskId === task.id);
      const proposed = diff?.proposed ?? proposal.routes[task.id];
      return {
        task,
        current: diff?.current ?? null,
        proposed,
        changed: diff?.changed ?? false,
      };
    }).filter((row) => row.proposed);
  }, [proposal]);

  function toggle(taskId: LlmTaskId) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((row) => row.task.id)) : new Set());
  }

  return (
    <section className="model-advisor panel" aria-label="Gợi ý model bằng AI">
      <header className="model-advisor-head">
        <div>
          <h2>Gợi ý model bằng AI</h2>
          <p className="field-hint">
            Một lần gọi AI xem catalog model hiện có và đề xuất route theo chế độ ngân sách.
            {scope === "profile" ? " Áp dụng vào hồ sơ này." : scope === "project" ? " Áp dụng vào dự án này." : " Áp dụng vào cài đặt app."}
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => propose.mutate()}
          disabled={propose.isPending}
        >
          {propose.isPending ? "Đang gợi ý…" : "Gợi ý model bằng AI"}
        </button>
      </header>
      {error && <p className="request-error" role="alert">{error}</p>}
      {message && <p className="success-message" role="status">{message}</p>}
      {proposal && (
        <>
          {proposal.notes && <p className="field-hint">{proposal.notes}</p>}
          <div className="model-advisor-table-wrap">
            <table className="model-advisor-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả tác vụ"
                      checked={rows.length > 0 && selected.size === rows.length}
                      onChange={(event) => toggleAll(event.target.checked)}
                    />
                  </th>
                  <th>Tác vụ</th>
                  <th>Hiện tại</th>
                  <th>Đề xuất</th>
                  <th>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.task.id} data-testid={`advisor-row-${row.task.id}`}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${row.task.label}`}
                        checked={selected.has(row.task.id)}
                        onChange={() => toggle(row.task.id)}
                      />
                    </td>
                    <td>{row.task.label}</td>
                    <td>{row.current ? `${row.current.provider}/${row.current.model || "—"}` : "—"}</td>
                    <td>{row.proposed ? `${row.proposed.provider}/${row.proposed.model}` : "—"}</td>
                    <td>{row.proposed?.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button button-primary"
              onClick={() => apply.mutate()}
              disabled={apply.isPending || selected.size === 0}
            >
              {apply.isPending ? "Đang áp dụng…" : "Áp dụng"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
