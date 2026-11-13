import { useEffect, useRef, useState, type FormEvent } from "react";
import { recommendBrief, UpdateProjectInputSchema, type LlmRoute, type Project, type ProjectSettings } from "@vg/shared";
import { ApiRequestError } from "../../services/apiClient";
import { useUpdateProject } from "../../hooks/useProjects";
import { ProjectFormFields, type ProjectDraft } from "./ProjectFormFields";
import { BriefFields } from "./BriefFields";
import { EditStyleFields } from "./EditStyleFields";
import { guidelineDraftFromSettings, guidelineSettingsFromDraft, type GuidelineDraft } from "./GuidelineFieldset";

function draftFromProject(project: Project): ProjectDraft {
  return {
    title: project.title,
    topic: project.topic,
    description: project.description,
    mode: project.mode,
    language: project.settings.language,
    targetDurationSec: String(project.settings.targetDurationSec),
    researchMode: project.settings.researchMode ?? "",
    aspectRatio: project.settings.aspectRatio,
    visualsExecutor: project.settings.stageExecutors.visuals ?? "",
    voiceExecutor: project.settings.stageExecutors.voice ?? "",
    musicExecutor: project.settings.stageExecutors.music ?? "",
    scriptExecutor: project.settings.stageExecutors.script ?? "",
    llmProvider: project.settings.llm?.default?.provider ?? "",
    llmModel: project.settings.llm?.default?.model ?? "",
    voice: project.settings.voice?.voice ?? "",
    rate: project.settings.voice?.rate ?? "+0%",
    ttsProvider: project.settings.voice?.provider ?? "",
    ttsModel: project.settings.voice?.model ?? "",
    ttsStyle: project.settings.voice?.style ?? "",
    autoRender: project.settings.autoRender,
  };
}

function serverFieldErrors(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  return Object.fromEntries(details.flatMap((issue) => {
    if (typeof issue !== "object" || issue === null || !("path" in issue) || !("message" in issue)) return [];
    const path = Array.isArray(issue.path) ? issue.path.map(String).join(".") : "";
    return path && typeof issue.message === "string" ? [[path, issue.message]] : [];
  }));
}

