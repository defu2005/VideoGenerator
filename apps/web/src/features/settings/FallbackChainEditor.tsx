import { fallbackChainOf, type LlmFallback, type LlmQuotaStatus, type LlmRoute } from "@vg/shared";
import { ModelField } from "../llm/ModelField";
import type { getLlmProviders } from "../../services/llmApi";
import { quotaStatusLabel } from "./QuotaPanel";

type Providers = Awaited<ReturnType<typeof getLlmProviders>>;

function statusFor(quota: LlmQuotaStatus | undefined, provider: string, model: string) {
  const cooldown = quota?.cooldowns.find((item) => item.provider === provider && item.model === model);
  if (cooldown && Date.parse(cooldown.until) > Date.now()) {
    return { status: "cooldown" as const, until: cooldown.until };
  }
  const row = quota?.rows.find((item) => item.provider === provider && item.model === model)
    ?? quota?.rows.find((item) => item.provider === provider && item.model === "*:free" && model.endsWith(":free"))
    ?? quota?.rows.find((item) => item.provider === provider && item.model === "*");
  if (!row || !row.enabled) return { status: "ok" as const, until: null };
  return { status: row.status, until: row.cooldownUntil ?? row.nextReset };
}

export function FallbackChainEditor({
  route,
  providers,
  quota,
  onChange,
}: {
  route?: LlmRoute;
  providers: Providers;
  quota?: LlmQuotaStatus;
  onChange: (chain: LlmFallback[]) => void;
}) {
  const chain = fallbackChainOf(route);
  function update(next: LlmFallback[]) {
    onChange(next.slice(0, 4));
  }
  return (
    <div className="ai-fallback-chain">
      <span>Chuỗi dự phòng</span>
      {chain.length === 0 && <p className="field-hint">Chưa có model dự phòng.</p>}
      <ol>
        {chain.map((entry, index) => {
          const model = entry.model ?? "";
          const chip = statusFor(quota, entry.provider, model);
          return (
            <li key={`${entry.provider}-${model}-${index}`}>
              <select
                aria-label={`Dự phòng ${index + 1} — nhà cung cấp`}
                value={entry.provider}
                onChange={(event) => {
                  const next = [...chain];
                  next[index] = { provider: event.target.value, model: undefined };
                  update(next);
                }}
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              <ModelField
                provider={entry.provider}
                value={model}
                label={`Dự phòng ${index + 1} — model`}
                onChange={(value) => {
                  const next = [...chain];
                  next[index] = { ...entry, model: value || undefined };
                  update(next);
                }}
              />
              <span className="ai-chip">{quotaStatusLabel(chip.status, chip.until)}</span>
              <button type="button" className="text-button" aria-label={`Đưa ${entry.provider}/${model || "model"} lên`} disabled={index === 0} onClick={() => {
                const next = [...chain];
                const [item] = next.splice(index, 1);
                if (item) next.splice(index - 1, 0, item);
                update(next);
              }}>Lên</button>
              <button type="button" className="text-button" aria-label={`Đưa ${entry.provider}/${model || "model"} xuống`} disabled={index === chain.length - 1} onClick={() => {
                const next = [...chain];
                const [item] = next.splice(index, 1);
                if (item) next.splice(index + 1, 0, item);
                update(next);
              }}>Xuống</button>
              <button type="button" className="text-button" aria-label={`Xoá dự phòng ${index + 1}`} onClick={() => update(chain.filter((_, item) => item !== index))}>Xoá</button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="button button-secondary"
        disabled={!route || chain.length >= 4}
        onClick={() => {
          const provider = providers.find((item) => item.configured)?.id ?? providers[0]?.id;
          if (!provider) return;
          update([...chain, { provider }]);
        }}
      >Thêm dự phòng</button>
    </div>
  );
}

export function routeWithChain(route: LlmRoute, chain: LlmFallback[]): LlmRoute {
  const next: LlmRoute = { ...route };
  if (chain.length === 0) {
    delete next.fallback;
    delete next.fallbacks;
    return next;
  }
  next.fallbacks = chain;
  next.fallback = chain[0];
  return next;
}
