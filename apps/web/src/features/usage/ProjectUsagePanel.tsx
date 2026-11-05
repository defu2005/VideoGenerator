import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BudgetEstimateSchema } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useProjectUsage } from "../../hooks/useUsage";
import { apiRequest } from "../../services/apiClient";
import { formatTokens, formatUsd, formatVnd } from "./usageFormatting";

const SUBSCRIPTION_PROVIDERS = new Set(["claude-cli", "copilot-cli", "antigravity-cli"]);

function formatTime(value: string | null): string {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Đang chạy";
}

export function ProjectUsagePanel({ projectId }: { projectId: string }) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const usage = useProjectUsage(projectId);
  const estimate = useQuery({
    queryKey: ["budget-estimate", projectId],
    queryFn: async () => BudgetEstimateSchema.parse(await apiRequest<unknown>(`/projects/${projectId}/budget-estimate`)),
  });

  if (usage.isPending) return <Spinner label="Đang tải token của video" />;
  if (usage.isError) return <ErrorState message={usage.error instanceof Error ? usage.error.message : "Không thể tải token của video"} onRetry={() => void usage.refetch()} />;
  const data = usage.data;
  const totals = data.totals;
  const allSubscription = data.byModel.length > 0 && data.byModel.every((model) =>
    SUBSCRIPTION_PROVIDERS.has(model.key.split("/")[0]));
  const estimateText = estimate.isError
    ? "Không thể tải ước tính trước khi chạy."
    : estimate.isPending
      ? "Đang tải ước tính..."
      : `Đã dùng ${totals.llmCalls} lượt; các bước chưa chạy ước tính thêm ~${estimate.data.total.min}${estimate.data.total.max === estimate.data.total.min ? "" : `–${estimate.data.total.max}`} lượt.`;

  return (
    <div className="usage-project">
      <section className="usage-stat-grid" aria-label="Tổng token của video">
        <article className="panel usage-stat"><span>Token vào</span><strong>{formatTokens(totals.inputTokens, totals.tokensUnknown)}</strong></article>
        <article className="panel usage-stat"><span>Token ra</span><strong>{formatTokens(totals.outputTokens, totals.tokensUnknown)}</strong></article>
        <article className="panel usage-stat"><span>Lượt gọi LLM</span><strong>{totals.llmCalls.toLocaleString("vi-VN")}</strong></article>
        <article className="panel usage-stat"><span>Lượt yêu cầu premium</span><strong>{totals.premiumRequests.toLocaleString("vi-VN")}</strong></article>
        <article className="panel usage-stat"><span>Lượt cache</span><strong>{totals.cachedCalls.toLocaleString("vi-VN")}</strong></article>
        <article className="panel usage-stat"><span>Lượt dự phòng</span><strong>{totals.fallbackCalls.toLocaleString("vi-VN")}</strong></article>
        <article className="panel usage-stat">
          <span>Chi phí ước tính</span>
          <strong>{allSubscription && totals.costUsd === 0 ? "0 ₫ (gói subscription)" : formatVnd(totals.costUsd, data.usdVndRate)}</strong>
          {!allSubscription && <small>{formatUsd(totals.costUsd)}</small>}
        </article>
      </section>
      <p className={`usage-estimate${estimate.isError ? " is-error" : ""}`} role={estimate.isError ? "alert" : undefined}>{estimateText}</p>
      <section className="panel usage-section">
        <div className="section-heading"><div><p className="eyebrow">QUÁ TRÌNH</p><h2>Mức dùng theo quá trình</h2></div></div>
        {data.byStage.length === 0 ? <p className="usage-empty">Video này chưa có dữ liệu gọi LLM.</p> : (
          <div className="usage-stage-list">{data.byStage.map((stage) => {
            const expanded = expandedStage === stage.key;
            const stageRuns = data.runs.filter((run) => run.stage === stage.key);
            const stageTasks = new Map<string, { calls: number; input: number; output: number; unknown: boolean }>();
            for (const run of stageRuns) {
              for (const call of run.calls) {
                const task = stageTasks.get(call.task) ?? { calls: 0, input: 0, output: 0, unknown: false };
                task.calls += call.cached ? 0 : call.callCount;
                task.input += call.cached ? 0 : call.inputTokens;
                task.output += call.cached ? 0 : call.outputTokens;
                task.unknown ||= call.tokensUnknown;
                stageTasks.set(call.task, task);
              }
            }
            return <article className="usage-stage" key={stage.key}>
              <button className="usage-stage-button" type="button" aria-expanded={expanded} onClick={() => setExpandedStage(expanded ? null : stage.key)}>
                <span>{stage.label}</span><span>{stage.llmCalls} lượt</span>
                <span>{formatTokens(stage.inputTokens + stage.outputTokens, stage.tokensUnknown)} token</span>
                <span aria-hidden="true">{expanded ? "−" : "+"}</span>
              </button>
              {expanded && <div className="usage-stage-details">
                <h3>Tác vụ</h3>
                {stageTasks.size === 0 ? <p>Không có tác vụ LLM được ghi nhận.</p> : <ul>{[...stageTasks.entries()].map(([task, value]) => <li key={task}>{task}: {value.calls} lượt · {formatTokens(value.input + value.output, value.unknown)} token</li>)}</ul>}
                <h3>Từng lần chạy</h3>
                <div className="usage-table-wrap"><table className="usage-table">
                  <thead><tr><th>Trạng thái</th><th>Lượt thử</th><th>Phạm vi</th><th>Thời gian</th><th>Tác vụ / mô hình</th><th>Token</th></tr></thead>
                  <tbody>{stageRuns.map((run) => <tr key={run.jobId}>
                    <td>{run.status}</td><td>{run.attempt}</td><td>{run.scope ?? "—"}</td>
                    <td>{formatTime(run.startedAt)}{run.durationMs === null ? "" : ` · ${(run.durationMs / 1000).toFixed(1)} giây`}</td>
                    <td>{run.calls.map((call, index) => <div key={`${call.task}-${index}`}>{call.task} · {call.provider}/{call.model}{call.cached ? " · cache" : ""}{call.fallback && call.fallbackReason === "quota" ? <span className="ai-chip quota-chip-out">dự phòng (hết quota)</span> : call.fallback ? " · dự phòng" : ""}{!call.ok ? " · lỗi" : ""}</div>)}</td>
                    <td>{formatTokens(run.totals.inputTokens + run.totals.outputTokens, run.totals.tokensUnknown)}</td>
                  </tr>)}</tbody>
                </table></div>
              </div>}
            </article>;
          })}</div>
        )}
      </section>
      <section className="panel usage-section">
        <div className="section-heading"><div><p className="eyebrow">MÔ HÌNH</p><h2>Theo mô hình</h2></div></div>
        {data.byModel.length === 0 ? <p className="usage-empty">Chưa có mô hình được ghi nhận.</p> : <div className="usage-table-wrap"><table className="usage-table">
          <thead><tr><th>Nhà cung cấp / mô hình</th><th>Lượt gọi</th><th>Token vào</th><th>Token ra</th><th>Chi phí ước tính</th></tr></thead>
          <tbody>{data.byModel.map((model) => <tr key={model.key}>
            <th scope="row">{model.label}</th><td>{model.llmCalls}</td>
            <td>{formatTokens(model.inputTokens, model.tokensUnknown)}</td><td>{formatTokens(model.outputTokens, model.tokensUnknown)}</td>
            <td>{SUBSCRIPTION_PROVIDERS.has(model.key.split("/")[0]) ? "0 ₫ (gói subscription)" : `${formatVnd(model.costUsd, data.usdVndRate)} · ${formatUsd(model.costUsd)}`}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <p className="usage-disclaimer">Chi phí là ước tính; tỷ giá quy đổi USD/VND: {data.usdVndRate.toLocaleString("vi-VN")}.</p>
    </div>
  );
}