export function EditProjectDialog({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const mutation = useUpdateProject();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ProjectDraft>(() => draftFromProject(project));
  const [llmTasks, setLlmTasks] = useState<NonNullable<ProjectSettings["llm"]>["tasks"]>(project.settings.llm?.tasks ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [briefSettings, setBriefSettings] = useState<ProjectSettings>(project.settings);
  const [briefUserSet, setBriefUserSet] = useState<string[]>(project.settings.userSet);
  const [briefChanges, setBriefChanges] = useState<string[]>([]);
  const [briefResets, setBriefResets] = useState<string[]>([]);
  const [guidelineDraft, setGuidelineDraft] = useState<GuidelineDraft>(() => guidelineDraftFromSettings(project.settings));

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
    if (open) {
      setDraft(draftFromProject(project));
      setLlmTasks(project.settings.llm?.tasks ?? {});
      setBriefSettings(project.settings);
      setBriefUserSet(project.settings.userSet);
      setBriefChanges([]);
      setBriefResets([]);
      setGuidelineDraft(guidelineDraftFromSettings(project.settings));
      setErrors({});
      setRequestError("");
      mutation.reset();
    }
  }, [open, project]);

  function change(field: keyof ProjectDraft, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function changeBrief(path: string, value: string | number | boolean) {
    setBriefSettings((current) => {
      if (path === "subtitles.enabled") return { ...current, subtitles: { ...current.subtitles, enabled: Boolean(value) } };
      if (path === "subtitles.maxCharsPerLine") return { ...current, subtitles: { ...current.subtitles, maxCharsPerLine: Number(value) } };
      if (path === "music.enabled") return { ...current, music: { ...current.music, enabled: Boolean(value) } };
      if (path === "music.volume") return { ...current, music: { ...current.music, volume: Number(value) } };
      if (path === "budget.mode") return { ...current, budget: { ...current.budget, mode: value as ProjectSettings["budget"]["mode"] } };
      if (path.startsWith("budget.features.")) {
        const key = path.slice("budget.features.".length) as keyof NonNullable<ProjectSettings["budget"]["features"]>;
        return { ...current, budget: { ...current.budget, features: { ...current.budget.features, [key]: value } } };
      }
      return { ...current, [path]: value } as ProjectSettings;
    });
    setBriefUserSet((current) => [...new Set([...current, path])]);
    setBriefChanges((current) => [...new Set([...current, path])]);
    setBriefResets((current) => current.filter((field) => field !== path));
  }

  function resetBrief(path: string) {
    const userSet = briefUserSet.filter((field) => field !== path);
    const resolved = recommendBrief({ topic: draft.topic, settings: { ...briefSettings, userSet } }).values.settings;
    setBriefSettings((current) => {
      if (path === "subtitles.enabled") return { ...current, subtitles: { ...current.subtitles, enabled: resolved.subtitles.enabled } };
      if (path === "subtitles.maxCharsPerLine") return { ...current, subtitles: { ...current.subtitles, maxCharsPerLine: resolved.subtitles.maxCharsPerLine } };
      if (path === "music.enabled") return { ...current, music: { ...current.music, enabled: resolved.music.enabled } };
      if (path === "music.volume") return { ...current, music: { ...current.music, volume: resolved.music.volume } };
      if (path === "budget.mode") return { ...current, budget: { ...current.budget, mode: resolved.budget.mode } };
      if (path.startsWith("budget.features.")) {
        const key = path.slice("budget.features.".length) as keyof NonNullable<ProjectSettings["budget"]["features"]>;
        const features = { ...current.budget.features };
        delete features[key];
        return { ...current, budget: { ...current.budget, features } };
      }
      return { ...current, [path]: resolved[path as keyof typeof resolved] } as ProjectSettings;
    });
    setBriefUserSet(userSet);
    setBriefChanges((current) => current.filter((field) => field !== path));
    setBriefResets((current) => [...new Set([...current, path])]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setRequestError("");
    const initial = draftFromProject(project);
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "topic", "description", "mode"] as const) {
      if (draft[key] !== initial[key]) patch[key] = draft[key];
    }
    const settings: Record<string, unknown> = {};
    for (const path of briefChanges) {
      if (path === "subtitles.enabled") {
        settings.subtitles = { ...(settings.subtitles as object | undefined), enabled: briefSettings.subtitles.enabled };
      } else if (path === "subtitles.maxCharsPerLine") {
        settings.subtitles = { ...(settings.subtitles as object | undefined), maxCharsPerLine: briefSettings.subtitles.maxCharsPerLine };
      } else if (path === "music.enabled") {
        settings.music = { ...(settings.music as object | undefined), enabled: briefSettings.music.enabled };
      } else if (path === "music.volume") {
        settings.music = { ...(settings.music as object | undefined), volume: briefSettings.music.volume };
      } else if (path === "budget.mode") {
        settings.budget = { ...(settings.budget as object | undefined), mode: briefSettings.budget.mode };
      } else if (path.startsWith("budget.features.")) {
        settings.budget = {
          ...(settings.budget as object | undefined),
          features: {
            ...((settings.budget as { features?: object } | undefined)?.features),
            [path.slice("budget.features.".length)]: briefSettings.budget.features?.[
              path.slice("budget.features.".length) as keyof NonNullable<ProjectSettings["budget"]["features"]>
            ],
          },
        };
      } else {
        settings[path] = briefSettings[path as keyof ProjectSettings];
      }
    }
    if (draft.researchMode !== (project.settings.researchMode ?? "")) {
      settings.researchMode = draft.researchMode || undefined;
    }
    if (
      draft.voice !== (project.settings.voice?.voice ?? "")
      || draft.rate !== (project.settings.voice?.rate ?? "+0%")
      || draft.ttsProvider !== (project.settings.voice?.provider ?? "")
      || draft.ttsModel !== (project.settings.voice?.model ?? "")
      || draft.ttsStyle !== (project.settings.voice?.style ?? "")
    ) {
      settings.voice = {
        ...(draft.voice ? { voice: draft.voice } : {}),
        ...(draft.rate ? { rate: draft.rate } : {}),
        ...(draft.ttsProvider ? { provider: draft.ttsProvider } : {}),
        ...(draft.ttsModel.trim() ? { model: draft.ttsModel.trim() } : {}),
        ...(draft.ttsStyle.trim() ? { style: draft.ttsStyle.trim() } : {}),
      };
    }
    const stageExecutors: Record<string, string> = {};
    const clearErrors: Record<string, string> = {};
    for (const [draftKey, executorKey] of [
      ["visualsExecutor", "visuals"],
      ["voiceExecutor", "voice"],
      ["musicExecutor", "music"],
      ["scriptExecutor", "script"],
    ] as const) {
      const value = draft[draftKey] || undefined;
      const currentValue = project.settings.stageExecutors[executorKey];
      if (!value && currentValue) {
        clearErrors[`settings.stageExecutors.${executorKey}`] = "The current API cannot clear an explicitly configured executor.";
      } else if (value !== currentValue) {
        if (value) stageExecutors[executorKey] = value;
      }
    }
    if (Object.keys(clearErrors).length) {
      setErrors(clearErrors);
      setRequestError("Some settings cannot be reset until the project API supports clearing executor overrides.");
      return;
    }
    if (Object.keys(stageExecutors).length) {
      settings.stageExecutors = stageExecutors;
    }
    const defaultRouteChanged = draft.llmProvider !== (project.settings.llm?.default?.provider ?? "")
      || draft.llmModel !== (project.settings.llm?.default?.model ?? "");
    const taskRoutesChanged = JSON.stringify(llmTasks) !== JSON.stringify(project.settings.llm?.tasks ?? {});
    if (defaultRouteChanged || taskRoutesChanged) {
      const llm: Record<string, unknown> = {};
      if (defaultRouteChanged) {
        llm.default = {
          provider: draft.llmProvider || project.settings.llm?.default?.provider || "",
          ...(draft.llmModel.trim() ? { model: draft.llmModel.trim() } : {}),
        };
      }
      if (taskRoutesChanged) {
        const tasks: Record<string, LlmRoute | null> = {};
        for (const [task, route] of Object.entries(project.settings.llm?.tasks ?? {})) {
          if (!(task in (llmTasks ?? {}))) tasks[task] = null;
          else if (route) tasks[task] = route;
        }
        for (const [task, route] of Object.entries(llmTasks ?? {})) {
          if (route) tasks[task] = route;
        }
        llm.tasks = tasks;
      }
      settings.llm = llm;
    }
    const guidelines = guidelineSettingsFromDraft(guidelineDraft);
    const currentGuidelines = guidelineSettingsFromDraft(guidelineDraftFromSettings(project.settings));
    if (JSON.stringify(guidelines ?? null) !== JSON.stringify(currentGuidelines ?? null) && guidelines) {
      settings.guidelines = guidelines;
    }
    if (Object.keys(settings).length) patch.settings = settings;
    if (briefResets.length) patch.resetToRecommended = briefResets;

    const result = UpdateProjectInputSchema.safeParse(patch);
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) nextErrors[issue.path.map(String).join(".")] = issue.message;
      setErrors(nextErrors);
      return;
    }
    try {
      await mutation.mutateAsync({ id: project.id, input: result.data });
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(serverFieldErrors(error.details));
        setRequestError(error.message);
      } else {
        setRequestError(error instanceof Error ? error.message : "Unable to update project");
      }
    }
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="dialog form-dialog"
      aria-modal="true"
      aria-labelledby="edit-project-title"
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-heading">
          <div><p className="eyebrow">PROJECT LIBRARY</p><h2 id="edit-project-title">Edit project</h2></div>
          <button className="icon-button" type="button" aria-label="Đóng" onClick={onClose}>×</button>
        </div>
        <div className="dialog-form-body">
          {requestError && <p className="request-error" role="alert">{requestError}</p>}
          <ProjectFormFields
            draft={draft}
            errors={errors}
            onChange={change}
            advanced={advanced}
            onToggleAdvanced={() => setAdvanced((value) => !value)}
            projectId={project.id}
            llmTasks={llmTasks}
            onLlmTasksChange={setLlmTasks}
            guidelineDraft={guidelineDraft}
            onGuidelineDraftChange={setGuidelineDraft}
            guidelineBrief={briefSettings}
          />
          <BriefFields
            topic={draft.topic}
            settings={{ ...briefSettings, userSet: briefUserSet }}
            onChange={changeBrief}
            onReset={resetBrief}
          />
          <fieldset className="form-row">
            <legend>Phong cách dựng của dự án</legend>
            <EditStyleFields
              idPrefix="Dự án"
              edit={briefSettings.edit}
              onChange={(edit) => {
                setBriefSettings((current) => ({ ...current, edit }));
                setBriefChanges((current) => [...new Set([...current, "edit"])]);
              }}
            />
          </fieldset>
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose} disabled={mutation.isPending}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
