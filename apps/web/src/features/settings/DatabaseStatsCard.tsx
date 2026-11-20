import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/ui/Toast";
import { apiRequest } from "../../services/apiClient";
import { Spinner } from "../../components/Spinner";

export type SlowStatement = {
  normalizedSql: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
};

export type DbStats = {
  dbSizeBytes: number;
  walSizeBytes: number;
  busyCount: number;
  busyRetrySuccessCount: number;
  busyRetryFailureCount: number;
  lastCheckpointAt: string | null;
  lastCheckpointDurationMs: number | null;
  lastCheckpointPages: { checkpointed: number; total: number } | null;
  litestreamActive: boolean;
  activeBatchQueues: {
    auditQueueLength: number;
    usageQueueLength: number;
  };
  metrics: {
    totalStatements: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
    slowestStatements: SlowStatement[];
  };
};

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Chưa có";
  try {
    return new Date(iso).toLocaleString("vi-VN");
  } catch {
    return iso;
  }
}

export function DatabaseStatsCard() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["admin", "db-stats"],
    queryFn: () => apiRequest<DbStats>("/admin/db-stats"),
    refetchInterval: 15_000,
  });

  const checkpoint = useMutation({
    mutationFn: () => apiRequest<{ ok: boolean; pages: { checkpointed: number; total: number }; durationMs: number }>("/admin/db-stats/checkpoint", { method: "POST" }),
    onSuccess: async (data) => {
      toast.success(`Đã thu gọn WAL (${data.pages.checkpointed}/${data.pages.total} trang trong ${data.durationMs}ms)`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "db-stats"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Thu gọn WAL thất bại");
    },
  });

  if (query.isPending) {
    return (
      <section className="panel" id="co-so-du-lieu" aria-label="Cơ sở dữ liệu">
        <h2>Cơ sở dữ liệu</h2>
        <Spinner label="Đang tải thông số cơ sở dữ liệu..." />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="panel" id="co-so-du-lieu" aria-label="Cơ sở dữ liệu">
        <h2>Cơ sở dữ liệu</h2>
        <p className="text-muted">Không thể tải thông số CSDL ({query.error instanceof Error ? query.error.message : "Lỗi không xác định"}).</p>
      </section>
    );
  }

  const stats = query.data;
  if (!stats) return null;

  const dbSizeBytes = stats.dbSizeBytes ?? 0;
  const walSizeBytes = stats.walSizeBytes ?? 0;
  const busyCount = stats.busyCount ?? 0;
  const busyRetrySuccessCount = stats.busyRetrySuccessCount ?? 0;
  const busyRetryFailureCount = stats.busyRetryFailureCount ?? 0;
  const auditQueueLength = stats.activeBatchQueues?.auditQueueLength ?? 0;
  const usageQueueLength = stats.activeBatchQueues?.usageQueueLength ?? 0;
  const totalStatements = stats.metrics?.totalStatements ?? 0;
  const p50Ms = stats.metrics?.p50Ms ?? 0;
  const p95Ms = stats.metrics?.p95Ms ?? 0;
  const maxMs = stats.metrics?.maxMs ?? 0;
  const slowestStatements = stats.metrics?.slowestStatements ?? [];

  return (
    <section className="panel" id="co-so-du-lieu" aria-label="Cơ sở dữ liệu">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h2>Cơ sở dữ liệu</h2>
          <p className="text-muted" style={{ margin: 0 }}>
            Thông số hiệu năng SQLite, kích thước WAL, hàng đợi ghi gộp và checkpoint.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            Làm mới
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => checkpoint.mutate()}
            disabled={checkpoint.isPending}
          >
            {checkpoint.isPending ? "Đang thu gọn..." : "Thu gọn WAL"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <div className="stat-card" style={{ padding: "0.75rem", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px" }}>
          <div className="stat-label" style={{ fontSize: "0.85rem", color: "var(--text-muted, #64748b)" }}>Dung lượng CSDL</div>
          <div style={{ fontSize: "1.25rem", fontWeight: "bold" }}>{formatMb(dbSizeBytes)}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>WAL: {formatMb(walSizeBytes)}</div>
        </div>

        <div className="stat-card" style={{ padding: "0.75rem", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px" }}>
          <div className="stat-label" style={{ fontSize: "0.85rem", color: "var(--text-muted, #64748b)" }}>Khóa bận (SQLITE_BUSY)</div>
          <div style={{ fontSize: "1.25rem", fontWeight: "bold" }}>{busyCount}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
            Thành công: {busyRetrySuccessCount} · Thất bại: {busyRetryFailureCount}
          </div>
        </div>

        <div className="stat-card" style={{ padding: "0.75rem", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px" }}>
          <div className="stat-label" style={{ fontSize: "0.85rem", color: "var(--text-muted, #64748b)" }}>Checkpoint gần nhất</div>
          <div style={{ fontSize: "1rem", fontWeight: "600" }}>{formatDate(stats.lastCheckpointAt)}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
            {stats.lastCheckpointDurationMs != null ? `${stats.lastCheckpointDurationMs} ms` : "Chưa checkpoint"}
          </div>
        </div>

        <div className="stat-card" style={{ padding: "0.75rem", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px" }}>
          <div className="stat-label" style={{ fontSize: "0.85rem", color: "var(--text-muted, #64748b)" }}>Sao lưu & Hàng đợi</div>
          <div style={{ fontSize: "1rem", fontWeight: "600" }}>
            Litestream: {stats.litestreamActive ? "Đang bật" : "Tắt"}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
            Audit: {auditQueueLength} · Usage: {usageQueueLength}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Độ trễ câu lệnh (Tổng: {totalStatements.toLocaleString("vi-VN")})</h3>
        <div style={{ display: "flex", gap: "2rem", fontSize: "0.9rem" }}>
          <div><strong>p50:</strong> {p50Ms} ms</div>
          <div><strong>p95:</strong> {p95Ms} ms</div>
          <div><strong>Tối đa:</strong> {maxMs} ms</div>
        </div>
      </div>

      {slowestStatements.length > 0 && (
        <div>
          <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Top câu lệnh chậm nhất</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color, #cbd5e1)" }}>
                  <th style={{ padding: "6px 8px" }}>Câu lệnh</th>
                  <th style={{ padding: "6px 8px", width: "80px", textAlign: "right" }}>Số lần</th>
                  <th style={{ padding: "6px 8px", width: "100px", textAlign: "right" }}>Trung bình</th>
                  <th style={{ padding: "6px 8px", width: "90px", textAlign: "right" }}>Tối đa</th>
                </tr>
              </thead>
              <tbody>
                {slowestStatements.map((s, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--border-color, #e2e8f0)" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", wordBreak: "break-all" }}>
                      {s.normalizedSql}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.count}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.avgMs} ms</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.maxMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
