import { useEffect, useRef, useState, type FormEvent } from "react";
import { UpdateProjectInputSchema, type Project } from "@vg/shared";
import { ApiRequestError } from "../../services/apiClient";
import { useUpdateProject } from "../../hooks/useProjects";
import { ProjectFormFields, type ProjectDraft } from "./ProjectFormFields";

function draftFromProject(project: Project): ProjectDraft {
  return {
    title: project.title,
    topic: project.topic,
    description: project.description,
    mode: project.mode,
    language: project.settings.language,
    targetDurationSec: String(project.settings.targetDurationSec),
    aspectRatio: project.settings.aspectRatio,
    visualsExecutor: project.settings.stageExecutors.visuals ?? "",
    voiceExecutor: project.settings.stageExecutors.voice ?? "",
    musicExecutor: project.settings.stageExecutors.music ?? "",
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [advanced, setAdvanced] = useState(false);

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
      setErrors({});
      setRequestError("");
      mutation.reset();
    }
  }, [open, project]);

  function change(field: keyof ProjectDraft, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
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
    for (const key of ["language", "targetDurationSec", "aspectRatio", "autoRender"] as const) {
      const value = key === "targetDurationSec" ? Number(draft[key]) : draft[key];
      const oldValue = key === "targetDurationSec" ? project.settings[key] : project.settings[key];
      if (value !== oldValue) settings[key] = value;
    }
    const stageExecutors: Record<string, string> = {};
    const clearErrors: Record<string, string> = {};
    for (const [draftKey, executorKey] of [
      ["visualsExecutor", "visuals"],
      ["voiceExecutor", "voice"],
      ["musicExecutor", "music"],
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
    if (Object.keys(settings).length) patch.settings = settings;

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
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>×</button>
        </div>
        <div className="dialog-form-body">
          {requestError && <p className="request-error" role="alert">{requestError}</p>}
          <ProjectFormFields
            draft={draft}
            errors={errors}
            onChange={change}
            advanced={advanced}
            onToggleAdvanced={() => setAdvanced((value) => !value)}
          />
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
