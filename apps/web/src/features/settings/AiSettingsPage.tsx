import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { ModelField } from "../llm/ModelField";
import {
  getAppLlmRouting,
  getLlmProviders,
  getLlmQuotaStatus,
  getLlmTasks,
  saveAppLlmRouting,
  type LlmTask,
} from "../../services/llmApi";
import type { LlmQuotaStatus, LlmRoute, LlmSettings } from "@vg/shared";
import { OmniRouteGatewaySection } from "./OmniRouteGatewaySection";
import { ModelAdvisorPanel } from "./ModelAdvisorPanel";
import { FallbackChainEditor, routeWithChain } from "./FallbackChainEditor";
import { QuotaPanel } from "./QuotaPanel";

type RouteUpdate = Partial<LlmRoute>;
type SettingsTab = "routes" | "quota";

const DEFAULT_STRONG_MODEL = "claude-sonnet-4-6";
const DEFAULT_FAST_MODEL = "gemini-3.8-flash-low";

function routeWithDefaults(route: LlmRoute | undefined, patch: RouteUpdate): LlmRoute | undefined {
  const provider = patch.provider ?? route?.provider;
  if (!provider) return undefined;
  return {
    ...route,
    ...patch,
    provider,
  };
}

function ProviderField({
  providers,
  value,
  label,
  onChange,
}: {
  providers: Awaited<ReturnType<typeof getLlmProviders>>;
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const currentUnavailable = value && !providers.some((provider) => provider.id === value);
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Dùng mặc định</option>
      {currentUnavailable && <option value={value}>{value} (không khả dụng)</option>}
      {providers.map((provider) => (
        <option key={provider.id} value={provider.id} disabled={!provider.configured}>
          {provider.label}{provider.configured ? "" : ` — chưa cấu hình`}
        </option>
      ))}
    </select>
  );
}

function TaskRoutingRow({
  task,
  providers,
  route,
  quota,
  onChange,
  onReset,
}: {
  task: LlmTask;
  providers: Awaited<ReturnType<typeof getLlmProviders>>;
  route?: LlmRoute;
  quota?: LlmQuotaStatus;
  onChange: (patch: RouteUpdate) => void;
  onReset: () => void;
}) {
  return (
    <article className="ai-task-card" data-testid={`ai-task-${task.id}`}>
      <header className="ai-task-head">
        <h3>{task.label}</h3>
        <span className="ai-chip">{task.stage}</span>
        <span className={`ai-chip ai-chip-${task.tier}`}>{task.tier === "strong" ? "nên dùng model mạnh" : "model nhanh là đủ"}</span>
        {route
          ? <button className="text-button ai-reset" type="button" onClick={onReset}>Dùng mặc định</button>
          : <span className="ai-inherited">đang dùng mặc định</span>}
      </header>
      <div className="ai-task-fields">
        <label className="form-field"><span>Nhà cung cấp</span>
          <ProviderField providers={providers} value={route?.provider ?? ""} label={`${task.label} — nhà cung cấp`}
            onChange={(provider) => provider ? onChange({ provider }) : onReset()} />
        </label>
        <label className="form-field"><span>Model</span>
          <ModelField provider={route?.provider} value={route?.model ?? ""} label={`${task.label} — model`}
            onChange={(model) => onChange({ model: model || undefined })} />
        </label>
        <label className="form-field"><span>Giới hạn output (token)</span>
          <input
            aria-label={`${task.label} — giới hạn output`}
            type="number"
            min={256}
            max={32_000}
            value={route?.maxOutputTokens ?? ""}
            placeholder="Mặc định"
            disabled={!route}
            onChange={(event) => onChange({ maxOutputTokens: event.target.value ? Number(event.target.value) : undefined })}
          />
        </label>
      </div>
      <FallbackChainEditor
        route={route}
        providers={providers}
        quota={quota}
        onChange={(chain) => {
          if (!route) return;
          const next = routeWithChain(route, chain);
          onChange({
            fallback: next.fallback,
            fallbacks: next.fallbacks,
          });
        }}
      />
    </article>
  );
}

