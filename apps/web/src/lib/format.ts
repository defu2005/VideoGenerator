/** Dates render as dd/MM/yyyy HH:mm in the local timezone. */
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Short relative label. `now` is injectable so tests stay stable. */
export function formatRelative(value: string | Date, now = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return "vừa xong";
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return minutes >= 0 ? `${minutes} phút trước` : `sau ${Math.abs(minutes)} phút`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return hours >= 0 ? `${hours} giờ trước` : `sau ${Math.abs(hours)} giờ`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return days >= 0 ? `${days} ngày trước` : `sau ${Math.abs(days)} ngày`;
  return formatDateTime(date);
}

/** USD with 2 decimals, or VND with grouping. */
export function formatMoney(value: number, currency: string): string {
  const digits = currency === "VND" ? 0 : 2;
  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    if (currency === "VND") return `${new Intl.NumberFormat("vi-VN").format(Math.round(value))} ₫`;
    return `$${value.toFixed(2)}`;
  }
}

export function visibleSlice<T>(items: readonly T[], count: number): { visible: T[]; hasMore: boolean } {
  const visible = items.slice(0, count);
  return { visible, hasMore: items.length > visible.length };
}
