export function ProgressBar({
  value,
  max = 100,
  tone = "ok",
  label,
}: {
  value: number;
  max?: number;
  tone?: "ok" | "near" | "out";
  label?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const toneClass = tone === "out" ? " is-out" : tone === "near" ? " is-near" : "";
  return (
    <span
      className={`quota-bar progress-bar${toneClass}`}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
