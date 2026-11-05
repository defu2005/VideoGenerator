import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  hint,
  href,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="stat-label kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {hint ? <span className="stat-foot">{hint}</span> : null}
    </>
  );
  if (href) return <Link className="stat-tile kpi-tile" to={href}>{body}</Link>;
  if (onClick) {
    return <button className="stat-tile kpi-tile" type="button" onClick={onClick}>{body}</button>;
  }
  return <article className="stat-tile kpi-tile">{body}</article>;
}
