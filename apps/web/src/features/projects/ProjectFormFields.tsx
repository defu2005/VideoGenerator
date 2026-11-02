import { AUTONOMY_MODES, type AutonomyMode, type ProjectSettingsInput } from "@vg/shared";

export type ProjectDraft = {
  title: string;
  topic: string;
  description: string;
  mode: AutonomyMode;
  language: string;
  targetDurationSec: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  visualsExecutor: "" | "AGENT" | "USER";
  voiceExecutor: "" | "AGENT" | "USER";
  musicExecutor: "" | "AGENT" | "USER";
  autoRender: boolean;
};

export const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  title: "",
  topic: "",
  description: "",
  mode: "ASSISTED",
  language: "vi",
  targetDurationSec: "120",
  aspectRatio: "16:9",
  visualsExecutor: "",
  voiceExecutor: "",
  musicExecutor: "",
  autoRender: false,
};

export function settingsFromDraft(draft: ProjectDraft): ProjectSettingsInput {
  const stageExecutors: ProjectSettingsInput["stageExecutors"] = {};
  if (draft.visualsExecutor) stageExecutors.visuals = draft.visualsExecutor;
  if (draft.voiceExecutor) stageExecutors.voice = draft.voiceExecutor;
  if (draft.musicExecutor) stageExecutors.music = draft.musicExecutor;
  return {
    language: draft.language,
    targetDurationSec: Number(draft.targetDurationSec),
    aspectRatio: draft.aspectRatio,
    stageExecutors,
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
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.autoRender} onChange={(event) => onChange("autoRender", event.target.checked)} />
            Automatically render after final approval
          </label>
        </div>
      )}
    </>
  );
}
