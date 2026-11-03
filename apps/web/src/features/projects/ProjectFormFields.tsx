import { AUTONOMY_MODES, LLM_TASKS, type AutonomyMode, type LlmRoute, type ProjectSettings, type ProjectSettingsInput } from "@vg/shared";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ModelField } from "../llm/ModelField";
import { getLlmProviders, getProjectLlmRoutes, getProviderModels } from "../../services/llmApi";

export type ProjectDraft = {
  title: string;
  topic: string;
  description: string;
  mode: AutonomyMode;
  language: string;
  targetDurationSec: string;
  researchMode: "" | "merged" | "separate" | "off";
  aspectRatio: "16:9" | "9:16" | "1:1";
  visualsExecutor: "" | "AGENT" | "USER";
  voiceExecutor: "" | "AGENT" | "USER";
  musicExecutor: "" | "AGENT" | "USER";
  scriptExecutor: "" | "AGENT" | "USER";
  llmProvider: string;
  llmModel: string;
  autoRender: boolean;
};

export const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  title: "",
  topic: "",
  description: "",
  mode: "ASSISTED",
  language: "vi",
  targetDurationSec: "120",
  researchMode: "",
  aspectRatio: "16:9",
  visualsExecutor: "",
  voiceExecutor: "",
  musicExecutor: "",
  scriptExecutor: "",
  llmProvider: "",
  llmModel: "",
  autoRender: false,
};

export function settingsFromDraft(draft: ProjectDraft): ProjectSettingsInput {
  const stageExecutors: ProjectSettingsInput["stageExecutors"] = {};
  if (draft.scriptExecutor) stageExecutors.script = draft.scriptExecutor;
  if (draft.visualsExecutor) stageExecutors.visuals = draft.visualsExecutor;
  if (draft.voiceExecutor) stageExecutors.voice = draft.voiceExecutor;
  if (draft.musicExecutor) stageExecutors.music = draft.musicExecutor;
  return {
    language: draft.language,
    targetDurationSec: Number(draft.targetDurationSec),
    ...(draft.researchMode ? { researchMode: draft.researchMode } : {}),
    aspectRatio: draft.aspectRatio,
    stageExecutors,
    ...(draft.llmProvider ? {
      llm: {
        default: {
          provider: draft.llmProvider,
          ...(draft.llmModel.trim() ? { model: draft.llmModel.trim() } : {}),
        },
      },
    } : {}),
    autoRender: draft.autoRender,
  };
}

