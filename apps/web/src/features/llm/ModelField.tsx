import { useQuery } from "@tanstack/react-query";
import { getProviderModels } from "../../services/llmApi";

export function ModelField({ provider, value, onChange, label }: {
  provider?: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const models = useQuery({
    queryKey: ["llm-models", provider],
    queryFn: () => getProviderModels(provider!),
    enabled: Boolean(provider),
  });
  const list = models.data ?? [];
  const inList = list.includes(value);
  const emptyLabel = models.isLoading ? "Đang tải danh sách model…"
    : value && !inList ? "Model tự gõ (ô bên dưới)"
      : `Mặc định của nhà cung cấp${list.length ? ` · ${list.length} model` : ""}`;

  return (
    <span className="model-field">
      <select
        aria-label={`${label}: chọn từ danh sách`}
        value={inList ? value : ""}
        disabled={!provider}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {list.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
      <input
        aria-label={label}
        value={value}
        placeholder="hoặc gõ tên model khác"
        onChange={(event) => onChange(event.target.value)}
      />
      {models.isError && <small className="field-hint">Không tải được danh sách — hãy gõ tên model gói của bạn hỗ trợ.</small>}
    </span>
  );
}
