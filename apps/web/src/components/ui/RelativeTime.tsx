import { formatDateTime, formatRelative } from "../../lib/format";
import { Tooltip } from "./Tooltip";

export function RelativeTime({ value }: { value: string }) {
  return (
    <Tooltip label={formatDateTime(value)}>
      <time dateTime={value}>{formatRelative(value)}</time>
    </Tooltip>
  );
}
