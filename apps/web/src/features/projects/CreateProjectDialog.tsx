import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CreateProjectInputSchema,
  recommendBrief,
  type BriefSettings,
  type ProfileListItem,
  type ProjectSettings,
} from "@vg/shared";
import { useNavigate } from "react-router-dom";
import { ApiRequestError } from "../../services/apiClient";
import { useCreateProject } from "../../hooks/useProjects";
import { useProfiles } from "../../hooks/useProfiles";
import { ProjectFormFields, DEFAULT_PROJECT_DRAFT, type ProjectDraft } from "./ProjectFormFields";
import { BriefFields } from "./BriefFields";
import {
  DEFAULT_GUIDELINE_DRAFT,
  GuidelineFieldset,
  guidelineDraftFromSettings,
  guidelineSettingsFromDraft,
  type GuidelineDraft,
} from "./GuidelineFieldset";
import { getProfile } from "../../services/profilesApi";

function validationMessages(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const errors: Record<string, string> = {};
  for (const issue of details) {
    if (typeof issue !== "object" || issue === null || !("path" in issue) || !("message" in issue)) continue;
    const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
    if (path && typeof issue.message === "string") errors[path] = issue.message;
  }
  return errors;
}

function briefValue(settings: BriefSettings, path: string): string | number | boolean | undefined {
  if (path === "subtitles.enabled") return settings.subtitles.enabled;
  if (path === "subtitles.maxCharsPerLine") return settings.subtitles.maxCharsPerLine;
  if (path === "music.enabled") return settings.music.enabled;
  if (path === "music.volume") return settings.music.volume;
  if (path === "budget.mode") return settings.budget.mode;
  if (path.startsWith("budget.features.")) {
    const key = path.slice("budget.features.".length) as keyof NonNullable<BriefSettings["budget"]["features"]>;
    const value = settings.budget.features?.[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
  }
  const value = settings[path as keyof BriefSettings];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function setBriefValue(settings: BriefSettings, path: string, value: string | number | boolean): BriefSettings {
  if (path === "subtitles.enabled") return { ...settings, subtitles: { ...settings.subtitles, enabled: Boolean(value) } };
  if (path === "subtitles.maxCharsPerLine") return { ...settings, subtitles: { ...settings.subtitles, maxCharsPerLine: Number(value) } };
  if (path === "music.enabled") return { ...settings, music: { ...settings.music, enabled: Boolean(value) } };
  if (path === "music.volume") return { ...settings, music: { ...settings.music, volume: Number(value) } };
  if (path === "budget.mode") {
    return { ...settings, budget: { ...settings.budget, mode: value as BriefSettings["budget"]["mode"] } };
  }
  if (path.startsWith("budget.features.")) {
    const key = path.slice("budget.features.".length) as keyof NonNullable<BriefSettings["budget"]["features"]>;
    return {
      ...settings,
      budget: { ...settings.budget, features: { ...settings.budget.features, [key]: value } },
    };
  }
  return { ...settings, [path]: value } as BriefSettings;
}

function summaryText(settings: BriefSettings): string {
  const language = settings.language === "vi" ? "Tiếng Việt" : settings.language.toUpperCase();
  const platform = {
    youtube: "YouTube",
    youtube_shorts: "YouTube Shorts",
    tiktok: "TikTok",
    facebook_reels: "Facebook Reels",
    custom: "Custom",
  }[settings.platform];
  const duration = settings.targetDurationSec >= 60
    ? `${settings.targetDurationSec / 60} phút`
    : `${settings.targetDurationSec} giây`;
  const style = `${settings.style[0].toLocaleUpperCase()}${settings.style.slice(1)}`;
  return `${platform} · ${settings.aspectRatio} · ${duration} · ${language} · ${style} — gợi ý tự động`;
}

export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const mutation = useCreateProject();
  const profilesQuery = useProfiles({ includeArchived: false });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ProjectDraft>(DEFAULT_PROJECT_DRAFT);
  const [llmTasks, setLlmTasks] = useState<NonNullable<ProjectSettings["llm"]>["tasks"]>({});
  const [brief, setBrief] = useState<BriefSettings>(() => recommendBrief({ topic: "" }).values.settings);
  const [briefUserSet, setBriefUserSet] = useState<string[]>([]);
  const [debouncedTopic, setDebouncedTopic] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [customize, setCustomize] = useState(false);
  const [guidelineDraft, setGuidelineDraft] = useState<GuidelineDraft>(DEFAULT_GUIDELINE_DRAFT);
  const [advanced, setAdvanced] = useState(false);
  const [profileId, setProfileId] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[autofocus]")?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTopic(draft.topic), 300);
    return () => window.clearTimeout(timer);
  }, [draft.topic]);

  useEffect(() => {
    if (open) {
      setDraft(DEFAULT_PROJECT_DRAFT);
      setLlmTasks({});
      setBrief(recommendBrief({ topic: "" }).values.settings);
      setBriefUserSet([]);
      setDebouncedTopic("");
      setErrors({});
      setRequestError("");
      setCustomize(false);
      setAdvanced(false);
      setGuidelineDraft(DEFAULT_GUIDELINE_DRAFT);
      setProfileId("");
      mutation.reset();
    }
  }, [open]);

  async function applyProfile(nextProfileId: string) {
    setProfileId(nextProfileId);
    setRequestError("");
    if (!nextProfileId) return;
    setCustomize(true);
    try {
      const profile = await getProfile(nextProfileId);
      const { mode, autoRender, ...briefSettings } = profile.defaultBrief;
      setBrief({ ...briefSettings, userSet: [] });
      setBriefUserSet(Object.keys(briefSettings).filter((key) => [
        "budget", "platform", "style", "tone", "audience", "language",
        "targetDurationSec", "aspectRatio", "wordsPerMinute", "sceneDurationSec", "visualStyle",
      ].includes(key)));
      setDraft((current) => ({
        ...current,
        mode,
        language: profile.language,
        autoRender,
        voice: profile.voice?.voice ?? "",
        rate: profile.voice?.rate ?? "+0%",
        aspectRatio: briefSettings.aspectRatio,
      }));
      setGuidelineDraft(guidelineDraftFromSettings({ guidelines: profile.guidelines }));
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Không tải được hồ sơ");
    }
  }

  function change(field: keyof ProjectDraft, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function changeBrief(path: string, value: string | number | boolean) {
    setBrief((current) => setBriefValue(current, path, value));
    setBriefUserSet((current) => [...new Set([...current, path])]);
  }

  function resetBrief(path: string) {
    const userSet = briefUserSet.filter((item) => item !== path);
    let settings = { ...brief, userSet };
    if (path.startsWith("budget.features.")) {
      const features = { ...settings.budget.features };
      delete features[path.slice("budget.features.".length) as keyof NonNullable<BriefSettings["budget"]["features"]>];
      settings = { ...settings, budget: { ...settings.budget, features } };
    }
    const resolved = recommendBrief({ topic: draft.topic, settings }).values.settings;
    setBriefUserSet(userSet);
    setBrief(resolved);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setRequestError("");
    const payload: Record<string, unknown> = { topic: draft.topic };
    if (profileId) payload.profileId = profileId;
    if (customize) {
      if (draft.title.trim()) payload.title = draft.title;
      if (draft.description) payload.description = draft.description;
      if (draft.mode !== "ASSISTED") payload.mode = draft.mode;

      const settings: Record<string, unknown> = {};
      for (const path of briefUserSet) {
        const value = briefValue(brief, path);
        if (value === undefined) continue;
        if (path.startsWith("subtitles.")) {
          settings.subtitles = { ...(settings.subtitles as object | undefined), [path.slice("subtitles.".length)]: value };
        } else if (path.startsWith("music.")) {
          settings.music = { ...(settings.music as object | undefined), [path.slice("music.".length)]: value };
        } else if (path === "budget.mode") {
          settings.budget = { ...(settings.budget as object | undefined), mode: value };
        } else if (path.startsWith("budget.features.")) {
          settings.budget = {
            ...(settings.budget as object | undefined),
            features: {
              ...((settings.budget as { features?: object } | undefined)?.features),
              [path.slice("budget.features.".length)]: value,
            },
          };
        } else {
          settings[path] = value;
        }
      }
      if (briefUserSet.length) settings.userSet = briefUserSet;

      const stageExecutors: Record<string, string> = {};
      if (draft.scriptExecutor) stageExecutors.script = draft.scriptExecutor;
      if (draft.visualsExecutor) stageExecutors.visuals = draft.visualsExecutor;
      if (draft.voiceExecutor) stageExecutors.voice = draft.voiceExecutor;
      if (draft.musicExecutor) stageExecutors.music = draft.musicExecutor;
      if (Object.keys(stageExecutors).length) settings.stageExecutors = stageExecutors;
      if (draft.researchMode) settings.researchMode = draft.researchMode;
      const llmSettings: Record<string, unknown> = {};
      if (draft.llmProvider) {
        llmSettings.default = {
          provider: draft.llmProvider,
          ...(draft.llmModel.trim() ? { model: draft.llmModel.trim() } : {}),
        };
      }
      if (llmTasks && Object.keys(llmTasks).length) {
        llmSettings.tasks = llmTasks;
      }
      if (Object.keys(llmSettings).length) settings.llm = llmSettings;
      if (draft.autoRender) settings.autoRender = true;
      if (Object.keys(settings).length) payload.settings = settings;
    }
    const guidelines = guidelineSettingsFromDraft(guidelineDraft);
    if (guidelines) {
      const settings = (payload.settings as Record<string, unknown> | undefined) ?? {};
      settings.guidelines = guidelines;
      payload.settings = settings;
    }
    const result = CreateProjectInputSchema.safeParse(payload);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) nextErrors[issue.path.map(String).join(".")] = issue.message;
      setErrors(nextErrors);
      return;
    }

    try {
      const project = await mutation.mutateAsync(result.data);
      onClose();
      navigate(`/projects/${project.id}/overview`);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(validationMessages(error.details));
        setRequestError(error.message);
      } else {
        setRequestError(error instanceof Error ? error.message : "Unable to create project");
      }
    }
  }

  if (!open) return null;
  const previewSettings = recommendBrief({ topic: debouncedTopic, settings: { ...brief, userSet: briefUserSet } }).values.settings;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="dialog form-dialog"
      aria-modal="true"
      aria-labelledby="create-project-title"
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-heading">
          <div><p className="eyebrow">PROJECT LIBRARY</p><h2 id="create-project-title">Create project</h2></div>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        <div className="dialog-form-body">
          {requestError && <p className="request-error" role="alert">{requestError}</p>}
          <label className="form-field">
            <span>Hồ sơ</span>
            <select
              aria-label="Hồ sơ"
              value={profileId}
              onChange={(event) => void applyProfile(event.target.value)}
            >
              <option value="">Không chọn</option>
              {(profilesQuery.data?.items ?? []).map((profile: ProfileListItem) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <small className="field-hint">Chọn hồ sơ để điền brief, giọng đọc và định hướng kênh.</small>
          </label>
          <label className="form-field">
            <span>Chủ đề / Topic <b aria-hidden="true">*</b></span>
            <textarea
              autoFocus
              value={draft.topic}
              rows={3}
              maxLength={2000}
              aria-invalid={Boolean(errors.topic)}
              onChange={(event) => change("topic", event.target.value)}
            />
            {errors.topic && <small className="field-error">{errors.topic}</small>}
          </label>
          {debouncedTopic.trim() && <p className="brief-summary">{summaryText(previewSettings)}</p>}
          <GuidelineFieldset draft={guidelineDraft} brief={previewSettings} onChange={setGuidelineDraft} />
          <button className="text-button advanced-toggle" type="button" aria-expanded={customize} onClick={() => setCustomize((value) => !value)}>
            {customize ? "− Hide customization" : "+ Tùy chỉnh / Customize"}
          </button>
          {customize && (
            <>
              <label className="form-field">
                <span>Title (optional)</span>
                <input value={draft.title} maxLength={200} onChange={(event) => change("title", event.target.value)} />
                <small className="field-hint">Leave blank to derive the title from the topic.</small>
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea value={draft.description} rows={2} maxLength={2000} onChange={(event) => change("description", event.target.value)} />
              </label>
              <label className="form-field">
                <span>Mode</span>
                <select value={draft.mode} onChange={(event) => change("mode", event.target.value)}>
                  <option value="ASSISTED">ASSISTED</option><option value="AUTO">AUTO</option><option value="MANUAL">MANUAL</option>
                </select>
              </label>
              <BriefFields topic={draft.topic} settings={{ ...brief, userSet: briefUserSet }} onChange={changeBrief} onReset={resetBrief} />
              <ProjectFormFields
                draft={draft}
                errors={errors}
                onChange={change}
                advanced={advanced}
                onToggleAdvanced={() => setAdvanced((value) => !value)}
                advancedOnly
                llmTasks={llmTasks}
                onLlmTasksChange={setLlmTasks}
              />
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Tạo"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
