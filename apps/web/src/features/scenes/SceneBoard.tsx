import { resolveBudget, type Project, type Scene } from "@vg/shared";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { usePipeline } from "../../hooks/usePipeline";
import { useScenes } from "../../hooks/useScenes";
import { useVisuals } from "../../hooks/useVisuals";
import { DurationBar } from "./DurationBar";
import { SceneCard } from "./SceneCard";
import { SceneEditor } from "./SceneEditor";

export function SceneBoard({ project }: { project: Project }) {
  const scenesQuery = useScenes(project.id);
  const visualsQuery = useVisuals(project.id);
  const pipeline = usePipeline(project.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [actionError, setActionError] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const editorDirtyRef = useRef(editorDirty);
  editorDirtyRef.current = editorDirty;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmNavigation = (event: MouseEvent) => {
      if (!editorDirtyRef.current || !(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved scene changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, []);
  const stage = pipeline.data?.stages.find((record) => record.stage === "SCENE_PLAN");
  const scriptStage = pipeline.data?.stages.find((record) => record.stage === "SCRIPT");

  if (scenesQuery.isPending || pipeline.isPending) return <Spinner label="Loading scene board" />;
  if (scenesQuery.isError) return <ErrorState message={scenesQuery.error.message} onRetry={() => void scenesQuery.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;
  if (visualsQuery.isError) return <ErrorState message={visualsQuery.error.message} onRetry={() => void visualsQuery.refetch()} />;

  const summary = scenesQuery.data;
  const selected = summary.scenes.find((scene) => scene.id === selectedId) ?? null;
  const edited = summary.scenes.some((scene) => scene.edited);
  const canRun = scriptStage?.state === "DONE" && !pipeline.data.activeJob && !pipeline.isMutating;
  const featureEnabled = resolveBudget(project).sceneQueryAssist;

  async function runScenePlan(confirmed = false) {
    setActionError("");
    try {
      await pipeline.action({ type: "run", stage: "SCENE_PLAN", ...(confirmed ? { confirmOverwrite: true } : {}) });
      setConfirmOverwrite(false);
      setEditorDirty(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to run scene plan");
    }
  }

  async function mutateAction(action: Parameters<typeof scenesQuery.mutate>[0]): Promise<boolean> {
    setActionError("");
    try {
      await scenesQuery.mutate(action);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update scenes");
      return false;
    }
  }

  async function reorder(sceneIds: string[]) {
    if (editorDirty && !window.confirm("Discard unsaved scene changes?")) return;
    if (await mutateAction({ type: "reorder", sceneIds })) setEditorDirty(false);
  }

  return (
    <div className="scene-board">
      {actionError && <p className="request-error" role="alert">{actionError}</p>}
      {summary.stale && <div className="scene-stale-banner" role="status">The script changed after this scene plan was created. Regenerate to sync the storyboard.</div>}
      <section className="scene-board-header panel">
        <div>
          <p className="eyebrow">SCENE BOARD</p>
          <h2>{summary.scenes.length} scenes</h2>
        </div>
        <DurationBar totalSec={summary.totalSec} targetSec={summary.targetSec} />
        <button className="button button-primary" type="button" disabled={!canRun} onClick={() => {
          if (editorDirty && !window.confirm("Discard unsaved scene changes?")) return;
          if (edited) setConfirmOverwrite(true);
          else void runScenePlan();
        }}>
          Regenerate scene plan
          <small>{featureEnabled ? `1 lượt (${project.settings.budget.mode})` : "0 lượt gọi AI"}</small>
        </button>
      </section>

      {summary.scenes.length === 0 ? (
        <section className="panel scene-empty-state">
          <h2>No scenes yet</h2>
          <p>Run the deterministic scene plan stage to divide your script into timed scenes with visual search queries.</p>
          <button className="button button-primary" type="button" disabled={!canRun} onClick={() => void runScenePlan()}>Run scene plan</button>
          {scriptStage?.state !== "DONE" && <small>Complete the Script stage first.</small>}
        </section>
      ) : (
        <div className={`scene-board-content${selected ? " has-editor" : ""}`}>
          <div className="scene-grid" aria-label="Scenes storyboard">
            {summary.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                visual={visualsQuery.data?.scenes.find((item) => item.sceneId === scene.id)}
                aspectRatio={project.settings.aspectRatio}
                count={summary.scenes.length}
                active={selected?.id === scene.id}
                onSelect={() => {
                  if (editorDirty && !window.confirm("Discard unsaved scene changes?")) return;
                  setEditorDirty(false);
                  setSelectedId(scene.id);
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", scene.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = summary.scenes.find((item) => item.id === event.dataTransfer.getData("text/plain"));
                  if (source) void reorder(reorderIds(summary.scenes, source, scene));
                }}
                onMove={(direction) => {
                  const target = summary.scenes[scene.order + direction];
                  if (target) void reorder(reorderIds(summary.scenes, scene, target));
                }}
              />
            ))}
          </div>
          {selected && (
            <SceneEditor
              scene={selected}
              language={project.settings.language}
              wordsPerMinute={project.settings.wordsPerMinute}
              canMerge={selected.order < summary.scenes.length - 1}
              disabled={scenesQuery.isMutating || Boolean(pipeline.data.activeJob)}
              onClose={() => setSelectedId(null)}
              onDirtyChange={setEditorDirty}
              onSave={(patch) => scenesQuery.mutate({ type: "update", sceneId: selected.id, patch }).then(() => undefined)}
              onSplit={(sentenceIndex) => scenesQuery.mutate({ type: "split", sceneId: selected.id, sentenceIndex }).then(() => undefined)}
              onMerge={() => {
                const next = summary.scenes[selected.order + 1];
                if (!next) throw new Error("There is no next scene to merge.");
                return scenesQuery.mutate({ type: "merge", sceneIds: [selected.id, next.id] }).then(() => undefined);
              }}
              onDelete={() => scenesQuery.mutate({ type: "delete", sceneId: selected.id }).then(() => setSelectedId(null))}
            />
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmOverwrite}
        title="Overwrite edited scenes?"
        message="Regenerating will replace all edited scenes. This action cannot be undone."
        confirmLabel="Regenerate plan"
        busy={pipeline.isMutating}
        onCancel={() => setConfirmOverwrite(false)}
        onConfirm={() => void runScenePlan(true)}
      />
      {stage?.state === "FAILED" && stage.message && <p className="request-error" role="alert">{stage.message}</p>}
    </div>
  );
}

function reorderIds(scenes: Scene[], source: Scene, target: Scene): string[] {
  const reordered = [...scenes];
  const [moved] = reordered.splice(source.order, 1);
  reordered.splice(target.order, 0, moved);
  return reordered.map((scene) => scene.id);
}
