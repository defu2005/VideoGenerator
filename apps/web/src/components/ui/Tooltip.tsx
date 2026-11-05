import type { ReactNode } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="ui-tooltip" tabIndex={0}>
      {children}
      <span role="tooltip" className="ui-tooltip-bubble">{label}</span>
    </span>
  );
}
