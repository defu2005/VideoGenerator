import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LITELLM_CAPABILITIES,
  resolveCapability,
  type LlmGatewayMapping,
  type LlmGatewayMode,
  type LlmGatewaySettings,
} from "@vg/shared";
import { Spinner } from "../../components/Spinner";
import {
  getLlmGatewaySettings,
  getOmnirouteCatalog,
  getOmnirouteHealth,
  refreshOmnirouteCatalog,
  saveLlmGatewaySettings,
} from "../../services/llmApi";

const MODE_LABELS: Record<LlmGatewayMode, string> = {
  off: "Tắt (mặc định)",
  prefer: "Ưu tiên OmniRoute (fallback khi lỗi kết nối/5xx)",
  only: "Chỉ OmniRoute (không fallback)",
};

function emptyMapping(): LlmGatewayMapping {
  return { provider: "", model: "", omnirouteModel: "" };
}

export function OmniRouteGatewaySection() {
  const queryClient = useQueryClient();
  const gateway = useQuery({ queryKey: ["llm-gateway"], queryFn: getLlmGatewaySettings });
  const health = useQuery({ queryKey: ["omniroute-health"], queryFn: getOmnirouteHealth });
  const catalog = useQuery({ queryKey: ["omniroute-catalog"], queryFn: getOmnirouteCatalog });
  const [draft, setDraft] = useState<LlmGatewaySettings>({ mode: "off", mappings: [] });
  const [message, setMessage] = useState("");
  const [probeNote, setProbeNote] = useState("");

  useEffect(() => {
    if (gateway.data) setDraft(gateway.data);
  }, [gateway.data]);

  const save = useMutation({
    mutationFn: saveLlmGatewaySettings,
    onSuccess: async (saved) => {
      setDraft(saved);
      setMessage("Đã lưu cài đặt gateway.");
      await queryClient.invalidateQueries({ queryKey: ["llm-gateway"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Không lưu được gateway");
    },
  });

  const refresh = useMutation({
    mutationFn: refreshOmnirouteCatalog,
    onSuccess: async () => {
      setMessage("Đã tải lại danh sách model.");
      await queryClient.invalidateQueries({ queryKey: ["omniroute-catalog"] });
      await queryClient.invalidateQueries({ queryKey: ["omniroute-health"] });
      await queryClient.invalidateQueries({ queryKey: ["llm-models", "omniroute"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Không tải được danh sách model");
      void queryClient.invalidateQueries({ queryKey: ["omniroute-health"] });
    },
  });

  if (gateway.isPending || health.isPending) {
    return <section className="ai-gateway panel" aria-label="Gateway OmniRoute"><Spinner label="Đang tải gateway OmniRoute" /></section>;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    save.mutate({
      mode: draft.mode,
      mappings: draft.mappings.filter((row) => row.provider && row.model && row.omnirouteModel),
    });
  }

  function updateMapping(index: number, patch: Partial<LlmGatewayMapping>) {
    setDraft((current) => ({
      ...current,
      mappings: current.mappings.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row),
    }));
  }

  const status = health.data;
  const reachable = status?.reachable === true;

  return (
    <section className="ai-gateway panel" aria-label="Gateway OmniRoute">
      <header className="ai-gateway-head">
        <h2>Gateway OmniRoute</h2>
        <p className="field-hint">
          Định tuyến các lệnh gọi LLM qua gateway cục bộ OpenAI-compatible. Khi OmniRoute chưa chạy, để chế độ Tắt.
        </p>
      </header>

      <div className="ai-gateway-status" role="status">
        <span
          className={`ai-gateway-dot ${reachable ? "ai-gateway-dot-up" : "ai-gateway-dot-down"}`}
          aria-hidden="true"
        />
        <div>
          <strong>{reachable ? "Đang chạy" : "Không kết nối được"}</strong>
          <p className="field-hint">
            Base URL: <code>{status?.baseUrl ?? "http://127.0.0.1:20128/v1"}</code>
            {status?.latencyMs != null ? ` · ${status.latencyMs} ms` : ""}
            {` · ${status?.modelCount ?? catalog.data?.models.length ?? 0} model`}
            {status?.lastError ? ` · ${status.lastError}` : ""}
          </p>
        </div>
      </div>

      {!reachable && (
        <ol className="ai-gateway-setup">
          <li>Cài và chạy OmniRoute (mặc định cổng 20128).</li>
          <li>Kết nối nhà cung cấp trong dashboard OmniRoute.</li>
          <li>Tạo endpoint key, rồi đặt <code>OMNIROUTE_API_KEY</code> trong <code>.env</code>.</li>
          <li>Nếu khác cổng mặc định, đặt thêm <code>OMNIROUTE_BASE_URL</code>.</li>
        </ol>
      )}

      <form className="ai-gateway-form" onSubmit={onSubmit}>
        <label className="form-field">
          <span>Chế độ gateway</span>
          <select
            aria-label="Chế độ gateway OmniRoute"
            value={draft.mode}
            onChange={(event) => setDraft((current) => ({
              ...current,
              mode: event.target.value as LlmGatewayMode,
            }))}
          >
            {(Object.keys(MODE_LABELS) as LlmGatewayMode[]).map((mode) => (
              <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>
            ))}
          </select>
        </label>

        <div className="ai-gateway-mappings">
          <div className="ai-gateway-mappings-head">
            <h3>Bảng mapping provider:model → OmniRoute</h3>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setDraft((current) => ({
                ...current,
                mappings: [...current.mappings, emptyMapping()],
              }))}
            >
              Thêm dòng
            </button>
          </div>
          {draft.mappings.length === 0 && (
            <p className="field-hint">Trống: khớp theo đúng id model nếu OmniRoute cũng liệt kê model đó. CLI chỉ thay khi có mapping.</p>
          )}
          {draft.mappings.map((row, index) => (
            <div className="ai-gateway-mapping-row form-grid" key={`mapping-${index}`}>
              <label className="form-field"><span>Provider</span>
                <input
                  aria-label={`Mapping ${index + 1} provider`}
                  value={row.provider}
                  onChange={(event) => updateMapping(index, { provider: event.target.value })}
                  placeholder="anthropic"
                />
              </label>
              <label className="form-field"><span>Model</span>
                <input
                  aria-label={`Mapping ${index + 1} model`}
                  value={row.model}
                  onChange={(event) => updateMapping(index, { model: event.target.value })}
                  placeholder="claude-sonnet-5-5"
                />
              </label>
              <label className="form-field"><span>Model OmniRoute</span>
                <input
                  aria-label={`Mapping ${index + 1} omniroute model`}
                  value={row.omnirouteModel}
                  onChange={(event) => updateMapping(index, { omnirouteModel: event.target.value })}
                  placeholder="cc/claude-sonnet"
                  list="omniroute-model-options"
                />
              </label>
              <button
                type="button"
                className="text-button"
                aria-label={`Xóa mapping ${index + 1}`}
                onClick={() => setDraft((current) => ({
                  ...current,
                  mappings: current.mappings.filter((_, rowIndex) => rowIndex !== index),
                }))}
              >
                Xóa
              </button>
            </div>
          ))}
          <ul aria-label="Nguồn khả năng model">
            {(catalog.data?.models ?? []).slice(0, 12).map((model) => {
              const capability = resolveCapability({
                modelId: model.id,
                omniroute: model.vision === undefined ? undefined : { vision: model.vision },
                litellm: LITELLM_CAPABILITIES[model.id.split("/").pop() ?? model.id],
              });
              const source = capability.source === "omniroute" ? "từ OmniRoute"
                : capability.source === "litellm" ? "từ bảng LiteLLM"
                  : capability.source === "probe" ? "đã thử"
                    : capability.source === "override" ? "tự đặt"
                      : "theo tên";
              return <li key={model.id}>{model.id} · {source}{capability.vision ? " · nhìn ảnh" : ""}</li>;
            })}
          </ul>
          <datalist id="omniroute-model-options">
            {(catalog.data?.models ?? []).map((model) => (
              <option key={model.id} value={model.id}>{model.ownedBy}</option>
            ))}
          </datalist>
        </div>

        <div className="button-row">
          <button
            className="button"
            type="button"
            onClick={() => {
              const modelId = draft.mappings[0]?.omnirouteModel || catalog.data?.models[0]?.id;
              if (!modelId) {
                setProbeNote("Chưa có model để kiểm tra.");
                return;
              }
              void fetch("/api/llm/capabilities/probe", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ modelId }),
              }).then(async (response) => {
                if (!response.ok) {
                  setProbeNote("Không kiểm tra được. Thử lại khi OmniRoute đang chạy.");
                  return;
                }
                const body = await response.json() as { vision?: boolean };
                setProbeNote(body.vision ? `${modelId}: đã thử, nhìn được ảnh.` : `${modelId}: đã thử, không nhìn được ảnh.`);
              }).catch(() => setProbeNote("Không kiểm tra được."));
            }}
          >
            Kiểm tra khả năng
          </button>
          <button className="button button-primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "Đang lưu…" : "Lưu gateway"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={refresh.isPending}
            onClick={() => {
              setMessage("");
              refresh.mutate();
            }}
          >
            {refresh.isPending ? "Đang tải…" : "Tải lại danh sách model"}
          </button>
        </div>
        {message && <p role="status" className="success-message">{message}</p>}
        {probeNote ? <p>{probeNote}</p> : null}
      </form>
    </section>
  );
}