export function AiSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["llm-routing"], queryFn: getAppLlmRouting });
  const providers = useQuery({ queryKey: ["llm-providers"], queryFn: getLlmProviders });
  const tasks = useQuery({ queryKey: ["llm-tasks"], queryFn: getLlmTasks });
  const [tab, setTab] = useState<SettingsTab>("routes");
  const quota = useQuery({ queryKey: ["llm-quota"], queryFn: getLlmQuotaStatus });
  const [draft, setDraft] = useState<LlmSettings>({});
  const [strongProvider, setStrongProvider] = useState("");
  const [strongModel, setStrongModel] = useState("");
  const [fastProvider, setFastProvider] = useState("");
  const [fastModel, setFastModel] = useState("");
  const mutation = useMutation({
    mutationFn: saveAppLlmRouting,
    onSuccess: async (saved) => {
      setDraft(saved);
      await queryClient.invalidateQueries({ queryKey: ["llm-routing"] });
      await queryClient.invalidateQueries({ queryKey: ["project-llm-routes"] });
    },
  });

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  // Picking Antigravity in a preset suggests its usual model; it never switches the provider.
  useEffect(() => {
    if (strongProvider === "antigravity-cli" && !strongModel) setStrongModel(DEFAULT_STRONG_MODEL);
  }, [strongProvider, strongModel]);
  useEffect(() => {
    if (fastProvider === "antigravity-cli" && !fastModel) setFastModel(DEFAULT_FAST_MODEL);
  }, [fastProvider, fastModel]);

  if (settings.isPending || providers.isPending || tasks.isPending) {
    return <section className="panel"><Spinner label="Đang tải cài đặt AI" /></section>;
  }
  if (settings.isError || providers.isError || tasks.isError) {
    const error = settings.error ?? providers.error ?? tasks.error;
    return <section className="panel"><ErrorState
      message={error instanceof Error ? error.message : "Không tải được cài đặt AI"}
      onRetry={() => void (settings.isError ? settings.refetch() : providers.isError ? providers.refetch() : tasks.refetch())}
    /></section>;
  }

  const allTasks = tasks.data;
  const allProviders = providers.data;
  function updateTask(taskId: LlmTask["id"], patch: RouteUpdate) {
    setDraft((current) => {
      const currentRoute = current.tasks?.[taskId];
      const route = routeWithDefaults(currentRoute, patch);
      const routes = { ...current.tasks };
      if (route) routes[taskId] = route;
      else delete routes[taskId];
      return { ...current, tasks: routes };
    });
  }

  function resetTask(taskId: LlmTask["id"]) {
    setDraft((current) => {
      const routes = { ...current.tasks };
      delete routes[taskId];
      return { ...current, tasks: routes };
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(draft);
  }

  function fillAll() {
    if (!strongProvider) return;
    setDraft((current) => ({
      ...current,
      default: { provider: strongProvider, ...(strongModel ? { model: strongModel } : {}) },
    }));
  }

  function fillStrongFast() {
    if (!strongProvider || !fastProvider) return;
    setDraft((current) => ({
      ...current,
      tasks: Object.fromEntries(allTasks.map((task) => [
        task.id,
        {
          provider: task.tier === "strong" ? strongProvider : fastProvider,
          ...((task.tier === "strong" ? strongModel : fastModel)
            ? { model: task.tier === "strong" ? strongModel : fastModel }
            : {}),
        },
      ])),
    }));
  }

  return (
    <section className="page-section ai-settings-page">
      <header className="page-heading">
        <div><p className="eyebrow">CÀI ĐẶT</p><h1>Mô hình AI</h1><p>Chọn nhà cung cấp và model cho từng tác vụ AI. Áp dụng cho mọi dự án; từng dự án có thể ghi đè trong phần sửa dự án.</p></div>
      </header>
      <div className="button-row" role="tablist" aria-label="Mục cài đặt AI">
        <button type="button" className={tab === "routes" ? "button button-primary" : "button button-secondary"} onClick={() => setTab("routes")}>Định tuyến</button>
        <button type="button" className={tab === "quota" ? "button button-primary" : "button button-secondary"} onClick={() => setTab("quota")}>Quota</button>
      </div>
      {tab === "quota" ? <QuotaPanel /> : null}
      {mutation.isError && <p className="request-error" role="alert">{mutation.error instanceof Error ? mutation.error.message : "Không lưu được cài đặt AI"}</p>}
      {mutation.isSuccess && <p className="success-message" role="status">Đã lưu cài đặt mô hình AI.</p>}
      {tab === "routes" && <>
      <OmniRouteGatewaySection />
      <ModelAdvisorPanel scope="app" />
      <form className="panel ai-routing-form" onSubmit={submit}>
        <section className="ai-presets" aria-label="Mẫu cấu hình nhanh">
          <h2>Mẫu cấu hình nhanh</h2>
          <div className="form-grid">
            <label className="form-field"><span>Nhà cung cấp model mạnh</span>
              <ProviderField providers={allProviders} value={strongProvider} label="Nhà cung cấp model mạnh" onChange={setStrongProvider} />
            </label>
            <label className="form-field"><span>Model mạnh</span>
              <ModelField provider={strongProvider} value={strongModel} label="Model mạnh" onChange={setStrongModel} />
            </label>
            <label className="form-field"><span>Nhà cung cấp model nhanh</span>
              <ProviderField providers={allProviders} value={fastProvider} label="Nhà cung cấp model nhanh" onChange={setFastProvider} />
            </label>
            <label className="form-field"><span>Model nhanh</span>
              <ModelField provider={fastProvider} value={fastModel} label="Model nhanh" onChange={setFastModel} />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="button button-secondary" onClick={fillAll} disabled={!strongProvider}>Một model cho tất cả</button>
            <button type="button" className="button button-secondary" onClick={fillStrongFast} disabled={!strongProvider || !fastProvider}>Mạnh cho viết, nhanh cho việc phụ</button>
          </div>
        </section>
        <section className="ai-default-route" aria-label="Mặc định của app">
          <h2>Mặc định của app</h2>
          <p className="field-hint">Dùng cho mọi tác vụ chưa chọn riêng bên dưới.</p>
          <div className="form-grid">
          <label className="form-field"><span>Nhà cung cấp</span>
          <ProviderField providers={allProviders} value={draft.default?.provider ?? ""} label="Nhà cung cấp mặc định"
            onChange={(provider) => setDraft((current) => ({
              ...current,
              default: provider ? { ...current.default, provider } : undefined,
            }))} />
          </label>
          {draft.default?.provider && (
            <label className="form-field"><span>Model</span>
            <ModelField provider={draft.default.provider} value={draft.default.model ?? ""} label="Model mặc định"
              onChange={(model) => setDraft((current) => ({
                ...current,
                default: current.default ? { ...current.default, model: model || undefined } : undefined,
              }))} />
            </label>
          )}
          </div>
        </section>
        <section className="ai-task-list" aria-label="Mô hình theo tác vụ">
          <h2>Theo từng tác vụ</h2>
          {allTasks.map((task) => (
            <TaskRoutingRow
              key={task.id}
              task={task}
              providers={allProviders}
              route={draft.tasks?.[task.id]}
              quota={quota.data}
              onChange={(patch) => updateTask(task.id, patch)}
              onReset={() => resetTask(task.id)}
            />
          ))}
        </section>
        <div className="dialog-actions">
          <button className="button button-primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Đang lưu…" : "Lưu cài đặt"}
          </button>
        </div>
      </form>
      </>}
    </section>
  );
}
