import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";

type Row = { id: string; tool: string; origin: string | null; summary: string; createdAt: string; undo?: unknown };

export function AutonomyJournalPage() {
  const client = useQueryClient();
  const [tool, setTool] = useState("");
  const [origin, setOrigin] = useState("");
  const query = useQuery({
    queryKey: ["operator-journal", tool, origin],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tool) params.set("tool", tool);
      if (origin) params.set("origin", origin);
      const suffix = params.size ? `?${params}` : "";
      return apiRequest<{ rows: Row[] }>(`/operator/journal${suffix}`);
    },
  });
  const undo = useMutation({
    mutationFn: (id: string) => apiRequest(`/operator/journal/${id}/undo`, { method: "POST", body: "{}" }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["operator-journal"] }); },
  });
  const rows = query.data?.rows ?? [];

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TỰ VẬN HÀNH</p>
          <h1>Nhật ký tự vận hành</h1>
          <p className="page-subtitle">Hôm nay và các thao tác agent đã ghi. Hoàn tác chỉ dành cho bạn.</p>
        </div>
      </div>

      <section className="panel" style={{ padding: "16px 20px" }}>
        <div className="filter-row">
          <label className="form-field" style={{ margin: 0 }}>
            <span>Công cụ</span>
            <input
              type="text"
              aria-label="Lọc công cụ"
              value={tool}
              placeholder="vd: apply_models, run_pipeline"
              onChange={(event) => setTool(event.target.value)}
            />
          </label>
          <label className="form-field" style={{ margin: 0 }}>
            <span>Nguồn</span>
            <input
              type="text"
              aria-label="Lọc nguồn"
              value={origin}
              placeholder="vd: user, operator, supervisor"
              onChange={(event) => setOrigin(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="panel" style={{ padding: "20px" }}>
        {query.isError && <p className="request-error" role="alert">{query.error.message}</p>}
        {undo.isError && <p className="request-error" role="alert">{undo.error.message}</p>}
        {query.isLoading ? <p className="field-hint">Đang tải nhật ký…</p> : null}
        {rows.length === 0 && !query.isLoading ? (
          <p className="field-hint">Chưa có thao tác trong bộ lọc này.</p>
        ) : (
          <div className="journal-list">
            {rows.map((row) => (
              <article key={row.id} className="journal-item">
                <div className="journal-item-main">
                  <div className="journal-item-head">
                    <code className="journal-tool-badge">{row.tool}</code>
                    <span className="journal-origin-chip">{row.origin ?? "user"}</span>
                    {row.createdAt && (
                      <time className="journal-time">
                        {new Date(row.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        {" · "}
                        {new Date(row.createdAt).toLocaleDateString("vi-VN")}
                      </time>
                    )}
                  </div>
                  <p className="journal-summary">{row.summary}</p>
                </div>
                {row.undo != null ? (
                  <button
                    type="button"
                    className="button button-secondary journal-undo-btn"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(row.id)}
                  >
                    Hoàn tác
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
