/** `unknown` means some calls did not report tokens, so a known count is only a lower bound. */
export function formatTokens(value: number, unknown = false): string {
  if (unknown && value === 0) return "Không rõ";
  const text = value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`
      : new Intl.NumberFormat("vi-VN").format(value);
  return unknown ? `≥ ${text}` : text;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatVnd(valueUsd: number, rate: number): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(valueUsd * rate);
}
