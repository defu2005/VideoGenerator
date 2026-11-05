export function Skeleton({ lines = 3, label = "Đang tải" }: { lines?: number; label?: string }) {
  return (
    <div className="ui-skeleton" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={index === lines - 1 ? "ui-skeleton-line is-short" : "ui-skeleton-line"} />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-stack" aria-busy="true">
      <Skeleton lines={2} label="Đang tải trang" />
      <div className="stats-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <span key={index} className="ui-skeleton-card" />)}
      </div>
      <Skeleton lines={4} label="Đang tải nội dung" />
    </div>
  );
}
