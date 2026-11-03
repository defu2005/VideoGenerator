import type { ProjectVisuals, Scene } from "@vg/shared";
import { useEffect, useState } from "react";

export function sceneTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function SceneCard({
  scene,
  visual,
  aspectRatio,
  count,
  active,
  onSelect,
  onDragStart,
  onDrop,
  onMove,
}: {
  scene: Scene;
  visual?: ProjectVisuals["scenes"][number];
  aspectRatio: "16:9" | "9:16" | "1:1";
  count: number;
  active: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const duration = scene.durationOverrideSec ?? scene.estDurationSec;
  const excerpt = scene.narration.trim();
  const candidate = visual?.selectedCandidate;
  const ratio = aspectRatio === "9:16" ? "9 / 16" : aspectRatio === "1:1" ? "1 / 1" : "16 / 9";
  const license = candidate?.license;
  const nonCommercial = license?.kind.includes("NC") ?? false;
  const licenseClass = license?.kind === "CC0" || license?.kind === "PUBLIC_DOMAIN"
    ? "is-license-free"
    : license?.kind === "UNKNOWN" ? "is-license-unknown"
      : license?.kind === "ALL_RIGHTS_RESERVED" ? "is-license-restricted"
        : nonCommercial ? "is-license-noncommercial" : "is-license-attribution";
  useEffect(() => setImageFailed(false), [candidate?.previewUrl]);
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
        <div className="scene-image-box" style={{ aspectRatio: ratio }}>
          {candidate && !imageFailed ? (
            <img
              className="scene-image"
              src={candidate.previewUrl}
              loading="lazy"
              referrerPolicy="no-referrer"
              alt={candidate.title}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="scene-image-placeholder">
              {imageFailed
                ? `${candidate?.provider ?? "Image"} · Ảnh không tải được`
                : visual?.needsUser ? "Cần chọn ảnh" : "Ảnh sẽ có ở bước Visual"}
            </div>
          )}
        </div>
        {license && <span className={`scene-license-badge ${licenseClass}`}>
          {nonCommercial
            ? "Non-commercial"
            : license.kind === "CC0" ? "CC0"
              : license.kind === "PUBLIC_DOMAIN" ? "Public domain"
                : license.kind === "UNKNOWN" ? "Unknown — review"
                  : license.kind === "ALL_RIGHTS_RESERVED" ? "All rights reserved"
                    : license.attributionRequired ? "Attribution required" : license.name}
        </span>}
        {visual?.lowRelevance && <span className="scene-low-relevance-badge">Ít liên quan — nên chọn lại</span>}
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
