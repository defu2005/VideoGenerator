// TASK-129c slice 2: the Vietnamese checkpoint report. Pure: numbers come in, text comes out.
// The analytics source is injected by the caller; this file never fetches anything.

export type CheckpointNumbers = {
  views: number;
  retentionPct?: number | null;
  ctrPct?: number | null;
  revenueUsd?: number | null;
};

const KIND_LABEL: Record<string, string> = { "2h": "+2 giờ", "24h": "+24 giờ", "72h": "+72 giờ", "7d": "+7 ngày" };

/** Compares views with the channel median. Returns null when there is no baseline to compare against. */
export function compareWithMedian(views: number, channelMedianViews: number | null): string | null {
  if (channelMedianViews === null || channelMedianViews <= 0) return null;
  const ratio = views / channelMedianViews;
  if (ratio >= 1) return `cao hơn trung vị kênh ${Math.round((ratio - 1) * 100)}%`;
  return `thấp hơn trung vị kênh ${Math.round((1 - ratio) * 100)}%`;
}

/** Used when no publication of the mission has numbers yet. Never prints a views figure, so no 0 is shown as if measured. */
export function formatNoNumbersReport(kind: string, total: number): string {
  const label = KIND_LABEL[kind] ?? kind;
  return `Báo cáo ${label} sau khi đăng: chưa có số liệu từ nền tảng cho ${total} video.`;
}

export function formatCheckpointReport(kind: string, numbers: CheckpointNumbers, channelMedianViews: number | null): string {
  const label = KIND_LABEL[kind] ?? kind;
  const lines = [`Báo cáo ${label} sau khi đăng: ${numbers.views.toLocaleString("vi-VN")} lượt xem.`];
  const median = compareWithMedian(numbers.views, channelMedianViews);
  if (median) lines.push(`So với kênh: ${median}.`);
  if (numbers.retentionPct != null) lines.push(`Giữ chân khán giả: ${numbers.retentionPct}%.`);
  if (numbers.ctrPct != null) lines.push(`Tỉ lệ nhấp: ${numbers.ctrPct}%.`);
  if (numbers.revenueUsd != null) lines.push(`Doanh thu ghi nhận: ${numbers.revenueUsd} USD.`);
  return lines.join("\n");
}
