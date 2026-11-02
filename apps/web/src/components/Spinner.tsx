export function Spinner({ label = "Loading" }: { label?: string }) {
  return <div className="spinner-state" role="status"><span className="spinner" />{label}</div>;
}
