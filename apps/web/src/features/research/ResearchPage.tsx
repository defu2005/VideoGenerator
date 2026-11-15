import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SelfImprovementSettingsSchema, type SelfImprovementSettings, type SelfImprovementCounter } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { useCan } from "../../hooks/useCan";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/ui/Toast";

type Run = { id: string; skill: string; subject: string; status: string; report: string; createdAt: string; proposalIds: string[];
  budgetUsed: Partial<Record<SelfImprovementCounter, number>>; details: { pages?: Array<{ url: string }> } };
type Overview = { runs: Run[]; settings: SelfImprovementSettings; skills: Array<{ name: string; description: string }>;
  budget: { used: Record<SelfImprovementCounter, number>; limits: Record<SelfImprovementCounter, number> }; runtimes: Array<{ id: string; label: string }> };
const key = ["self-improvement"];
const labels: Record<SelfImprovementCounter, string> = { researchRuns: "Lượt nghiên cứu", llmCalls: "Lượt gọi AI", webFetches: "Lượt đọc web", skillDrafts: "Bản nháp skill", behaviourEvals: "Lượt đánh giá", improvementRequests: "Đề xuất cải tiến" };
const statuses: Record<string, string> = { running: "Đang nghiên cứu", completed: "Đã hoàn tất", failed: "Chưa hoàn tất", unavailable: "Thiếu nguồn hoặc kết nối", budget_limited: "Đã đạt hạn mức" };
const skillLabels: Record<string, string> = { "research-knowledge-refresh": "Làm mới tri thức", "research-change-event": "Điều tra thay đổi", "research-market": "Thị trường", "research-monetization": "Kiếm tiền", "research-provider": "Nhà cung cấp", "research-open-source": "Mã nguồn mở" };
function Settings({ initial, runtimes }: { initial: SelfImprovementSettings; runtimes: Overview["runtimes"] }) {
  const [value, setValue] = useState(initial), cache = useQueryClient(), toast = useToast();
  const save = useMutation({ mutationFn: () => apiRequest("/research/settings", { method: "PUT", body: JSON.stringify(SelfImprovementSettingsSchema.parse(value)) }),
    onSuccess: () => { toast.success("Đã lưu giới hạn."); return cache.invalidateQueries({ queryKey: key }); } });
  return <Card title="Giới hạn tự cải tiến">
    <p>Các giới hạn áp dụng mỗi ngày. Agent không được nâng giới hạn hoặc bật trả phí. Trong ECO, nghiên cứu chỉ chạy khi bạn khởi chạy thủ công.</p>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <label className="checkbox-field"><input type="checkbox" checked={value.automaticResearch} onChange={(event) => setValue({ ...value, automaticResearch: event.target.checked })} /> Cho phép tự nghiên cứu khi tri thức cũ hoặc có thay đổi</label>
      <label className="checkbox-field"><input type="checkbox" checked={value.eco} onChange={(event) => setValue({ ...value, eco: event.target.checked })} /> ECO: chỉ nghiên cứu thủ công</label>
      <Field label="Cách nghiên cứu">{(field) => <select {...field} value={value.runtime} onChange={(event) => setValue({ ...value, runtime: event.target.value })}>{runtimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.label}</option>)}</select>}</Field>
      <Field label="Số trang tối đa mỗi lượt">{(field) => <input {...field} type="number" min={1} max={100} value={value.maxPages} onChange={(event) => setValue({ ...value, maxPages: Number(event.target.value) })} />}</Field>
      {(Object.keys(labels) as SelfImprovementCounter[]).map((counter) => <Field key={counter} label={`${labels[counter]} mỗi ngày`}>{(field) => <input {...field} type="number" min={0} max={10000} value={value.budget[counter]} onChange={(event) => setValue({ ...value, budget: { ...value.budget, [counter]: Number(event.target.value) } })} />}</Field>)}
      {save.error && <p role="alert">{save.error.message}</p>}
      <div><Button type="submit" loading={save.isPending}>Lưu giới hạn</Button></div>
    </form>
  </Card>;
}
export function ResearchPage() {
  const [params] = useSearchParams(), cache = useQueryClient(), canWrite = useCan("settings.write");
  const [tab, setTab] = useState("research"), [subject, setSubject] = useState(params.get("subject") ?? params.get("knowledgeId") ?? "");
  const [skill, setSkill] = useState(params.has("knowledgeId") ? "research-knowledge-refresh" : "research-monetization");
  const [selected, setSelected] = useState<string | null>(params.get("run"));
  const query = useQuery({ queryKey: key, queryFn: () => apiRequest<Overview>("/research"), refetchInterval: 10000, refetchIntervalInBackground: false });
  const start = useMutation({ mutationFn: () => apiRequest<Run>("/research/runs", { method: "POST", body: JSON.stringify({ skill, subject, ...(params.get("knowledgeId") ? { knowledgeId: params.get("knowledgeId") } : {}) }) }),
    onSuccess: (run) => { setSelected(run.id); void cache.invalidateQueries({ queryKey: key }); void cache.invalidateQueries({ queryKey: ["external-knowledge"] }); } });
  const detail = useQuery({ queryKey: [...key, "run", selected], queryFn: () => apiRequest<Run>(`/research/runs/${encodeURIComponent(selected!)}`),
    enabled: !!selected && start.data?.id !== selected && query.isSuccess && !query.data.runs.some((run) => run.id === selected) });
  if (query.isPending) return <Spinner label="Đang tải tự cải tiến" />;
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  const data = query.data, active = data.runs.find((run) => run.id === selected) ?? detail.data ?? (start.data?.id === selected ? start.data : undefined);
  const submit = (event: FormEvent) => { event.preventDefault(); start.mutate(); };
  return <section className="form-stack">
    <header><h1 className="text-2xl font-semibold">Tự cải tiến</h1><p>Nghiên cứu nguồn công khai, kiểm trích dẫn và đề xuất tri thức. Thay đổi rủi ro vừa/cao chờ bạn duyệt.</p></header>
    <nav aria-label="Mục tự cải tiến"><Button variant={tab === "research" ? "primary" : "secondary"} onClick={() => setTab("research")}>Nghiên cứu</Button>{" "}<Button variant={tab === "journal" ? "primary" : "secondary"} onClick={() => setTab("journal")}>Nhật ký</Button></nav>
    <Card title="Ngân sách hôm nay"><ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(Object.keys(labels) as SelfImprovementCounter[]).map((counter) => <li key={counter}>{labels[counter]}: {data.budget.used[counter]}/{data.budget.limits[counter]}</li>)}</ul></Card>
    {tab === "research" && <Card title="Tìm hiểu một chủ đề">
      <form className="form-stack" onSubmit={submit}>
        <Field label="Kỹ năng nghiên cứu">{(field) => <select {...field} value={skill} onChange={(event) => setSkill(event.target.value)}>{data.skills.map((item) => <option key={item.name} value={item.name}>{skillLabels[item.name] ?? item.description}</option>)}</select>}</Field>
        <Field label="Chủ đề hoặc điều cần kiểm tra">{(field) => <textarea {...field} required maxLength={1000} rows={3} value={subject} onChange={(event) => setSubject(event.target.value)} />}</Field>
        <p>Lượt này dùng ngân sách AI và đọc web còn lại. Kết quả tạo đề xuất, bạn xem nguồn trước khi duyệt.</p>
        {start.error && <p role="alert">{start.error.message}</p>}
        <div><Button type="submit" loading={start.isPending} disabled={!canWrite || !subject.trim()}>Bắt đầu nghiên cứu (dùng ngân sách)</Button></div>
      </form>
    </Card>}
    <Card title={tab === "journal" ? "Nhật ký tự cải tiến" : "Các lượt nghiên cứu"}>
      {data.runs.length === 0 ? <p>Chưa có lượt nghiên cứu.</p> : <ul className="plain-list">{data.runs.map((run) => <li key={run.id}><Button variant="secondary" onClick={() => setSelected(run.id)}>{run.subject}</Button><p>{statuses[run.status] ?? run.status} · {new Date(run.createdAt).toLocaleString("vi-VN")} · {run.proposalIds.length} đề xuất</p></li>)}</ul>}
    </Card>
    {detail.isError && <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />}
    {active && <Card title={`Báo cáo: ${active.subject}`}><p>{statuses[active.status] ?? active.status}</p><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{active.report}</p>
      <ul>{active.details.pages?.map(({ url }) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{url}</a></li>)}</ul>
      {active.proposalIds.map((id) => <p key={id}><Link to={`/settings/knowledge?tab=pending&proposal=${encodeURIComponent(id)}`}>Xem đề xuất {id}</Link></p>)}
    </Card>}
    {canWrite && tab === "research" && <Settings key={JSON.stringify(data.settings)} initial={data.settings} runtimes={data.runtimes} />}
  </section>;
}
