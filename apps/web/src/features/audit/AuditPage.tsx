import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { fetchAudit, type AuditFilters, type AuditItem } from "../../services/auditApi";
import { fetchMembers } from "../../services/teamApi";

const SOURCES = [
  ["", "Mọi nguồn"], ["api", "Giao diện / API"], ["assistant", "Trợ lý AI"], ["mcp", "MCP"], ["operator", "Operator"], ["system", "Hệ thống"],
] as const;
const OUTCOMES: Array<[string, string]> = [["", "Mọi kết quả"], ["ok", "Thành công"], ["denied", "Bị từ chối"], ["error", "Lỗi"]];
const OUTCOME_TONE: Record<string, BadgeTone> = { ok: "success", denied: "warning", error: "danger" };
const OUTCOME_LABEL: Record<string, string> = { ok: "Thành công", denied: "Bị từ chối", error: "Lỗi" };

/** Who did it: a person, or a key/agent acting for a person. */
export function actorLabel(item: AuditItem): string {
  if (item.actorKeyName) return `Khóa ${item.actorKeyName}`;
  if (item.actorName) return item.actorName;
  return item.actorKind === "system" ? "Hệ thống" : "Không rõ";
}

function dayStart(value: string): string {
  return value ? String(new Date(`${value}T00:00:00`).getTime()) : "";
}
function dayEnd(value: string): string {
  return value ? String(new Date(`${value}T23:59:59.999`).getTime()) : "";
}

export function prettyPayload(payload: string | null): string {
  if (!payload) return "Không có chi tiết.";
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function AuditPage() {
  const [form, setForm] = useState({ actor: "", action: "", source: "", outcome: "", from: "", to: "" });
  const [applied, setApplied] = useState<AuditFilters>({});
  const [open, setOpen] = useState<AuditItem | null>(null);
  const members = useQuery({ queryKey: ["team-members"], queryFn: fetchMembers });
  const list = useInfiniteQuery({
    queryKey: ["audit", applied],
    queryFn: ({ pageParam }) => fetchAudit(applied, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  function apply() {
    setApplied({
      actor: form.actor, action: form.action.trim(), source: form.source, outcome: form.outcome,
      from: dayStart(form.from), to: dayEnd(form.to),
    });
    setOpen(null);
  }

  return (
    <div className="page-stack">
      <PageHeader title="Nhật ký hoạt động" description="Ai đã làm gì, lúc nào, từ đâu. Chỉ ghi lại, không sửa được." helpHref="/help/khong-gian-va-quyen" />
      <Card title="Bộ lọc">
        <form className="filter-row" onSubmit={(event) => { event.preventDefault(); apply(); }}>
          <label>Người
            <select value={form.actor} onChange={(event) => setForm({ ...form, actor: event.target.value })}>
              <option value="">Mọi người</option>
              {members.data?.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
            </select>
          </label>
          <label>Hành động
            <input value={form.action} placeholder="vd: member, apikey" onChange={(event) => setForm({ ...form, action: event.target.value })} />
          </label>
          <label>Nguồn
            <select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })}>
              {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Kết quả
            <select value={form.outcome} onChange={(event) => setForm({ ...form, outcome: event.target.value })}>
              {OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Từ ngày<input type="date" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} /></label>
          <label>Đến ngày<input type="date" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} /></label>
          <Button type="submit">Lọc</Button>
        </form>
      </Card>

      <Card title="Hoạt động">
        {list.isError ? <p role="alert">Không tải được nhật ký.</p> : null}
        {list.isLoading ? <p role="status">Đang tải…</p> : items.length === 0 ? <p className="muted">Chưa có hoạt động nào khớp bộ lọc.</p> : (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead><tr><th scope="col">Lúc</th><th scope="col">Ai</th><th scope="col">Việc</th><th scope="col">Nguồn</th><th scope="col">Kết quả</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.at).toLocaleString("vi-VN")}</td>
                    <td>{actorLabel(item)}</td>
                    <td>
                      <button type="button" className="link-button" onClick={() => setOpen(item)}>{item.summary || item.action}</button>
                      <br /><span className="muted">{item.action}</span>
                    </td>
                    <td>{SOURCES.find(([value]) => value === item.source)?.[1] ?? item.source}</td>
                    <td><Badge tone={OUTCOME_TONE[item.outcome] ?? "neutral"}>{OUTCOME_LABEL[item.outcome] ?? item.outcome}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage ? (
          <div className="ui-load-more">
            <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => { void list.fetchNextPage(); }}>Tải thêm</Button>
          </div>
        ) : null}
      </Card>

      {open ? (
        <aside className="panel audit-detail" aria-label="Chi tiết hoạt động">
          <div className="section-heading"><h2>Chi tiết</h2><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Đóng</Button></div>
          <dl>
            <dt>Hành động</dt><dd>{open.action}</dd>
            <dt>Đối tượng</dt><dd>{open.targetType ? `${open.targetType} ${open.targetId ?? ""}` : "—"}</dd>
            <dt>Mã trạng thái</dt><dd>{open.statusCode ?? "—"}</dd>
            <dt>Mã yêu cầu</dt><dd>{open.requestId ?? "—"}</dd>
          </dl>
          <p className="muted">Dữ liệu nhạy cảm (mật khẩu, khóa, mã) đã bị che ở server trước khi lưu.</p>
          <pre className="audit-payload">{prettyPayload(open.payload)}</pre>
        </aside>
      ) : null}
    </div>
  );
}
