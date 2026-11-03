import { useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useUsage } from "../../hooks/useUsage";
import type { UsageGroupBy, UsageQuery } from "@vg/shared";
import { formatTokens, formatUsd, formatVnd } from "./usageFormatting";

const GROUP_OPTIONS: { value: UsageGroupBy; label: string }[] = [
  { value: "day", label: "Ngày" },
  { value: "provider", label: "Nhà cung cấp" },
  { value: "model", label: "Mô hình" },
  { value: "project", label: "Video" },
];
const SUBSCRIPTION_PROVIDERS = new Set(["claude-cli", "copilot-cli", "antigravity-cli"]);

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-01`,
    to: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
  };
}

function UsageTotalsCards({ totals, rate }: {
  totals: { llmCalls: number; inputTokens: number; outputTokens: number; cachedCalls: number; fallbackCalls: number; premiumRequests: number; tokensUnknown: boolean; costUsd: number };
  rate: number;
}) {
  const cards = [
    ["Token vào", formatTokens(totals.inputTokens, totals.tokensUnknown)],
    ["Token ra", formatTokens(totals.outputTokens, totals.tokensUnknown)],
    ["Lượt gọi", new Intl.NumberFormat("vi-VN").format(totals.llmCalls)],
    ["Lượt yêu cầu premium", new Intl.NumberFormat("vi-VN").format(totals.premiumRequests)],
    ["Dùng cache", new Intl.NumberFormat("vi-VN").format(totals.cachedCalls)],
    ["Dự phòng", new Intl.NumberFormat("vi-VN").format(totals.fallbackCalls)],
  ];
  return (
    <section className="usage-stat-grid" aria-label="Tổng mức dùng">
      {cards.map(([label, value]) => <article className="panel usage-stat" key={label}>
        <span>{label}</span><strong>{value}</strong>
      </article>)}
      <article className="panel usage-stat">
        <span>Chi phí ước tính</span><strong>{formatVnd(totals.costUsd, rate)}</strong><small>{formatUsd(totals.costUsd)}</small>
      </article>
    </section>
  );
}

export function UsagePage() {
  const initialRange = currentMonthRange();
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [groupBy, setGroupBy] = useState<UsageGroupBy>("day");
  const query: UsageQuery = { from, to, groupBy };
  const usage = useUsage(query);

  if (usage.isPending) return <Spinner label="Đang tải mức sử dụng" />;
  if (usage.isError) {
    return <ErrorState message={usage.error instanceof Error ? usage.error.message : "Không thể tải mức sử dụng"} onRetry={() => void usage.refetch()} />;
  }
  const data = usage.data;
  return (
    <div className="page-stack usage-page">
      <div className="page-heading">
        <div><p className="eyebrow">MỨC DÙNG AI</p><h1>Mức sử dụng</h1><p className="page-subtitle">Token, lượt gọi và chi phí ước tính trên toàn ứng dụng.</p></div>
      </div>
      <section className="panel usage-filters" aria-label="Bộ lọc mức sử dụng">
        <label>Từ ngày<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Đến ngày<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Nhóm theo<select value={groupBy} onChange={(event) => setGroupBy(event.target.value as UsageGroupBy)}>
          {GROUP_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>
      </section>
      <UsageTotalsCards totals={data.totals} rate={data.usdVndRate} />
      <section className="panel usage-section">
        <div className="section-heading"><div><p className="eyebrow">PHÂN TÍCH</p><h2>Theo {GROUP_OPTIONS.find((option) => option.value === groupBy)?.label.toLowerCase()}</h2></div></div>
        {data.byGroup.length === 0 ? <p className="usage-empty">Chưa có lượt gọi LLM trong khoảng thời gian này.</p> : (
          <div className="usage-table-wrap"><table className="usage-table">
            <thead><tr><th>Nhóm</th><th>Lượt gọi</th><th>Token vào</th><th>Token ra</th><th>Chi phí ước tính</th></tr></thead>
            <tbody>{data.byGroup.map((group) => {
              const provider = group.key.split("/")[0];
              const isSubscription = group.costUsd === 0 && SUBSCRIPTION_PROVIDERS.has(provider);
              return <tr key={group.key}>
                <th scope="row">{group.label}</th>
                <td>{group.llmCalls}</td>
                <td>{formatTokens(group.inputTokens, group.tokensUnknown)}</td>
                <td>{formatTokens(group.outputTokens, group.tokensUnknown)}</td>
                <td>{isSubscription ? "0 ₫ (gói subscription)" : `${formatVnd(group.costUsd, data.usdVndRate)} · ${formatUsd(group.costUsd)}`}</td>
              </tr>;
            })}</tbody>
          </table></div>
        )}
      </section>
      <section className="panel usage-section">
        <div className="section-heading"><div><p className="eyebrow">VIDEO</p><h2>Video tốn nhiều token nhất</h2></div></div>
        {data.topProjects.length === 0 ? <p className="usage-empty">Chưa có dữ liệu sử dụng.</p> : (
          <ol className="usage-top-projects">{data.topProjects.map((project) => <li key={project.projectId}>
            <Link to={`/projects/${project.projectId}/usage`}>{project.projectTitle}</Link>
            <span>{formatTokens(project.totals.inputTokens + project.totals.outputTokens, project.totals.tokensUnknown)} token</span>
          </li>)}</ol>
        )}
      </section>
      <p className="usage-disclaimer">Chi phí là ước tính theo giá của nhà cung cấp. Các lượt dùng gói subscription hiển thị 0 ₫; tỷ giá quy đổi USD/VND: {data.usdVndRate.toLocaleString("vi-VN")}.</p>
    </div>
  );
}
