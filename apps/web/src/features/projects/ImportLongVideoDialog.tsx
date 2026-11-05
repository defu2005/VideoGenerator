import { OWNERSHIP_LABEL, SPEECH_HINT, type SpeechTool } from "@vg/shared";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { importLongVideo, saveSpeechSettings } from "../../services/clipsApi";

export function ImportLongVideoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [videoPath, setVideoPath] = useState("");
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [owned, setOwned] = useState(false);
  const [tool, setTool] = useState<SpeechTool | "">("");
  const [cliPath, setCliPath] = useState("");
  const [args, setArgs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tool && cliPath.trim()) {
        await saveSpeechSettings({ tool, path: cliPath.trim(), args });
      }
      const result = await importLongVideo({
        videoPath: videoPath.trim(),
        title: title.trim() || undefined,
        transcript: transcript.trim() || undefined,
        ownershipConfirmed: owned,
      });
      onClose();
      navigate(`/projects/${result.projectId}/render`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Không nhập được video";
      setError(message.includes("phụ đề") || message.includes("nhận dạng") ? SPEECH_HINT : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-layer" role="presentation" onClick={onClose}>
      <form className="dialog form-stack" role="dialog" aria-label="Nhập video dài" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void onSubmit(event)}>
        <h2>Nhập video dài</h2>
        <label>Đường dẫn video (mp4, mov, mkv, tối đa 4 GB)
          <input aria-label="Đường dẫn video" value={videoPath} onChange={(event) => setVideoPath(event.target.value)} required />
        </label>
        <label>Tiêu đề
          <input aria-label="Tiêu đề video nhập" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>Phụ đề SRT hoặc VTT
          <textarea aria-label="Phụ đề" value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={6} />
        </label>
        <p className="field-hint">{SPEECH_HINT}</p>
        <label>Công cụ nhận dạng
          <select aria-label="Công cụ nhận dạng" value={tool} onChange={(event) => setTool(event.target.value as SpeechTool | "")}>
            <option value="">Không dùng</option>
            <option value="whisper">whisper</option>
            <option value="whisper.cpp">whisper.cpp</option>
            <option value="faster-whisper">faster-whisper</option>
          </select>
        </label>
        <label>Đường dẫn công cụ
          <input aria-label="Đường dẫn công cụ" value={cliPath} onChange={(event) => setCliPath(event.target.value)} />
        </label>
        <label>Tham số (có thể dùng {"{input}"} và {"{output}"})
          <input aria-label="Tham số công cụ" value={args} onChange={(event) => setArgs(event.target.value)} />
        </label>
        <label className="field-checkbox">
          <input type="checkbox" checked={owned} onChange={(event) => setOwned(event.target.checked)} />
          {OWNERSHIP_LABEL}
        </label>
        {error && <p className="request-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>Đóng</button>
          <button className="button button-primary" type="submit" disabled={busy || !owned}>{busy ? "Đang nhập…" : "Nhập video"}</button>
        </div>
      </form>
    </div>
  );
}
