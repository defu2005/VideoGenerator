import { splitSentences, type Scene, type ScenePatch } from "@vg/shared";
import { useEffect, useState } from "react";

export function SceneEditor({
  scene,
  language,
  wordsPerMinute,
  canMerge,
  disabled,
  onSave,
  onSplit,
  onMerge,
  onDelete,
  onClose,
  onDirtyChange,
}: {
  scene: Scene;
  language: string;
  wordsPerMinute: number;
  canMerge: boolean;
  disabled: boolean;
  onSave: (patch: ScenePatch) => Promise<void>;
  onSplit: (sentenceIndex: number) => Promise<void>;
  onMerge: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<Scene>(scene);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const sentences = splitSentences(draft.narration, language);
  const wordCount = draft.narration.trim().split(/\s+/u).filter(Boolean).length;
  const duration = Math.round(wordCount * 60 / wordsPerMinute * 10) / 10;

  useEffect(() => {
    setDraft(scene);
    setDirty(false);
    onDirtyChange(false);
    setError("");
  }, [scene.id, scene.updatedAt]);

  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function update(patch: Partial<Scene>) {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    onDirtyChange(true);
  }

  async function act(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Scene change failed");
    }
  }

  async function actStructural(action: () => Promise<void>) {
    if (dirty && !window.confirm("Discard unsaved scene changes?")) return;
    await act(async () => {
      await action();
      setDirty(false);
      onDirtyChange(false);
    });
  }

  async function save() {
    const patch: ScenePatch = {
      label: draft.label,
      narration: draft.narration,
      visualNotes: draft.visualNotes,
      visualQueries: draft.visualQueries,
      musicMood: draft.musicMood,
      energy: draft.energy,
      durationOverrideSec: draft.durationOverrideSec,
      transitionNote: draft.transitionNote,
    };
    await onSave(patch);
    setDirty(false);
    onDirtyChange(false);
  }

  return (
    <aside className="scene-editor panel" aria-label={`Edit scene ${scene.order + 1}`}>
      <div className="scene-editor-heading">
        <div><p className="eyebrow">SCENE {scene.order + 1}</p><h2>Edit scene</h2></div>
        <button className="icon-button" type="button" aria-label="Close scene editor" onClick={() => {
          if (!dirty || window.confirm("Discard unsaved scene changes?")) {
            onDirtyChange(false);
            onClose();
          }
        }}>×</button>
      </div>
      {error && <p className="request-error" role="alert">{error}</p>}
      <label className="form-field"><span>Label</span><input value={draft.label} onChange={(event) => update({ label: event.target.value })} /></label>
      <label className="form-field"><span>Narration</span>
        <textarea rows={7} value={draft.narration} onChange={(event) => update({ narration: event.target.value })} />
        <small>{wordCount} words · about {duration.toFixed(1)} sec at {wordsPerMinute} WPM</small>
      </label>
      <label className="form-field"><span>Visual notes</span><textarea rows={2} value={draft.visualNotes} onChange={(event) => update({ visualNotes: event.target.value })} /></label>
      <label className="form-field"><span>Primary visual query</span><input value={draft.visualQueries.primary} onChange={(event) => update({ visualQueries: { ...draft.visualQueries, primary: event.target.value } })} /></label>
      <div className="form-field">
        <span>Alternative queries</span>
        <div className="scene-query-tags">
          {draft.visualQueries.alternatives.map((alternative, index) => <span className="scene-query-chip" key={`${index}-${alternative}`}>{alternative}</span>)}
        </div>
        <input value={draft.visualQueries.alternatives.join(", ")} onChange={(event) => update({
          visualQueries: { ...draft.visualQueries, alternatives: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 3) },
        })} />
      </div>
      <label className="form-field"><span>Music mood</span><input value={draft.musicMood} onChange={(event) => update({ musicMood: event.target.value })} /></label>
      <div className="form-grid">
        <label className="form-field"><span>Energy</span>
          <select value={draft.energy} onChange={(event) => update({ energy: event.target.value as Scene["energy"] })}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
        </label>
        <label className="form-field"><span>Duration override (seconds)</span>
          <input type="number" min={1} max={60} value={draft.durationOverrideSec ?? ""} placeholder="Auto" onChange={(event) => update({
            durationOverrideSec: event.target.value ? Number(event.target.value) : null,
          })} />
        </label>
      </div>
      {draft.durationOverrideSec !== null && <button className="text-button" type="button" onClick={() => update({ durationOverrideSec: null })}>Reset duration to auto</button>}
      <label className="form-field"><span>Transition note</span><textarea rows={2} value={draft.transitionNote} onChange={(event) => update({ transitionNote: event.target.value })} /></label>
      <section className="scene-sentence-list" aria-label="Split narration">
        <h3>Split after a sentence</h3>
        {sentences.map((sentence, index) => (
          <div className="scene-sentence-row" key={`${index}-${sentence}`}>
            <span>{sentence}</span>
            <button type="button" className="text-button" disabled={disabled || index === sentences.length - 1} onClick={() => void actStructural(() => onSplit(index))}>Split after</button>
          </div>
        ))}
      </section>
      <div className="scene-editor-actions">
        <button className="button button-primary" type="button" disabled={disabled || !dirty} onClick={() => void act(save)}>Save changes</button>
        <button className="button button-secondary" type="button" disabled={disabled || !canMerge} onClick={() => void actStructural(onMerge)}>Merge with next</button>
        <button className="button button-danger-outline" type="button" disabled={disabled} onClick={() => {
          if (window.confirm("Delete this scene?")) void actStructural(onDelete);
        }}>Delete scene</button>
      </div>
    </aside>
  );
}
