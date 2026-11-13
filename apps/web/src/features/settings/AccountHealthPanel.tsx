import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";
import { MetricObservationForm } from "./MetricObservationForm";

type Check = { entryId: string; name: string; coverage: "api" | "partial" | "manual"; verification: string; due: boolean;
  observations: Array<{ state: string; detail: string; checkedAt: string; assetId?: string }> };
type HealthView = { accounts: Array<{ accountId: string; name: string; platform: string; checks: Check[] }>;
  webhook: string; settings: { offline: boolean; eco: boolean; webhookUrl?: string } };
const key = ["account-health"];
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const coverage = { api: "API", partial: "Một phần, cần đối chiếu", manual: "Kiểm tra thủ công" };
const stateText: Record<string, string> = { clear: "Không có vấn đề được xác nhận", issue: "Có vấn đề được xác nhận", unknown: "Chưa rõ — cần kiểm tra" };

export function AccountHealthPanel() {
  const cache = useQueryClient();
  const health = useQuery({ queryKey: key, queryFn: () => apiRequest<HealthView>("/knowledge/health") });
  const settings = useMutation({
    mutationFn: (value: HealthView["settings"]) => apiRequest("/knowledge/health/settings", post(value)),
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  if (health.isPending) return <p role="status">Đang tải checklist tài khoản…</p>;
  if (health.error) return <p role="alert">{health.error.message}</p>;
  const data = health.data!;
  return <section className="space-y-4" aria-label="Kiểm tra tài khoản và video">
    <h2 className="text-xl font-semibold">Kiểm tra tài khoản và video hằng tuần</h2>
    <p>{data.webhook}</p>
    <p className="text-sm">Không thấy video, lỗi kết nối hoặc doanh thu bằng 0 đều chưa đủ để kết luận tài khoản bị phạt. Mở nền tảng để đối chiếu; app không đọc trang đã đăng nhập.</p>
    <fieldset className="flex flex-wrap gap-4 rounded border p-3" disabled={settings.isPending}>
      <legend>Lịch kiểm tra</legend>
      <label><input type="checkbox" checked={data.settings.offline} onChange={e => settings.mutate({ ...data.settings, offline: e.target.checked })} /> Tạm dừng detector khi làm việc offline</label>
      <label><input type="checkbox" checked={data.settings.eco} onChange={e => settings.mutate({ ...data.settings, eco: e.target.checked })} /> ECO: chỉ so hash nguồn, không gọi AI</label>
    </fieldset>
    <form className="grid gap-2 rounded border p-3" aria-label="Webhook TikTok" onSubmit={e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      settings.mutate({ ...data.settings, webhookUrl: String(form.get("webhookUrl") ?? "").trim() });
    }}>
      <label>URL webhook HTTPS công khai <input className="block w-full" type="url" name="webhookUrl" defaultValue={data.settings.webhookUrl ?? ""} placeholder="https://your-domain/api/knowledge/webhooks/tiktok" /></label>
      <p className="text-sm">Nhập cùng URL trong TikTok Developer Portal. App kiểm chữ ký và thời gian gửi; không cần dán client secret ở đây. Để trống nếu chỉ dùng polling.</p>
      <button type="submit" disabled={settings.isPending} className="justify-self-start rounded border px-3 py-2">Lưu URL webhook</button>
    </form>
    {settings.error && <p role="alert">{settings.error.message}</p>}
    <MetricObservationForm accounts={data.accounts} />
    {!data.accounts.length && <p>Chưa có tài khoản đã kết nối.</p>}
    {data.accounts.map(account => <article key={account.accountId} className="space-y-3 rounded border p-4">
      <h3 className="font-semibold">{account.name} · {account.platform}</h3>
      {!account.checks.length && <p>Chưa có tri thức độ phủ trạng thái cho nền tảng này.</p>}
      {account.checks.map(check => <details key={check.entryId} className="rounded border p-3">
        <summary>{check.name} · {coverage[check.coverage]}{check.due ? " · Đến hạn kiểm tra" : ""}</summary>
        <p className="my-2 text-sm">{check.verification}</p>
        {check.observations.length > 0 && <ul className="my-2 text-sm" aria-label={`Lần kiểm ${check.name}`}>
          {check.observations.slice(-3).map((obs, index) => <li key={index}>{new Date(obs.checkedAt).toLocaleString("vi-VN")} · {obs.assetId ?? "Tài khoản"} · {stateText[obs.state] ?? obs.state} · {obs.detail}</li>)}
        </ul>}
        <HealthCheckForm accountId={account.accountId} check={check} />
      </details>)}
    </article>)}
  </section>;
}

function HealthCheckForm({ accountId, check }: { accountId: string; check: Check }) {
  const cache = useQueryClient(), errorRef = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState("clear"), [assetId, setAssetId] = useState(""), [policyName, setPolicyName] = useState(""), [note, setNote] = useState("");
  const [followers, setFollowers] = useState(""), [age, setAge] = useState(""), [views, setViews] = useState(""), [hours, setHours] = useState(""), [uploads, setUploads] = useState(""), [days, setDays] = useState("90"), [qualified, setQualified] = useState(false);
  const eligibilityCheck = check.entryId.endsWith(".eligibility");
  const mutation = useMutation({
    mutationFn: () => apiRequest("/knowledge/health/checks", post({ accountId, entryId: check.entryId, outcome,
      ...(assetId.trim() ? { assetId: assetId.trim() } : {}), ...(policyName.trim() ? { policyName: policyName.trim() } : {}), note,
      ...(eligibilityCheck ? { eligibility: {
        ...(followers !== "" ? { followers: Number(followers) } : {}), ...(age !== "" ? { age: Number(age) } : {}),
        windows: views !== "" || hours !== "" || uploads !== "" ? [{ days: Number(days), qualified, ...(views !== "" ? { views: Number(views) } : {}), ...(hours !== "" ? { watchHours: Number(hours) } : {}), ...(uploads !== "" ? { uploads: Number(uploads) } : {}) }] : [],
      } } : {}),
    })),
    onSuccess: async () => { setNote(""); await cache.invalidateQueries({ queryKey: key }); await cache.invalidateQueries({ queryKey: ["external-knowledge"] }); },
  });
  useEffect(() => { if (mutation.error) errorRef.current?.focus(); }, [mutation.error]);
  return <form className="grid gap-2" aria-label={`Ghi kiểm tra ${check.name}`} onSubmit={e => { e.preventDefault(); mutation.mutate(); }}>
    {mutation.error && <div role="alert" tabIndex={-1} ref={errorRef}>{mutation.error.message}</div>}
    <label>Kết quả <select value={outcome} onChange={e => setOutcome(e.target.value)}><option value="clear">Không có gì</option><option value="issue">Có vấn đề</option></select></label>
    <label>ID video (nếu kiểm một video) <input value={assetId} onChange={e => setAssetId(e.target.value)} maxLength={200} /></label>
    {outcome === "issue" && <label>Tên chính sách / thông báo <input value={policyName} onChange={e => setPolicyName(e.target.value)} required maxLength={200} /></label>}
    {eligibilityCheck && <fieldset className="grid gap-2 rounded border p-3">
      <legend>Số liệu điều kiện trong dashboard của nền tảng</legend>
      <label>Người theo dõi <input type="number" min={0} step={1} value={followers} onChange={e => setFollowers(e.target.value)} /></label>
      <label>Tuổi chủ tài khoản <input type="number" min={0} max={120} step={1} value={age} onChange={e => setAge(e.target.value)} /></label>
      <label>Cửa sổ (ngày) <input type="number" min={1} max={730} step={1} value={days} onChange={e => setDays(e.target.value)} /></label>
      <label>Lượt xem trong cửa sổ <input type="number" min={0} value={views} onChange={e => setViews(e.target.value)} /></label>
      <label>Giờ xem trong cửa sổ <input type="number" min={0} step="any" value={hours} onChange={e => setHours(e.target.value)} /></label>
      <label>Video công khai hợp lệ trong cửa sổ <input type="number" min={0} step={1} value={uploads} onChange={e => setUploads(e.target.value)} /></label>
      <label><input type="checkbox" checked={qualified} onChange={e => setQualified(e.target.checked)} /> Dashboard xác nhận đây là lượt/giờ xem hợp lệ cho chương trình</label>
      <p className="text-sm">Không dùng tổng lượt xem thay lượt hợp lệ. Thiếu số liệu thì chưa rõ; đạt ngưỡng số liệu chưa bảo đảm nền tảng chấp thuận.</p>
    </fieldset>}
    <label>Điều bạn đã thấy <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} /></label>
    <button className="justify-self-start rounded border px-3 py-2" disabled={mutation.isPending} type="submit">{mutation.isPending ? "Đang ghi…" : "Ghi lần kiểm tra"}</button>
    {mutation.isSuccess && <p role="status">Đã ghi báo cáo thủ công cùng thời điểm kiểm tra.</p>}
  </form>;
}
