import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relayCallerLabel, type LlmRelayCallerUsage, type LlmRelayGrant, type LlmRelayStatus } from "@vg/shared";
import { Spinner } from "../../components/Spinner";
import { usePageVisible } from "../../hooks/usePageVisible";
import { deleteRelayGrant, getRelayStatus, relayStatusKey, saveRelayGrant } from "./llmRelayApi";

const REFUSAL_LABEL: Record<string, string> = {
  RELAY_MODEL_NOT_ALLOWED: "model không được phép",
  RELAY_RATE_LIMITED: "vượt tốc độ cho phép",
  RELAY_BUDGET_EXCEEDED: "ngân sách không đủ hoặc chi phí chưa rõ",
  RELAY_DISABLED: "đã tắt cho máy này",
};
const money = (usd: number) => `$${usd.toFixed(usd >= 1 ? 2 : 4)}`;
const costLabel = (row: LlmRelayCallerUsage) => row.costUnknown
  ? row.costUsd > 0 ? `${money(row.costUsd)} (ước tính/chưa đủ)` : "Chưa rõ"
  : money(row.costUsd);

export function useRelayStatus(enabled = true) {
  const visible = usePageVisible();
  return useQuery({ queryKey: relayStatusKey, queryFn: getRelayStatus, enabled, retry: false, refetchInterval: visible ? 30_000 : false });
}

/** One line for the Fleet and Nodes pages: what this caller used through the relay today and why it was last refused. */
export function RelayUsageLine({ status, match }: { status: LlmRelayStatus | undefined; match: (caller: string) => boolean }) {
  if (!status?.callers) return null;
  const row = status.callers.find((item) => match(item.caller));
  if (!row) return <p className="muted">LLM qua máy chủ: hôm nay chưa có lời gọi.</p>;
  return (
    <p className="muted">
      LLM qua máy chủ hôm nay: {row.calls} lời gọi · {(row.inputTokens + row.outputTokens).toLocaleString("vi-VN")} token{row.tokensUnknown ? " (ước tính)" : ""} · {costLabel(row)}
      {row.refused > 0 ? ` · bị từ chối ${row.refused} lần` : ""}
      {row.lastRefusal ? ` (gần nhất: ${REFUSAL_LABEL[row.lastRefusal] ?? row.lastRefusal})` : ""}
    </p>
  );
}

type Draft = { caller: string; models: string; rpm: number; tpm: number; dailyUsdCap: number; enabled: boolean };
const toDraft = (grant: LlmRelayGrant, caller: string): Draft => ({ caller, models: grant.models.join(", "), rpm: grant.rpm, tpm: grant.tpm, dailyUsdCap: grant.dailyUsdCap, enabled: grant.enabled });

