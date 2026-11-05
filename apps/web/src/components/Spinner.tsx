export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-state" role="status" aria-busy="true">
      <span className="ui-skeleton-line" />
      <span className="ui-skeleton-line is-short" />
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
