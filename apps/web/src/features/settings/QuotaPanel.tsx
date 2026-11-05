import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LlmQuotaRow, LlmQuotaStatus, LiveQuotaEntry, OmniRouteLiveView, QuotaPolicy } from "@vg/shared";
import { relativeUntil } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  clearLlmCooldown,
  getLlmQuotaStatus,
  refreshOmnirouteQuota,
  removeOmnirouteToken,
  saveLlmQuotaPolicy,
  saveLlmQuotaRule,
  saveOmnirouteToken,
  setLlmQuotaRuleEnabled,
} from "../../services/llmApi";

export function quotaStatusLabel(status: LlmQuotaRow["status"], until: string | null): string {
  if (status === "near") return "Sắp hết";
  if (status === "exhausted" || status === "cooldown") {
    if (!until) return "Hết";
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
  if (window === "lifetime") return "trọn đời";
  return "5 giờ";
}

function clock(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function syncLabel(status: OmniRouteLiveView["status"]): string {
  if (status === "connected") return "Đã kết nối OmniRoute";
  if (status === "needs_token") return "Cần token quản trị";
  if (status === "unreachable") return "Không kết nối được OmniRoute";
  return "Chưa đồng bộ";
}

function liveChip(status: LiveQuotaEntry["status"]): string {
  if (status === "near") return "Sắp hết";
  if (status === "exhausted") return "Hết";
  if (status === "unknown") return "Chưa rõ";
  return "Còn";
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
    unit: "requests" as "requests" | "credits_usd",
    creditsUsd: "",
    expiresAt: "",
  });
  const [token, setToken] = useState("");

  const refresh = async (saved: LlmQuotaStatus) => {
    queryClient.setQueryData(["llm-quota"], saved);
    setPolicy(null);
    setCap(null);
    setEditing(null);
    setToken("");
  };
  const prefillRule = (provider: string, model: string, unit: "requests" | "credits_usd" = "requests") => {
    setDraftRule((current) => ({
      ...current,
      provider,
      model,
      unit,
      window: unit === "credits_usd" ? "lifetime" : "day",
    }));
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
  const refreshLiveMutation = useMutation({ mutationFn: refreshOmnirouteQuota, onSuccess: refresh });
  const saveTokenMutation = useMutation({ mutationFn: saveOmnirouteToken, onSuccess: refresh });
  const removeTokenMutation = useMutation({ mutationFn: removeOmnirouteToken, onSuccess: refresh });

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
      <p className="field-hint">Số trong preset chỉ là ước tính. Sửa hoặc tắt quy tắc nếu trang nhà cung cấp đã đổi hạn mức. Credit miễn phí không tính vào trần trả phí.</p>
      <LiveQuotaSection
        view={data.omniroute}
        token={token}
        setToken={setToken}
        refreshing={refreshLiveMutation.isPending}
        savingToken={saveTokenMutation.isPending}
        onRefresh={() => refreshLiveMutation.mutate()}
        onSaveToken={() => saveTokenMutation.mutate(token)}
        onRemoveToken={() => removeTokenMutation.mutate()}
        onCreateRule={prefillRule}
      />
      {data.freeCreditSpendUsd > 0 && (
        <p>Dùng credit miễn phí: ${data.freeCreditSpendUsd.toFixed(2)}. Dự phòng trả phí hôm nay: ${data.paidFallbackSpendToday.toFixed(2)}.</p>
      )}
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
      <h3>Quy tắc ước tính / tự đặt</h3>
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
                <tr key={key} className={row.coveredByLive ? "quota-row-covered" : undefined} data-testid={`quota-row-${row.provider}-${row.model}`}>
                  <th scope="row">
                    {row.provider}/{row.model}
                    <span className="ai-chip">{row.source === "user" ? "tự đặt" : "ước tính"}</span>
                    {row.coveredByLive ? <span> đang dùng số thật từ OmniRoute</span> : null}
                  </th>
                  <td>{kindLabel(row.kind)}</td>
                  <td>
                    <div>app đã dùng</div>
                    {row.windows.map((window) => {
                      const used = window.creditsUsdLimit != null ? window.creditsUsdUsed : window.requestsLimit != null ? window.requestsUsed : window.inputTokensUsed;
                      const limit = window.creditsUsdLimit ?? window.requestsLimit ?? window.inputTokensLimit ?? window.outputTokensLimit;
                      const ratio = Math.max(0, Math.min(1, window.ratio));
                      return (
                        <div key={window.window}>
                          {limit == null ? windowLabel(window.window) : window.unit === "credits_usd" ? `${windowLabel(window.window)} $${used ?? 0} / $${limit}` : `${windowLabel(window.window)} ${used} / ${limit}`}
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
        const credits = draftRule.unit === "credits_usd";
        ruleMutation.mutate({
          provider: draftRule.provider.trim(),
          model: draftRule.model.trim() || "*",
          kind: draftRule.kind,
          limits: credits
            ? [{
              window: "lifetime" as const,
              creditsUsd: Math.max(0, Number(draftRule.creditsUsd) || 0),
              unit: "credits_usd" as const,
              ...(draftRule.expiresAt ? { expiresAt: new Date(`${draftRule.expiresAt}T23:59:59.000Z`).toISOString() } : {}),
            }]
            : [{ window: draftRule.window, requests: Math.max(1, Number(draftRule.requests) || 1) }],
          resetTz: "America/Los_Angeles",
          note: "ước tính, kiểm tra trang nhà cung cấp",
          source: "user",
          enabled: true,
        });
      }} id="quota-rule-form">
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
            <option value="lifetime">trọn đời</option>
          </select>
        </label>
        <label className="form-field"><span>Đơn vị</span>
          <select aria-label="Đơn vị của quy tắc mới" value={draftRule.unit} onChange={(event) => setDraftRule((current) => ({ ...current, unit: event.target.value as "requests" | "credits_usd" }))}>
            <option value="requests">lượt</option>
            <option value="credits_usd">credit USD</option>
          </select>
        </label>
        {draftRule.unit === "credits_usd" ? (
          <>
            <label className="form-field"><span>Số credit được cấp (USD)</span>
              <input aria-label="Số credit của quy tắc mới" type="number" min={0} step="0.01" value={draftRule.creditsUsd} onChange={(event) => setDraftRule((current) => ({ ...current, creditsUsd: event.target.value }))} />
            </label>
            <label className="form-field"><span>Hết hạn</span>
              <input aria-label="Ngày hết hạn credit" type="date" value={draftRule.expiresAt} onChange={(event) => setDraftRule((current) => ({ ...current, expiresAt: event.target.value }))} />
            </label>
          </>
        ) : (
          <label className="form-field"><span>Số request</span>
            <input aria-label="Số request của quy tắc mới" type="number" min={1} value={draftRule.requests} onChange={(event) => setDraftRule((current) => ({ ...current, requests: event.target.value }))} />
          </label>
        )}
        <div className="button-row">
          <button className="button button-secondary" type="submit" disabled={ruleMutation.isPending}>Thêm quy tắc</button>
        </div>
      </form>
    </section>
  );
}

function LiveQuotaSection({
  view,
  token,
  setToken,
  refreshing,
  savingToken,
  onRefresh,
  onSaveToken,
  onRemoveToken,
  onCreateRule,
}: {
  view: OmniRouteLiveView;
  token: string;
  setToken: (value: string) => void;
  refreshing: boolean;
  savingToken: boolean;
  onRefresh: () => void;
  onSaveToken: () => void;
  onRemoveToken: () => void;
  onCreateRule: (provider: string, model: string) => void;
}) {
  const now = new Date();
  return (
    <section aria-label="Từ OmniRoute (số thật)">
      <h3>Từ OmniRoute (số thật)</h3>
      <p>
        {syncLabel(view.status)}
        {view.fetchedAt ? ` · cập nhật lúc ${clock(view.fetchedAt)}` : ""}
      </p>
      {view.message ? <p className="field-hint">{view.message}</p> : null}
      <div className="button-row">
        <button type="button" className="button button-secondary" onClick={onRefresh} disabled={refreshing}>Làm mới</button>
      </div>
      {view.status === "needs_token" && (
        <div>
          <p>OmniRoute cần token chỉ đọc để lấy quota thật:</p>
          <ol className="quota-steps">
            <li>Mở {view.dashboardUrl}</li>
            <li>Vào Settings → Access Tokens</li>
            <li>Tạo token chỉ đọc</li>
            <li>Dán token vào ô bên dưới</li>
          </ol>
        </div>
      )}
      {view.tokenSaved ? (
        <p>đã lưu {view.tokenLast4}</p>
      ) : null}
      {(view.status === "needs_token" || !view.tokenSaved) && (
        <form className="quota-token-row" onSubmit={(event) => { event.preventDefault(); onSaveToken(); }}>
          <label className="form-field">
            <span>Token quản trị</span>
            <input
              aria-label="Token quản trị OmniRoute"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={savingToken || token.trim().length < 8}>Lưu token</button>
        </form>
      )}
      {view.tokenSaved && (
        <button type="button" className="text-button" onClick={onRemoveToken}>Xoá token</button>
      )}
      <div className="quota-live-grid">
        {view.connections.map((card) => (
          <article key={card.connectionId} className="quota-live-card" data-testid={`omni-card-${card.connectionId}`}>
            <div className="quota-live-head">
              <span className="ai-chip">{card.provider}</span>
              <strong>{card.label}</strong>
              {card.maskedAccount ? <span>{card.maskedAccount}</span> : null}
            </div>
            {card.quotas.map((quota) => {
              const ratio = quota.unlimited
                ? 1
                : quota.remainingPct == null
                  ? (quota.status === "exhausted" ? 0 : 1)
                  : Math.max(0, Math.min(1, quota.remainingPct / 100));
              const until = quota.resetAt ? new Date(quota.resetAt).toLocaleString("vi-VN") : null;
              const relative = relativeUntil(quota.resetAt, now);
              return (
                <div key={quota.key}>
                  <div>{quota.key}: {quota.display}</div>
                  {quota.expiryLabel ? <div>{quota.expiryLabel}</div> : null}
                  <span className={`quota-bar${quota.status === "exhausted" ? " is-out" : quota.status === "near" ? " is-near" : ""}`}>
                    <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                  <div>
                    {until ? `${until}${relative ? ` (${relative})` : ""}` : "không có giờ reset"}
                    {" "}
                    <span className={quota.status === "exhausted" ? "ai-chip quota-chip-out" : quota.status === "near" ? "ai-chip quota-chip-near" : "ai-chip quota-chip-ok"}>{liveChip(quota.status)}</span>
                  </div>
                </div>
              );
            })}
            {card.tasks.length > 0 ? <p>đang dùng cho: {card.tasks.join(", ")}</p> : null}
            {card.noQuotaData ? <p>Nhà cung cấp này không báo quota qua OmniRoute</p> : null}
            {card.noQuotaData ? (
              <button type="button" className="text-button" onClick={() => onCreateRule(card.manualRule.provider, card.manualRule.model)}>Tạo quy tắc thủ công</button>
            ) : null}
            {card.error ? <p>{card.error}</p> : null}
            {card.rateLimitNote ? <p>{card.rateLimitNote}</p> : null}
          </article>
        ))}
      </div>
      <h3>Model đang dùng chưa có quota</h3>
      {view.missingModels.length === 0 ? (
        <p className="field-hint">Mọi model đang định tuyến đã có số thật hoặc quy tắc.</p>
      ) : (
        <ul>
          {view.missingModels.map((item) => (
            <li key={`${item.provider}/${item.model}`}>
              {item.provider}/{item.model}
              {item.tasks.length > 0 ? ` · ${item.tasks.join(", ")}` : ""}
              <button type="button" className="text-button" onClick={() => onCreateRule(item.provider, item.model)}>Thêm quy tắc</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