export function LlmRelaySection() {
  const queryClient = useQueryClient();
  const status = useRelayStatus();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status.data && draft === null) setDraft(toDraft(status.data.defaultGrant, "*"));
  }, [status.data, draft]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: relayStatusKey });
  const save = useMutation({
    mutationFn: (value: Draft) => saveRelayGrant(value.caller, {
      models: value.models.split(",").map((item) => item.trim()).filter(Boolean),
      rpm: value.rpm, tpm: value.tpm, dailyUsdCap: value.dailyUsdCap, enabled: value.enabled,
    }),
    onSuccess: () => { setMessage("Đã lưu giới hạn."); void refresh(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Không lưu được"),
  });
  const remove = useMutation({
    mutationFn: deleteRelayGrant,
    onSuccess: () => { setMessage("Đã xóa giới hạn riêng; máy này dùng mức mặc định."); setDraft(null); void refresh(); },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Không xóa được"),
  });

  if (status.isPending) return <section className="panel" aria-label="LLM qua máy chủ"><Spinner label="Đang tải relay LLM" /></section>;
  if (status.isError) return <section className="panel" aria-label="LLM qua máy chủ"><h2>LLM qua máy chủ</h2><p role="alert">{status.error.message}</p></section>;
  const data = status.data;

  function pick(caller: string) {
    const row = data.callers.find((item) => item.caller === caller);
    setDraft(toDraft(caller === "*" ? data.defaultGrant : row?.grant ?? data.defaultGrant, caller));
    setMessage("");
  }
  function submit(event: FormEvent) { event.preventDefault(); if (draft) save.mutate(draft); }

  return (
    <section id="relay-llm" className="ai-gateway panel" aria-label="LLM qua máy chủ">
      <header className="ai-gateway-head">
        <h2>LLM qua máy chủ</h2>
        <p className="field-hint">
          Mọi máy (Hermes, scout, máy worker) gọi LLM qua máy điều khiển này bằng khóa của chính nó; chỉ máy này giữ khóa OmniRoute.
          Đặt giới hạn tốc độ, ngân sách ngày và danh sách model cho từng máy tại đây.
        </p>
      </header>
      <div role="status">
        <strong>{!data.configured ? "Chưa đặt OMNIROUTE_API_KEY" : data.reachable ? "Relay sẵn sàng" : "Relay chưa dùng được"}</strong>
        <p className="field-hint">{data.modelCount} model{data.lastError ? ` · ${data.lastError}` : ""}{data.gatewayMode === "only" ? "" : " · Gateway chưa ở chế độ “Chỉ OmniRoute”."}</p>
      </div>
      <p id="relay-scroll-hint" className="field-hint relay-scroll-hint">Cuộn bảng ngang để xem đủ số liệu và nút thao tác.</p>
      <div className="relay-usage-scroll" role="region" aria-label="Thống kê LLM theo máy" aria-describedby="relay-scroll-hint" tabIndex={0}>
      <table className="data-table">
        <thead><tr><th>Máy</th><th>Lời gọi hôm nay</th><th>Token</th><th>Chi phí</th><th>Từ chối</th><th /></tr></thead>
        <tbody>
          {data.callers.length === 0 ? <tr><td colSpan={6}>Chưa có máy nào gọi LLM qua relay hôm nay.</td></tr> : data.callers.map((row: LlmRelayCallerUsage) => (
            <tr key={row.caller}>
              <td>{row.label}{row.grant && !row.grant.enabled ? " (đã tắt)" : ""}</td>
              <td>{row.calls}</td>
              <td>{(row.inputTokens + row.outputTokens).toLocaleString("vi-VN")}{row.tokensUnknown ? " (ước tính)" : ""}</td>
              <td>{costLabel(row)}</td>
              <td>{row.refused}{row.lastRefusal ? ` · ${REFUSAL_LABEL[row.lastRefusal] ?? row.lastRefusal}` : ""}</td>
              <td><button type="button" className="text-button" onClick={() => pick(row.caller)}>Sửa giới hạn</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {draft && (
        <form className="ai-gateway-form" onSubmit={submit}>
          <h3>Giới hạn: {relayCallerLabel(draft.caller)}</h3>
          <label className="form-field"><span>Áp dụng cho</span>
            <select aria-label="Máy áp dụng giới hạn" value={draft.caller} onChange={(event) => pick(event.target.value)}>
              <option value="*">Mặc định cho mọi máy</option>
              {data.callers.map((row) => <option key={row.caller} value={row.caller}>{row.label}</option>)}
            </select>
          </label>
          <label className="form-field"><span>Model được dùng (cách nhau dấu phẩy; trống = kế thừa mặc định workspace)</span>
            <input aria-label="Model được dùng" value={draft.models} list="relay-model-options" onChange={(event) => setDraft({ ...draft, models: event.target.value })} />
          </label>
          <datalist id="relay-model-options">{data.models.map((id) => <option key={id} value={id} />)}</datalist>
          <label className="form-field"><span>Lời gọi mỗi phút</span>
            <input aria-label="Lời gọi mỗi phút" type="number" min={1} value={draft.rpm} onChange={(event) => setDraft({ ...draft, rpm: Number(event.target.value) })} />
          </label>
          <label className="form-field"><span>Token mỗi phút</span>
            <input aria-label="Token mỗi phút" type="number" min={100} value={draft.tpm} onChange={(event) => setDraft({ ...draft, tpm: Number(event.target.value) })} />
          </label>
          <label className="form-field"><span>Ngân sách mỗi ngày (USD, 0 = không giới hạn)</span>
            <input aria-label="Ngân sách mỗi ngày" type="number" min={0} step="0.1" value={draft.dailyUsdCap} onChange={(event) => setDraft({ ...draft, dailyUsdCap: Number(event.target.value) })} />
          </label>
          <label className="checkbox-field"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> Cho phép dùng relay</label>
          <div className="button-row">
            <button className="button button-primary" type="submit" disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu giới hạn"}</button>
            {draft.caller !== "*" && <button type="button" className="button button-secondary" disabled={remove.isPending} onClick={() => remove.mutate(draft.caller)}>Dùng mức mặc định</button>}
          </div>
        </form>
      )}
      {message && <p role="status" className="success-message">{message}</p>}
    </section>
  );
}
