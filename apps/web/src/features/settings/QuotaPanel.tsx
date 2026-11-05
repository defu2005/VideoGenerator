import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LlmQuotaRow, LlmQuotaStatus, QuotaPolicy } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  clearLlmCooldown,
  getLlmQuotaStatus,
  saveLlmQuotaPolicy,
  saveLlmQuotaRule,
  setLlmQuotaRuleEnabled,
} from "../../services/llmApi";

export function quotaStatusLabel(status: LlmQuotaRow["status"], until: string | null): string {
  if (status === "near") return "Sắp hết";
  if (status === "exhausted" || status === "cooldown") {
    if (!until) return "Hết – chờ đến";
    const date = new Date(until);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `Hết – chờ đến ${hh}:${mm}`;
  }
  return "Còn";
}

function chipClass(status: LlmQuotaRow["status"]): string {
  if (status === "near") return "ai-chip quota-chip-near";
  if (status === "exhausted" || status === "cooldown") return "ai-chip quota-chip-out";
  return "ai-chip quota-chip-ok";
}

function windowLabel(window: LlmQuotaRow["windows"][number]["window"]): string {
  if (window === "minute") return "phút";
  if (window === "day") return "ngày";
  if (window === "month") return "tháng";
  return "5 giờ";
}

function kindLabel(kind: LlmQuotaRow["kind"]): string {
  if (kind === "free_tier") return "miễn phí";
  if (kind === "subscription") return "gói";
  return "trả phí";
}

