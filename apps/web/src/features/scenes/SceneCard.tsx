import type { Scene } from "@vg/shared";

export function sceneTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function SceneCard({
  scene,
  count,
  active,
  onSelect,
  onDragStart,
  onDrop,
  onMove,
}: {
  scene: Scene;
  count: number;
  active: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const duration = scene.durationOverrideSec ?? scene.estDurationSec;
  const excerpt = scene.narration.trim();
  return (
    <article
      className={`scene-card panel${active ? " is-active" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      data-scene-id={scene.id}
    >
      <button className="scene-card-open" type="button" onClick={onSelect} aria-label={`Edit scene ${scene.order + 1}: ${scene.label}`}>
        <div className="scene-image-placeholder">Ảnh sẽ có ở bước Visual</div>
        <div className="scene-card-heading">
          <strong>Scene {scene.order + 1}</strong>
          <time>{sceneTimecode(scene.startSec)}–{sceneTimecode(scene.startSec + duration)}</time>
        </div>
        <h3>{scene.label}</h3>
        <p className="scene-excerpt">{excerpt}</p>
        <div className="scene-card-tags">
          <span className="scene-query-chip">{scene.visualQueries.primary || "No visual query"}</span>
          <span className="scene-mood">{scene.musicMood || "No mood"} · {scene.energy}</span>
        </div>
        <div className="scene-card-footer">
          <span>{duration.toFixed(1)}s{scene.durationOverrideSec === null ? "" : " · override"}</span>
          {scene.edited && <span className="scene-edited-dot" aria-label="Edited">Edited</span>}
        </div>
      </button>
      <div className="scene-move-actions" aria-label={`Reorder scene ${scene.order + 1}`}>
        <button type="button" aria-label={`Move scene ${scene.order + 1} left`} disabled={scene.order === 0} onClick={() => onMove(-1)}>←</button>
        <button type="button" aria-label={`Move scene ${scene.order + 1} right`} disabled={scene.order === count - 1} onClick={() => onMove(1)}>→</button>
      </div>
    </article>
  );
}
