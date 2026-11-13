export function Skeleton({ lines = 3, label = "Đang tải" }: { lines?: number; label?: string }) {
  return (
    <div className="ui-skeleton" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={index === lines - 1 ? "ui-skeleton-line is-short" : "ui-skeleton-line"} />
      ))}
    </div>
  );
}

export function PageSkeleton({ label = "Đang tải trang" }: { label?: string }) {
  return (
    <div className="page-stack ui-skeleton-wrap" role="status" aria-busy="true" aria-label={label}>
      <Skeleton lines={2} label={label} />
      <div className="stats-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <span key={index} className="ui-skeleton-card" />)}
      </div>
      <Skeleton lines={4} label="Đang tải nội dung" />
    </div>
  );
}

export function DashboardSkeleton({ label = "Đang tải bảng điều khiển" }: { label?: string }) {
  return (
    <div className="page-stack ui-skeleton-wrap" role="status" aria-busy="true" aria-label={label}>
      <div className="page-heading">
        <div>
          <span className="ui-skeleton-line is-short" style={{ width: 80, height: 12, marginBottom: 8 }} />
          <span className="ui-skeleton-line" style={{ width: 220, height: 28 }} />
        </div>
      </div>
      <div className="stats-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="stat-tile ui-skeleton-card">
            <span className="ui-skeleton-line is-short" style={{ width: "60%" }} />
            <span className="ui-skeleton-line" style={{ width: "40%", height: 32, margin: "8px 0" }} />
            <span className="ui-skeleton-line is-short" style={{ width: "80%" }} />
          </div>
        ))}
      </div>
      <div className="dashboard-columns">
        <div className="panel ui-skeleton-card" style={{ minHeight: 200 }}>
          <span className="ui-skeleton-line is-short" style={{ width: "50%", height: 18, marginBottom: 16 }} />
          <Skeleton lines={4} />
        </div>
        <div className="panel ui-skeleton-card" style={{ minHeight: 200 }}>
          <span className="ui-skeleton-line is-short" style={{ width: "40%", height: 18, marginBottom: 16 }} />
          <Skeleton lines={3} />
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4, label = "Đang tải bảng dữ liệu" }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div className="ui-table-skeleton ui-skeleton-wrap" role="status" aria-busy="true" aria-label={label}>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, i) => (
                <th key={i}><span className="ui-skeleton-line is-short" /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c}><span className="ui-skeleton-line" /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProjectListSkeleton({ count = 6, label = "Đang tải danh sách dự án" }: { count?: number; label?: string }) {
  return (
    <div className="project-list ui-skeleton-wrap" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="project-card ui-skeleton-card" style={{ minHeight: 180, padding: 18, display: "flex", flexDirection: "column" }}>
          <span className="ui-skeleton-line" style={{ width: "70%", height: 20, marginBottom: 12 }} />
          <span className="ui-skeleton-line" style={{ width: "90%", height: 14, marginBottom: 8 }} />
          <span className="ui-skeleton-line is-short" style={{ width: "40%", height: 14, marginBottom: 16 }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", paddingTop: 12 }}>
            <span className="ui-skeleton-line" style={{ width: 60, height: 22, borderRadius: 999 }} />
            <span className="ui-skeleton-line is-short" style={{ width: 80, height: 14 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
