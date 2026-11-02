import { AUTONOMY_MODES, type AutonomyMode, type ProjectSettingsInput } from "@vg/shared";
import { useQuery } from "@tanstack/react-query";
import { getLlmProviders } from "../../services/llmApi";

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
}: {
  draft: ProjectDraft;
  errors: Record<string, string>;
  onChange: (field: keyof ProjectDraft, value: string | boolean) => void;
  advanced: boolean;
  onToggleAdvanced: () => void;
}) {
  const providers = useQuery({ queryKey: ["llm-providers"], queryFn: getLlmProviders });
  const availableProviders = providers.data ?? [];
  const selectedProvider = availableProviders.find((provider) => provider.id === draft.llmProvider);
  return (
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
      <div className="form-grid">
        <label className="form-field">
          <span>Language</span>
          <input value={draft.language} maxLength={20} onChange={(event) => onChange("language", event.target.value)} />
        </label>
        <label className="form-field">
          <span>Target duration (seconds)</span>
          <input
            type="number"
            min={30}
            max={1800}
            value={draft.targetDurationSec}
            aria-invalid={Boolean(errors["settings.targetDurationSec"])}
            onChange={(event) => onChange("targetDurationSec", event.target.value)}
          />
          {errors["settings.targetDurationSec"] && <small className="field-error">{errors["settings.targetDurationSec"]}</small>}
        </label>
        <label className="form-field">
          <span>Aspect ratio</span>
          <select value={draft.aspectRatio} onChange={(event) => onChange("aspectRatio", event.target.value)}>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
          </select>
        </label>
      </div>
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
            <select value={draft.llmProvider} onChange={(event) => onChange("llmProvider", event.target.value)}>
              <option value="">Environment default</option>
              {draft.llmProvider && !availableProviders.some((provider) => provider.id === draft.llmProvider) && (
                <option value={draft.llmProvider}>{draft.llmProvider} (not currently configured)</option>
              )}
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}{provider.configured ? "" : ` (${provider.hint ?? "not configured"})`}
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
            <input
              value={draft.llmModel}
              placeholder="Use provider default"
              onChange={(event) => onChange("llmModel", event.target.value)}
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.autoRender} onChange={(event) => onChange("autoRender", event.target.checked)} />
            Automatically render after final approval
          </label>
        </div>
      )}
    </>
  );
}
