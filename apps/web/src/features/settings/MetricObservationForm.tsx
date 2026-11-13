import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";

export function MetricObservationForm({ accounts }: { accounts: Array<{ accountId: string; name: string }> }) {
  const cache = useQueryClient(), [metric, setMetric] = useState("ctr");
  const metrics = useQuery({ queryKey: ["account-metrics"], enabled: accounts.length > 0,
    queryFn: () => apiRequest<{ series: Array<{ accountId: string; metric: string; format: string; points: Array<{ date: string; value: number | null; samples: number; definition: string }> }> }>("/knowledge/metrics") });
  const save = useMutation({ mutationFn: (body: unknown) => apiRequest("/knowledge/metrics", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["account-metrics"] }) });
  if (!accounts.length) return null;
  return <section aria-label="Số liệu phát hiện thay đổi" className="space-y-3">
    <h3 className="font-semibold">Số liệu gần nhất</h3>
    {metrics.error && <p role="alert">{metrics.error.message}</p>}
    {!metrics.isPending && !metrics.data?.series?.length && <p>Chưa đủ số liệu hằng ngày. Chỉ số chưa có từ connector được để trống; bạn có thể ghi từ dashboard.</p>}
    {!!metrics.data?.series?.length && <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Quan sát gần nhất theo kênh và chỉ số</caption>
      <thead><tr>{["Kênh", "Chỉ số", "Thể loại", "Ngày", "Giá trị", "Mẫu", "Nguồn"].map(x => <th className="p-2 text-left" scope="col" key={x}>{x}</th>)}</tr></thead>
      <tbody>{metrics.data.series.map(series => { const point = series.points.at(-1); return point && <tr key={`${series.accountId}:${series.metric}:${series.format}`}>
        <td className="p-2">{accounts.find(x => x.accountId === series.accountId)?.name ?? series.accountId}</td><td className="p-2">{series.metric}</td><td className="p-2">{series.format}</td><td className="p-2">{point.date}</td>
        <td className="p-2">{point.value ?? "Chưa có"}</td><td className="p-2">{point.samples}</td><td className="p-2">{point.definition.startsWith("manual-dashboard:") ? "Dashboard nhập tay" : "Đồng bộ"}</td>
      </tr>; })}</tbody></table></div>}
    <details className="rounded border p-3"><summary>Ghi số liệu ngày từ dashboard</summary>
    <p className="my-2 text-sm">Dùng khi connector chưa có chỉ số. Chọn ngày đã kết thúc, cùng định nghĩa và cùng phạm vi khi so sánh. CTR dùng 0–1; thời lượng xem dùng %, RPM dùng USD/1.000 lượt xem. Mẫu là số video (hoặc impressions cho CTR, lượt xem cho RPM). Lượt xem 48 giờ phải được đo đúng lúc video đạt 48 giờ.</p>
    <form className="grid gap-2" aria-label="Ghi số liệu ngày" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      save.mutate({ accountId: String(data.get("accountId")), date: String(data.get("date")), metric,
        format: String(data.get("format") || "*"), value: Number(data.get("value")), samples: Number(data.get("samples")),
        sourceUrl: String(data.get("sourceUrl")), ...(metric === "impressions" ? { trafficSource: String(data.get("trafficSource")) } : {}) });
    }}>
      <label>Tài khoản <select name="accountId">{accounts.map(x => <option key={x.accountId} value={x.accountId}>{x.name}</option>)}</select></label>
      <label>Ngày số liệu <input name="date" type="date" required /></label>
      <label>Chỉ số <select value={metric} onChange={e => setMetric(e.target.value)}>
        <option value="ctr">CTR</option><option value="views48h">Lượt xem mỗi video tại 48 giờ</option>
        <option value="avgViewPct">Phần trăm xem trung bình</option><option value="impressions">Impressions theo nguồn traffic</option><option value="rpm">RPM (USD)</option>
      </select></label>
      {metric === "impressions" && <label>Nguồn traffic <input name="trafficSource" required maxLength={80} /></label>}
      <label>Thể loại (* là toàn kênh) <input name="format" defaultValue="*" required maxLength={80} /></label>
      <label>Giá trị <input name="value" type="number" min={0} max={metric === "ctr" ? 1 : undefined} step="any" required /></label>
      <label>Số mẫu <input name="samples" type="number" min={1} step={1} required /></label>
      <label>Link dashboard / báo cáo nguồn <input name="sourceUrl" type="url" required /></label>
      <button className="justify-self-start rounded border px-3 py-2" type="submit" disabled={save.isPending}>Ghi số liệu</button>
      {save.error && <p role="alert">{save.error.message}</p>}{save.isSuccess && <p role="status">Đã ghi số liệu cùng nguồn và thời điểm kiểm tra.</p>}
    </form>
  </details></section>;
}
