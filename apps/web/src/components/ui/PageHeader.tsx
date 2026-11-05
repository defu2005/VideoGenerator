import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  helpHref,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  /** Room for the in-app "?" guide link. TASK-048 fills this when the guide exists. */
  helpHref?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title">
          {title}
          {helpHref
            ? <a className="help-link" href={helpHref}>?</a>
            : <span className="help-slot" data-help-slot="" aria-hidden="true" />}
        </h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="page-heading-actions">{actions}</div> : null}
    </div>
  );
}
