const TONE_CLASS = {
  neutral: "ui-badge-neutral",
  success: "ui-badge-success",
  warning: "ui-badge-warning",
  danger: "ui-badge-danger",
  info: "ui-badge-info",
} as const;

export type BadgeTone = keyof typeof TONE_CLASS;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: string;
}) {
  return <span className={`ui-badge ${TONE_CLASS[tone]}`}>{children}</span>;
}

export function Chip({
  tone = "info",
  children,
}: {
  tone?: BadgeTone;
  children: string;
}) {
  return <span className={`ui-chip ${TONE_CLASS[tone]}`}>{children}</span>;
}
