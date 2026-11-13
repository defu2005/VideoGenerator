import { useState } from "react";
import { AccountHealthPanel } from "./AccountHealthPanel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalKnowledgeKindSchema, type KnowledgeEntry, type KnowledgeFreshness, type JsonPatchOperation,
} from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

type Resolved = { entry: KnowledgeEntry; freshness: KnowledgeFreshness; reviewAfter: string; revision: number };
type Proposal = {
  id: string; entryId: string; proposed: KnowledgeEntry; patch: JsonPatchOperation[];
  risk: "low" | "medium" | "high"; consumers: string[];
};
type History = { revision: number; after: KnowledgeEntry | null; createdAt: string; actor: string; reason: string };
type Details = { current: Resolved | null; history: History[]; consumers: string[] };
type ImportResult = { index: number; entryId?: string; status: string; errors?: string[] };
type ChangeEvent = {
  id: string; summary: string; severity: string; status: string; detector: string; seenCount: number;
  reaction: { proposalId?: string };
};

function query(filter: { status: string; severity: string }): string {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.severity) params.set("severity", filter.severity);
  const text = params.toString();
  return text ? `?${text}` : "";
}

const key = ["external-knowledge"];
const freshnessText = { fresh: "Mới", due: "Cần kiểm tra", stale: "Cũ" };
const riskText = { low: "Thấp", medium: "Vừa", high: "Cao" };
const severityText: Record<string, string> = { info: "Thông tin", warn: "Cảnh báo", high: "Cao", critical: "Nghiêm trọng" };
const statusText: Record<string, string> = { open: "Đang mở", acknowledged: "Đã tiếp tục", resolved: "Đã đóng", ignored: "Bỏ qua" };
const kindText: Record<string, string> = {
  guideline_pack: "Guideline", market: "Thị trường", monetization_program: "Kiếm tiền",
  platform_capability: "Năng lực nền tảng", api_contract: "API", provider_terms: "Điều khoản",
  law: "Luật", account_policy: "Tài khoản", dependency: "Phụ thuộc", creator_tactic: "Kỹ năng",
};
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export function ExternalKnowledgePage() {
  const cache = useQueryClient();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") ?? "all");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [label, setLabel] = useState("");
  const [imported, setImported] = useState<ImportResult[]>([]);
  const entries = useQuery({
    queryKey: [...key, "entries", tab],
    queryFn: () => apiRequest<{ entries: Resolved[] }>(`/knowledge${tab === "all" ? "" : `?kind=${tab}`}`),
    enabled: tab !== "pending" && tab !== "history" && tab !== "changes" && tab !== "health",
  });
  const revisions = useQuery({
    queryKey: [...key, "history"],
    queryFn: () => apiRequest<{ entries: Array<{ id: string; revision: number }> }>("/knowledge/history"),
    enabled: tab === "history",
  });
  const pending = useQuery({
    queryKey: [...key, "pending"],
    queryFn: () => apiRequest<{ proposals: Proposal[] }>("/knowledge/proposals"),
  });
  const changes = useQuery({
    queryKey: [...key, "changes", status, severity],
    queryFn: () => apiRequest<{ events: ChangeEvent[] }>(`/knowledge/changes${query({ status, severity })}`),
    enabled: tab === "changes",
  });
  const detail = useQuery({
    queryKey: [...key, "detail", selected],
    queryFn: () => apiRequest<Details>(`/knowledge/${encodeURIComponent(selected!)}`),
    enabled: selected !== null,
  });
  const mutation = useMutation({
    mutationFn: async ({ path, body }: { path: string; body: unknown }) => {
      await apiRequest(path, post(body));
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: key }),
  });
  const importMutation = useMutation({
    mutationFn: async () => {
      const value: unknown = JSON.parse(json);
      if (!Array.isArray(value)) throw new Error("Tệp phải chứa một mảng JSON.");
      return apiRequest<{ results: ImportResult[] }>("/knowledge/import", post({ label: label.trim(), entries: value }));
    },
    onSuccess: async ({ results }) => {
      setImported(results);
      await cache.invalidateQueries({ queryKey: key });
    },
  });
  const rollback = (revision: number) => mutation.mutate({
    path: `/knowledge/${encodeURIComponent(selected!)}/rollback`, body: { revision },
  });
  const error = mutation.error ?? importMutation.error ?? entries.error ?? pending.error ?? detail.error ?? revisions.error;
  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Tri thức</h1>
        <p className="text-sm">Xem dữ kiện bên ngoài, nguồn và lịch sử duyệt.</p>
      </header>
      {error && <p role="alert">{error.message}</p>}
      <details className="space-y-3 rounded border p-4">
        <summary>Nhập JSON</summary>
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); importMutation.mutate(); }}>
          <label>Nhãn nguồn <input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={200} /></label>
          <label>Chọn tệp <input type="file" accept=".json,application/json" onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void file.text().then(setJson);
          }} /></label>
          <label>Dữ liệu JSON <textarea className="block w-full" rows={5} value={json} onChange={(e) => setJson(e.target.value)} required /></label>
          <button disabled={importMutation.isPending} type="submit">Nhập tri thức</button>
        </form>
        {imported.length > 0 && <ul aria-label="Kết quả nhập">{imported.map((result) =>
          <li key={result.index}>{result.entryId ?? `Dòng ${result.index + 1}`}: {({
            invalid: "Không hợp lệ", pending: "Chờ duyệt", accepted: "Đã áp dụng", refreshed: "Đã kiểm tra lại",
          })[result.status] ?? result.status}{result.errors?.length ? ` · ${result.errors.join("; ")}` : ""}</li>)}</ul>}
      </details>
      <nav aria-label="Loại tri thức" className="flex flex-wrap gap-3">
        {["all", ...ExternalKnowledgeKindSchema.options, "pending", "history", "changes", "health"].map((id) => (
          <button key={id} aria-pressed={tab === id} className="rounded border px-2 py-1" onClick={() => setTab(id)}>
            {id === "all" ? "Tất cả" : id === "pending" ? `Chờ duyệt (${pending.data?.proposals.length ?? 0})` : id === "history" ? "Lịch sử" : id === "changes" ? "Thay đổi" : id === "health" ? "Tài khoản và video" : kindText[id]}
          </button>
        ))}
      </nav>
      {tab === "health" ? <AccountHealthPanel /> : tab === "changes" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <label>Trạng thái <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Tất cả</option>
              <option value="open">Đang mở</option>
              <option value="acknowledged">Đã tiếp tục</option>
              <option value="resolved">Đã đóng</option>
            </select></label>
            <label>Mức <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="">Tất cả</option>
              <option value="info">Thông tin</option>
              <option value="warn">Cảnh báo</option>
              <option value="high">Cao</option>
              <option value="critical">Nghiêm trọng</option>
            </select></label>
          </div>
          {changes.isPending && <p>Đang tải thay đổi…</p>}
          {changes.data?.events.length === 0 && <p>Không có thay đổi khớp bộ lọc.</p>}
          {changes.data?.events.map((event) => (
            <article className="space-y-2 rounded border p-4" key={event.id}>
              <h2 className="font-semibold">{event.summary}</h2>
              <p>{severityText[event.severity] ?? event.severity} · {statusText[event.status] ?? event.status} · {event.detector} · thấy {event.seenCount} lần</p>
              {event.reaction.proposalId && <p><a className="underline" href="/settings/knowledge?tab=pending">Mở đề xuất</a></p>}
              <div className="flex gap-4">
                <button disabled={mutation.isPending || event.status !== "open"} onClick={() => mutation.mutate({ path: `/knowledge/changes/${event.id}/continue`, body: {} })}>Tiếp tục</button>
                <button disabled={mutation.isPending || event.status === "resolved"} onClick={() => mutation.mutate({ path: `/knowledge/changes/${event.id}/resolve`, body: {} })}>Đóng</button>
              </div>
            </article>
          ))}
        </div>
      ) : tab === "pending" ? (
        <div className="space-y-3">
          {pending.isPending && <p>Đang tải đề xuất…</p>}
          {pending.data?.proposals.length === 0 && <p>Không có đề xuất chờ duyệt.</p>}
          {pending.data?.proposals.map((proposal) => (
            <article className="space-y-2 rounded border p-4" key={proposal.id}>
              <h2 className="font-semibold">{proposal.entryId} · Rủi ro {riskText[proposal.risk]}</h2>
              <p>Nơi sử dụng: {proposal.consumers.join(", ") || "Chưa có"}</p>
              <ul>{proposal.patch.map((op, i) => <li key={i}>
                <code>{op.op} {op.path || "/"}</code>{"value" in op && <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{JSON.stringify(op.value, null, 2)}</pre>}
              </li>)}</ul>
              <Sources evidence={proposal.proposed.evidence} />
              <div className="flex gap-4">
                <button disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `/knowledge/proposals/${proposal.id}/accept`, body: {} })}>Duyệt</button>
                <button disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `/knowledge/proposals/${proposal.id}/reject`, body: {} })}>Bỏ qua</button>
              </div>
            </article>
          ))}
        </div>
      ) : tab === "history" ? (
        <div className="space-y-2">
          {revisions.isPending && <p>Đang tải lịch sử…</p>}
          {revisions.data?.entries.length === 0 && <p>Chưa có bản sửa đã duyệt.</p>}
          {revisions.data?.entries.map(({ id, revision }) => <div key={id} className="rounded border p-3">
            <button className="text-left underline" onClick={() => setSelected(id)}>{id}</button>{" "}
            <span>Bản {revision}</span>
          </div>)}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.isPending && <p>Đang tải tri thức…</p>}
          {entries.data?.entries.length === 0 && <p>Chưa có mục tri thức.</p>}
          {entries.data?.entries.map((row) => <div key={row.entry.id} className="rounded border p-3">
            <button className="text-left underline" onClick={() => setSelected(row.entry.id)}>{row.entry.id}</button>{" "}
            <span className="rounded border px-2">{freshnessText[row.freshness]}</span>
            <span className="ml-2 text-sm">Rà lại từ {row.reviewAfter}</span>
            <Sources evidence={row.entry.evidence} />
          </div>)}
        </div>
      )}
      {selected && <section className="space-y-2 rounded border p-4" aria-label="Lịch sử tri thức">
        <h2 className="font-semibold">Lịch sử · {selected}</h2>
        {detail.isPending && <p>Đang tải lịch sử…</p>}
        {detail.data && <>
          <p>Nơi sử dụng: {detail.data.consumers.join(", ") || "Chưa có"}</p>
          {detail.data.current && <details>
            <summary>Dữ liệu đang áp dụng</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(detail.data.current.entry.value, null, 2)}</pre>
          </details>}
          {detail.data.history.length === 0 && <p>Chưa có bản sửa đã duyệt.</p>}
          {detail.data.history.length > 0 && <button disabled={mutation.isPending} onClick={() => rollback(0)}>Khôi phục bản gốc</button>}
          <ul>{detail.data.history.map((row) => <li key={row.revision}>
            Bản {row.revision} · {row.createdAt.slice(0, 10)} · {row.reason}{" "}
            <button disabled={mutation.isPending || row.revision === detail.data?.history[0].revision} onClick={() => rollback(row.revision)}>Khôi phục</button>
          </li>)}</ul>
        </>}
        <button onClick={() => setSelected(null)}>Đóng lịch sử</button>
      </section>}
    </section>
  );
}

function Sources({ evidence }: { evidence: KnowledgeEntry["evidence"] }) {
  return <ul className="text-sm">{evidence.map((source, index) => <li key={`${source.url}:${index}`} style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
    <a className="underline" href={source.url} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere", wordBreak: "break-all" }}>{source.url}</a>{" "}
    <time dateTime={source.checkedAt}>{source.checkedAt}</time>{source.sourceUpdatedAt && ` · Nguồn cập nhật ${source.sourceUpdatedAt}`}
    {source.quote && <blockquote>{source.quote}</blockquote>}
  </li>)}</ul>;
}
