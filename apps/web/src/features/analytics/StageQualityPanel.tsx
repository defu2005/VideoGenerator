import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";

/** TASK-148c: 14-day quality trend per pipeline stage. Read only; alerts go to the escalation inbox. */
const TREND_STAGES = ["RESEARCH", "SCRIPT", "SCENE_PLAN", "VISUAL_REVIEW", "MUSIC_REVIEW", "FINAL_APPROVAL"] as const;

type StageTrend = {
  stage: string;
  metric: string;
  days: number;
  current: { runs: number; mean: number | null };
  previous: { runs: number; mean: number | null };
  changePct: number | null;
};

function fetchTrend(stage: string): Promise<StageTrend> {
  return apiRequest<StageTrend>(`/stage-quality/trend?stage=${encodeURIComponent(stage)}&metric=quality_score&days=14`);
}

function formatMean(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function formatChange(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function StageQualityPanel() {
  const trends = useQuery({
    queryKey: ["stage-quality", "trend", TREND_STAGES],
    queryFn: () => Promise.all(TREND_STAGES.map((stage) => fetchTrend(stage))),
  });

  if (trends.isPending) return <p className="usage-empty">Đang tải chất lượng theo bước…</p>;
  if (trends.isError || !trends.data) return <p className="usage-empty" role="alert">Không tải được chất lượng theo bước.</p>;

  const rows = trends.data.filter((trend) => trend.current.runs > 0 || trend.previous.runs > 0);
  if (rows.length === 0) return <p className="usage-empty">Chưa có lần chạy nào trong 28 ngày gần đây.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Bước</th>
          <th>Lần chạy (14 ngày)</th>
          <th>Điểm TB (14 ngày)</th>
          <th>Điểm TB (14 ngày trước)</th>
          <th>Thay đổi</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((trend) => (
          <tr key={trend.stage}>
            <td>{trend.stage}</td>
            <td>{trend.current.runs}</td>
            <td>{formatMean(trend.current.mean)}</td>
            <td>{formatMean(trend.previous.mean)}</td>
            <td>{formatChange(trend.changePct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