export function QuotaPanel() {
  const queryClient = useQueryClient();
  const quota = useQuery({ queryKey: ["llm-quota"], queryFn: getLlmQuotaStatus });
  const [policy, setPolicy] = useState<QuotaPolicy | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [requests, setRequests] = useState("");
  const [draftRule, setDraftRule] = useState({
    provider: "gemini",
    model: "*",
    kind: "free_tier" as LlmQuotaRow["kind"],
    window: "day" as LlmQuotaRow["windows"][number]["window"],
    requests: "100",
  });

  const refresh = async (saved: LlmQuotaStatus) => {
    queryClient.setQueryData(["llm-quota"], saved);
    setPolicy(null);
    setCap(null);
    setEditing(null);
  };
  const policyMutation = useMutation({
    mutationFn: saveLlmQuotaPolicy,
    onSuccess: refresh,
  });
  const ruleMutation = useMutation({ mutationFn: saveLlmQuotaRule, onSuccess: refresh });
  const enabledMutation = useMutation({
    mutationFn: (input: { provider: string; model: string; enabled: boolean }) =>
      setLlmQuotaRuleEnabled(input.provider, input.model, input.enabled),
    onSuccess: refresh,
  });
  const clearMutation = useMutation({
    mutationFn: (input: { provider: string; model: string }) => clearLlmCooldown(input.provider, input.model),
    onSuccess: refresh,
  });

  if (quota.isPending) return <Spinner label="Đang tải quota" />;
  if (quota.isError || !quota.data) {
    return <ErrorState message="Không tải được quota" onRetry={() => void quota.refetch()} />;
  }
  const data = quota.data;
  const policyValue = policy ?? data.quotaPolicy;
  const capValue = cap ?? String(data.paidFallbackDailyUsd);

  return (
    <section className="panel quota-panel" aria-label="Quota">
      <h2>Quota</h2>
      <p className="field-hint">Số trong preset chỉ là ước tính. Sửa hoặc tắt quy tắc nếu trang nhà cung cấp đã đổi hạn mức.</p>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault();
        policyMutation.mutate({ quotaPolicy: policyValue, paidFallbackDailyUsd: Number(capValue) });
      }}>
        <label className="form-field">
          <span>Khi hết hạn mức miễn phí</span>
          <select aria-label="Chính sách quota" value={policyValue} onChange={(event) => setPolicy(event.target.value as QuotaPolicy)}>
            <option value="wait">Chờ reset</option>
            <option value="paid_fallback">Dùng model trả phí</option>
          </select>
        </label>
        <label className="form-field">
          <span>Trần chi phí trả phí mỗi ngày (USD)</span>
          <input aria-label="Trần chi phí trả phí" type="number" min={0} step="0.01" value={capValue} onChange={(event) => setCap(event.target.value)} />
        </label>
        <div className="button-row">
          <button className="button button-primary" type="submit" disabled={policyMutation.isPending}>Lưu chính sách quota</button>
        </div>
      </form>
      {policyMutation.isSuccess && <p className="success-message" role="status">Đã lưu chính sách quota.</p>}
      <div className="usage-table-wrap">
        <table className="usage-table quota-table">
          <thead>
            <tr>
              <th>Nhà cung cấp / model</th>
              <th>Loại</th>
              <th>Đã dùng</th>
              <th>Reset</th>
              <th>Trạng thái</th>
              <th>Chờ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const key = `${row.provider}/${row.model}`;
              const until = row.cooldownUntil ?? row.nextReset;
              return (
                <tr key={key} data-testid={`quota-row-${row.provider}-${row.model}`}>
                  <th scope="row">{row.provider}/{row.model}</th>
                  <td>{kindLabel(row.kind)}</td>
                  <td>
                    {row.windows.map((window) => {
                      const used = window.requestsLimit != null ? window.requestsUsed : window.inputTokensUsed;
                      const limit = window.requestsLimit ?? window.inputTokensLimit ?? window.outputTokensLimit;
                      const ratio = Math.max(0, Math.min(1, window.ratio));
                      return (
                        <div key={window.window}>
                          {limit == null ? windowLabel(window.window) : `${windowLabel(window.window)} ${used} / ${limit}`}
                          {limit != null && (
                            <span className={`quota-bar${ratio >= 1 ? " is-out" : ratio >= data.nearLimitRatio ? " is-near" : ""}`}>
                              <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </td>
                  <td>{row.nextReset ? new Date(row.nextReset).toLocaleString("vi-VN") : "—"}</td>
                  <td><span className={chipClass(row.status)}>{row.enabled ? quotaStatusLabel(row.status, until) : "Tắt"}</span></td>
                  <td>{row.cooldownReason ?? "—"}</td>
                  <td className="quota-actions">
                    <button type="button" className="text-button" onClick={() => { setEditing(key); setRequests(String(row.limits[0]?.requests ?? "")); }}>Sửa</button>
                    <button type="button" className="text-button" onClick={() => enabledMutation.mutate({ provider: row.provider, model: row.model, enabled: !row.enabled })}>
                      {row.enabled ? "Tắt" : "Bật"}
                    </button>
                    <button type="button" className="text-button" onClick={() => clearMutation.mutate({ provider: row.provider, model: row.model })}>Xoá chờ</button>
                    {editing === key && (
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        const limit = row.limits[0];
                        if (!limit) return;
                        ruleMutation.mutate({
                          ...row,
                          source: "user",
                          limits: [{ ...limit, requests: Number(requests) || limit.requests }],
                        });
                      }}>
                        <input aria-label={`Số request ${key}`} type="number" min={1} value={requests} onChange={(event) => setRequests(event.target.value)} />
                        <button type="submit">Lưu quy tắc</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form className="form-grid" onSubmit={(event) => {
        event.preventDefault();
        ruleMutation.mutate({
          provider: draftRule.provider.trim(),
          model: draftRule.model.trim() || "*",
          kind: draftRule.kind,
          limits: [{ window: draftRule.window, requests: Math.max(1, Number(draftRule.requests) || 1) }],
          resetTz: "America/Los_Angeles",
          note: "ước tính, kiểm tra trang nhà cung cấp",
          source: "user",
          enabled: true,
        });
      }}>
        <h3>Thêm quy tắc</h3>
        <label className="form-field"><span>Nhà cung cấp</span>
          <input aria-label="Nhà cung cấp của quy tắc mới" value={draftRule.provider} onChange={(event) => setDraftRule((current) => ({ ...current, provider: event.target.value }))} />
        </label>
        <label className="form-field"><span>Model</span>
          <input aria-label="Model của quy tắc mới" value={draftRule.model} onChange={(event) => setDraftRule((current) => ({ ...current, model: event.target.value }))} />
        </label>
        <label className="form-field"><span>Loại</span>
          <select aria-label="Loại quy tắc mới" value={draftRule.kind} onChange={(event) => setDraftRule((current) => ({ ...current, kind: event.target.value as LlmQuotaRow["kind"] }))}>
            <option value="free_tier">miễn phí</option>
            <option value="subscription">gói</option>
            <option value="paid">trả phí</option>
          </select>
        </label>
        <label className="form-field"><span>Cửa sổ</span>
          <select aria-label="Cửa sổ của quy tắc mới" value={draftRule.window} onChange={(event) => setDraftRule((current) => ({ ...current, window: event.target.value as LlmQuotaRow["windows"][number]["window"] }))}>
            <option value="minute">phút</option>
            <option value="day">ngày</option>
            <option value="month">tháng</option>
            <option value="rolling_5h">5 giờ</option>
          </select>
        </label>
        <label className="form-field"><span>Số request</span>
          <input aria-label="Số request của quy tắc mới" type="number" min={1} value={draftRule.requests} onChange={(event) => setDraftRule((current) => ({ ...current, requests: event.target.value }))} />
        </label>
        <div className="button-row">
          <button className="button button-secondary" type="submit" disabled={ruleMutation.isPending}>Thêm quy tắc</button>
        </div>
      </form>
    </section>
  );
}