export function ProjectFormFields({
  draft,
  errors,
  onChange,
  advanced,
  onToggleAdvanced,
  advancedOnly = false,
  projectId,
  llmTasks,
  onLlmTasksChange,
}: {
  draft: ProjectDraft;
  errors: Record<string, string>;
  onChange: (field: keyof ProjectDraft, value: string | boolean) => void;
  advanced: boolean;
  onToggleAdvanced: () => void;
  advancedOnly?: boolean;
  projectId?: string;
  llmTasks?: NonNullable<ProjectSettings["llm"]>["tasks"];
  onLlmTasksChange?: (tasks: NonNullable<ProjectSettings["llm"]>["tasks"]) => void;
}) {
  const providers = useQuery({ queryKey: ["llm-providers"], queryFn: getLlmProviders });
  const providerModels = useQuery({
    queryKey: ["llm-models", draft.llmProvider],
    queryFn: () => getProviderModels(draft.llmProvider),
    enabled: Boolean(draft.llmProvider),
  });
  const resolvedRoutes = useQuery({
    queryKey: ["project-llm-routes", projectId],
    queryFn: () => getProjectLlmRoutes(projectId!),
    enabled: Boolean(projectId),
  });
  // Set when the user picks another provider; the model is checked once that provider's list loads.
  // A custom model name typed for the current provider is never cleared.
  const providerSwitchedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!draft.llmProvider || providerSwitchedTo.current !== draft.llmProvider || !providerModels.isSuccess) return;
    providerSwitchedTo.current = null;
    if (draft.llmModel && !providerModels.data.includes(draft.llmModel)) onChange("llmModel", "");
  }, [draft.llmModel, draft.llmProvider, onChange, providerModels.data, providerModels.isSuccess]);
  const availableProviders = providers.data ?? [];
  const selectedProvider = availableProviders.find((provider) => provider.id === draft.llmProvider);
  return (
    <>
      {!advancedOnly && (
        <>
      <label className="form-field">
        <span>Title <b aria-hidden="true">*</b></span>
        <input
          autoFocus
          value={draft.title}
          maxLength={200}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? "project-title-error" : undefined}
          onChange={(event) => onChange("title", event.target.value)}
        />
        {errors.title && <small className="field-error" id="project-title-error">{errors.title}</small>}
      </label>
      <label className="form-field">
        <span>Topic <b aria-hidden="true">*</b></span>
        <textarea
          value={draft.topic}
          rows={3}
          maxLength={2000}
          aria-invalid={Boolean(errors.topic)}
          aria-describedby={errors.topic ? "project-topic-error" : undefined}
          onChange={(event) => onChange("topic", event.target.value)}
        />
        {errors.topic && <small className="field-error" id="project-topic-error">{errors.topic}</small>}
      </label>
      <label className="form-field">
        <span>Description</span>
        <textarea
          value={draft.description}
          rows={2}
          maxLength={2000}
          aria-invalid={Boolean(errors.description)}
          onChange={(event) => onChange("description", event.target.value)}
        />
        {errors.description && <small className="field-error">{errors.description}</small>}
      </label>
      <label className="form-field">
        <span>Mode</span>
        <select value={draft.mode} onChange={(event) => onChange("mode", event.target.value)}>
          {AUTONOMY_MODES.map((mode) => (
            <option key={mode} value={mode}>{mode}</option>
          ))}
        </select>
        <small className="field-hint">
          {draft.mode === "AUTO" && "Agent runs the pipeline and selects the best candidates automatically."}
          {draft.mode === "ASSISTED" && "Agent generates content and pauses at review gates."}
          {draft.mode === "MANUAL" && "Run each pipeline stage manually when you are ready."}
        </small>
      </label>
        </>
      )}
      <button className="text-button advanced-toggle" type="button" aria-expanded={advanced} onClick={onToggleAdvanced}>
        {advanced ? "− Hide advanced settings" : "+ Advanced settings"}
      </button>
      {advanced && (
        <div className="advanced-settings">
          <p>Choose who handles each pipeline stage. Leave blank to use the mode default.</p>
          {(["visualsExecutor", "voiceExecutor", "musicExecutor"] as const).map((field) => (
            <label className="form-field" key={field}>
              <span>{field.replace("Executor", "")[0].toUpperCase()}{field.replace("Executor", "").slice(1)} executor</span>
              <select value={draft[field]} onChange={(event) => onChange(field, event.target.value)}>
                <option value="">Mode default</option>
                <option value="AGENT">Agent</option>
                <option value="USER">User</option>
              </select>
              {errors[`settings.stageExecutors.${field.replace("Executor", "")}`] && (
                <small className="field-error">{errors[`settings.stageExecutors.${field.replace("Executor", "")}`]}</small>
              )}
            </label>
          ))}
          <label className="form-field">
            <span>Script executor</span>
            <select value={draft.scriptExecutor} onChange={(event) => onChange("scriptExecutor", event.target.value)}>
              <option value="">Mode default</option>
              <option value="AGENT">Agent</option>
              <option value="USER">User</option>
            </select>
          </label>
          <label className="form-field">
            <span>Research and script calls</span>
            <select value={draft.researchMode} onChange={(event) => onChange("researchMode", event.target.value)}>
              <option value="">Environment default</option>
              <option value="merged">Merged (one call)</option>
              <option value="separate">Separate (two calls)</option>
              <option value="off">Research off</option>
            </select>
          </label>
          <label className="form-field">
            <span>AI provider</span>
            <select
              value={draft.llmProvider}
              onChange={(event) => {
                const nextProvider = event.target.value;
                providerSwitchedTo.current = nextProvider || null;
                onChange("llmProvider", nextProvider);
                if (!nextProvider) onChange("llmModel", "");
              }}
            >
              <option value="">Environment default</option>
              {draft.llmProvider && !availableProviders.some((provider) => provider.id === draft.llmProvider) && (
                <option value={draft.llmProvider}>{draft.llmProvider} (not currently configured)</option>
              )}
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}{provider.configured ? "" : " — chưa cấu hình"}
                </option>
              ))}
            </select>
            {selectedProvider?.hint && !selectedProvider.configured && (
              <small className="field-hint">{selectedProvider.hint}</small>
            )}
            {selectedProvider?.id === "copilot-cli" && (
              <small className="field-hint">
                Uses your Copilot plan quota (shared with coding) · {selectedProvider.usage?.monthCalls ?? 0} calls this month
              </small>
            )}
            {selectedProvider && selectedProvider.id !== "copilot-cli" && selectedProvider.usage && (
              <small className="field-hint">{selectedProvider.usage.monthCalls} calls this month</small>
            )}
            {selectedProvider?.limits && (
              <small className="field-hint">
                Provider limits:{" "}
                {selectedProvider.limits.maxInputTokens
                  ? `${selectedProvider.limits.maxInputTokens.toLocaleString()} input tokens`
                  : ""}
                {selectedProvider.limits.maxInputTokens && selectedProvider.limits.maxOutputTokens ? " · " : ""}
                {selectedProvider.limits.maxOutputTokens
                  ? `${selectedProvider.limits.maxOutputTokens.toLocaleString()} output tokens`
                  : ""}
                {" per request"}
              </small>
            )}
            {!providers.isPending && !providers.isError && availableProviders.length === 0 && (
              <small className="field-hint">No provider is configured. Set an LLM API key or base URL in the server environment.</small>
            )}
            {providers.isError && <small className="field-error">Unable to load configured LLM providers.</small>}
          </label>
          <label className="form-field">
            <span>Model (optional)</span>
            <ModelField
              provider={draft.llmProvider}
              value={draft.llmModel}
              label="Model"
              onChange={(value) => onChange("llmModel", value)}
            />
            {!draft.llmProvider && <small className="field-hint">Chọn nhà cung cấp trước để xem danh sách model</small>}
          </label>
          {onLlmTasksChange && (
            <details className="project-task-routes">
              <summary>Mô hình AI theo tác vụ</summary>
              <p className="field-hint">Tác vụ để trống sẽ dùng mặc định của dự án, rồi tới cài đặt app (Cài đặt → Mô hình AI), rồi tới ENV.</p>
              {LLM_TASKS.map((task) => {
                const route = llmTasks?.[task.id];
                const resolved = projectId ? resolvedRoutes.data?.[task.id] : undefined;
                const sourceLabel = projectId && resolved?.source?.startsWith("project-") ? "Dự án"
                  : projectId && resolved?.source?.startsWith("app-") ? "Mặc định app"
                    : projectId && resolved?.source?.startsWith("env") ? "ENV" : projectId ? "chưa cấu hình" : "";
                const replaceRoute = (update: Partial<LlmRoute>) => {
                  const routes = { ...(llmTasks ?? {}) };
                  const provider = update.provider ?? route?.provider;
                  if (!provider) delete routes[task.id];
                  else routes[task.id] = { ...route, ...update, provider };
                  onLlmTasksChange(routes);
                };
                return (
                  <div className="project-task-route" key={task.id}>
                    <div className="project-task-route-heading">
                      <strong>{task.label}</strong>
                      {projectId && (<small>
                        {task.stage} · {sourceLabel}
                        {resolved?.provider ? ` · ${resolved.provider}${resolved.model ? ` / ${resolved.model}` : ""}` : ""}
                      </small>)}
                    </div>
                    <select
                      aria-label={`${task.label} — nhà cung cấp của dự án`}
                      value={route?.provider ?? ""}
                      onChange={(event) => {
                        if (!event.target.value) {
                          const routes = { ...(llmTasks ?? {}) };
                          delete routes[task.id];
                          onLlmTasksChange(routes);
                        } else replaceRoute({ provider: event.target.value });
                      }}
                    >
                      <option value="">Dùng mặc định</option>
                      {(providers.data ?? []).map((provider) => (
                        <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                          {provider.label}{provider.configured ? "" : " — chưa cấu hình"}
                        </option>
                      ))}
                    </select>
                    <ModelField
                      provider={route?.provider}
                      value={route?.model ?? ""}
                      label={`${task.label} — model của dự án`}
                      onChange={(model) => replaceRoute({ model: model || undefined })}
                    />
                    <button className="text-button" type="button" onClick={() => {
                      const routes = { ...(llmTasks ?? {}) };
                      delete routes[task.id];
                      onLlmTasksChange(routes);
                    }}>Dùng mặc định</button>
                  </div>
                );
              })}
            </details>
          )}
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.autoRender} onChange={(event) => onChange("autoRender", event.target.checked)} />
            Automatically render after final approval
          </label>
        </div>
      )}
    </>
  );
}
