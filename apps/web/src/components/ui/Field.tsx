import { useId, type ReactNode } from "react";

type FieldProps = {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
};

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: FieldProps) => ReactNode;
}) {
  const fieldId = useId();
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const described = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`ui-field${error ? " has-error" : ""}`}>
      <label htmlFor={fieldId}>{label}</label>
      {children({
        id: fieldId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": described,
      })}
      {hint ? <p id={hintId} className="ui-field-hint">{hint}</p> : null}
      {error ? <p id={errorId} className="ui-field-error" role="alert">{error}</p> : null}
    </div>
  );
}
