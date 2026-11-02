import { useEffect, useRef, useState, type FormEvent } from "react";
import { CreateProjectInputSchema } from "@vg/shared";
import { useNavigate } from "react-router-dom";
import { ApiRequestError } from "../../services/apiClient";
import { useCreateProject } from "../../hooks/useProjects";
import { ProjectFormFields, DEFAULT_PROJECT_DRAFT, settingsFromDraft, type ProjectDraft } from "./ProjectFormFields";

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

export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const mutation = useCreateProject();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ProjectDraft>(DEFAULT_PROJECT_DRAFT);
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
      setDraft(DEFAULT_PROJECT_DRAFT);
      setErrors({});
      setRequestError("");
      mutation.reset();
    }
  }, [open]);

  function change(field: keyof ProjectDraft, value: string | boolean) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setRequestError("");
    const result = CreateProjectInputSchema.safeParse({
      title: draft.title,
      topic: draft.topic,
      description: draft.description,
      mode: draft.mode,
      settings: settingsFromDraft(draft),
    });
    if (!result.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        nextErrors[issue.path.map(String).join(".")] = issue.message;
      }
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
            {mutation.isPending ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
