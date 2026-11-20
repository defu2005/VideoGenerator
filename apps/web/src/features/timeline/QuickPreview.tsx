import { useState } from "react";
import { ApiRequestError } from "../../services/apiClient";
import { previewClip, previewContactSheet, previewFrame, type PreviewResult } from "../../services/previewApi";

type Scene = { sceneId: string; label: string; durationSec: number };

function message(reason: unknown): string {
  if (reason instanceof ApiRequestError && reason.code === "PREVIEW_BUSY") return "Máy đang bận xem trước khác, thử lại sau vài giây.";
  return reason instanceof Error ? reason.message : "Không xem trước được";
}

function Notes({ result }: { result: PreviewResult }) {
  const lines = [...new Set([...result.notes, ...result.warnings])];
  return (
    <div className="quick-preview-notes">
      <small>{result.basis === "timeline" ? "Theo timeline" : "Theo ảnh đã chọn"} · {(result.elapsedMs / 1000).toFixed(1)}s{result.cached ? " · từ bộ nhớ đệm" : ""}</small>
      {lines.length > 0 && <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
    </div>
  );
}

/** Per-scene fast preview: three frames and a 3 s clip. Nothing runs until the user clicks. */
export function SceneQuickPreview({ projectId, scene }: { projectId: string; scene: Scene }) {
  const [frames, setFrames] = useState<PreviewResult[]>([]);
  const [clip, setClip] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(kind: "frames" | "clip") {
    setError("");
    setBusy(kind);
    try {
      if (kind === "clip") setClip(await previewClip(projectId, scene.sceneId));
      else {
        const last = Math.max(0, scene.durationSec - 0.1);
        const nextFrames: PreviewResult[] = [];
        // The governor admits at most two preview requests. Use one slot for this strip.
        for (const offset of [0, last / 2, last]) {
          nextFrames.push(await previewFrame(projectId, scene.sceneId, offset));
        }
        setFrames(nextFrames);
      }
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="quick-preview">
      <div className="quick-preview-actions">
        <button className="button button-secondary" type="button" disabled={busy !== ""} onClick={() => void run("frames")}>
          {busy === "frames" ? "Đang dựng…" : "Xem trước nhanh"}
        </button>
        <button className="button button-secondary" type="button" disabled={busy !== ""} onClick={() => void run("clip")}>
          {busy === "clip" ? "Đang dựng…" : "Phát 3 giây"}
        </button>
      </div>
      {error && <p className="request-error" role="alert">{error}</p>}
      {frames.length > 0 && (
        <div className="quick-preview-strip">
          {frames.map((frame, index) => <img key={`${index}:${frame.file.id}`} src={frame.file.url} alt={`${scene.label} — khung ${index + 1}`} loading="lazy" />)}
        </div>
      )}
      {frames[0] && <Notes result={frames[0]} />}
      {clip && (
        <>
          <video src={clip.file.url} controls autoPlay muted playsInline className="quick-preview-video" aria-label={`Clip 3 giây: ${scene.label}`} />
          <Notes result={clip} />
        </>
      )}
    </div>
  );
}

/** Whole-video contact sheet, built only on click. */
export function ContactSheetButton({ projectId }: { projectId: string }) {
  const [sheet, setSheet] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function build() {
    setError("");
    setBusy(true);
    try {
      setSheet(await previewContactSheet(projectId, "all"));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel quick-preview-sheet" aria-label="Contact sheet">
      <div className="quick-preview-actions">
        <button className="button button-secondary" type="button" disabled={busy} onClick={() => void build()}>
          {busy ? "Đang dựng…" : "Contact sheet"}
        </button>
        <small>Mỗi cảnh quay có 3 khung, ghép thành một ảnh cho cả video. Chỉ chạy khi bạn bấm.</small>
      </div>
      {error && <p className="request-error" role="alert">{error}</p>}
      {sheet && (
        <>
          <img className="quick-preview-sheet-img" src={sheet.file.url} alt="Contact sheet của video" />
          <Notes result={sheet} />
        </>
      )}
    </section>
  );
}
