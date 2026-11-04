import type { RenderVersion } from "@vg/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteProjectRender, patchProjectRender, renderExportUrl, renderFileUrl } from "../../services/renderApi";

const renderKeys = {
  project: (projectId: string) => ["render", projectId] as const,
  list: (projectId: string) => ["renders", projectId] as const,
};

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

function compareSummary(current: RenderVersion, previous: RenderVersion | undefined): string | null {
  if (!previous) return null;
  const parts: string[] = [];
  const durationDelta = current.durationSec - previous.durationSec;
  if (Math.abs(durationDelta) >= 0.05) {
    parts.push(`thời lượng ${durationDelta > 0 ? "+" : ""}${durationDelta.toFixed(1)}s`);
  }
  const issueDelta = current.report.issues.length - previous.report.issues.length;
  if (issueDelta !== 0) parts.push(`vấn đề ${issueDelta > 0 ? "+" : ""}${issueDelta}`);
  const reuseDelta = current.report.clipsReused - previous.report.clipsReused;
  if (reuseDelta !== 0) parts.push(`clip dùng lại ${reuseDelta > 0 ? "+" : ""}${reuseDelta}`);
  if (current.hasMetadata && previous.hasMetadata) {
    parts.push("metadata có thể đã đổi");
  }
  return parts.length ? `So với v${previous.version}: ${parts.join(", ")}` : `So với v${previous.version}: không khác biệt lớn`;
}

export function RenderHistory({
  projectId,
  projectTitle,
  renders,
  selectedId,
  onSelect,
}: {
  projectId: string;
  projectTitle: string;
  renders: RenderVersion[];
  selectedId: string | null;
  onSelect: (renderId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const patch = useMutation({
    mutationFn: ({ renderId, body }: { renderId: string; body: { note?: string | null; pinned?: boolean } }) =>
      patchProjectRender(projectId, renderId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: renderKeys.list(projectId) });
      await queryClient.invalidateQueries({ queryKey: renderKeys.project(projectId) });
    },
  });

  const remove = useMutation({
    mutationFn: (renderId: string) => deleteProjectRender(projectId, renderId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: renderKeys.list(projectId) });
      await queryClient.invalidateQueries({ queryKey: renderKeys.project(projectId) });
    },
  });

  if (renders.length === 0) return null;

  return (
    <section className="panel render-history" aria-label="Lịch sử bản render">
      <h3>Lịch sử bản render</h3>
      {error && <p className="request-error" role="alert">{error}</p>}
      <ul className="render-history-list">
        {renders.map((item, index) => {
          const previous = renders[index + 1];
          const note = draftNotes[item.id] ?? item.note ?? "";
          const compare = compareSummary(item, previous);
          const rowClass = [
            "render-history-row",
            item.id === selectedId ? "is-selected" : "",
            item.deleted ? "is-deleted" : "",
          ].filter(Boolean).join(" ");
          return (
            <li key={item.id} className={rowClass}>
              <div className="render-history-main">
                <p className="render-history-meta">
                  <strong>v{item.version}</strong>
                  {" · "}{shortDate(item.createdAt)}
                  {" · "}{clock(item.durationSec)}
                  {" · "}{megabytes(item.sizeBytes)}
                </p>
                <p className="render-history-badges">
                  {item.deleted
                    ? <span className="render-badge deleted">Đã xoá file</span>
                    : item.report.ok
                      ? <span className="render-badge ok">OK</span>
                      : <span className="render-badge issues">Có vấn đề</span>}
                  {item.pinned && <span className="render-badge pinned">Ghim</span>}
                </p>
                {compare && <p className="render-history-compare">{compare}</p>}
                {!item.deleted && (
                  <label className="render-history-note">
                    <span>Ghi chú</span>
                    <input
                      value={note}
                      maxLength={500}
                      placeholder="Ghi chú ngắn…"
                      onChange={(event) => setDraftNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                      onBlur={() => {
                        const next = draftNotes[item.id];
                        if (next === undefined || next === (item.note ?? "")) return;
                        setError("");
                        patch.mutate({ renderId: item.id, body: { note: next || null } }, {
                          onError: (reason) => setError(reason instanceof Error ? reason.message : "Không lưu được ghi chú"),
                        });
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="render-history-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={item.deleted}
                  onClick={() => onSelect(item.id)}
                >
                  Xem
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={item.pinned ? "Bỏ ghim" : "Ghim"}
                  disabled={item.deleted || patch.isPending}
                  onClick={() => {
                    setError("");
                    patch.mutate({ renderId: item.id, body: { pinned: !item.pinned } }, {
                      onError: (reason) => setError(reason instanceof Error ? reason.message : "Không ghim được"),
                    });
                  }}
                >
                  {item.pinned ? "★" : "☆"}
                </button>
                {!item.deleted && (
                  <>
                    <a className="button button-secondary" href={renderFileUrl(projectId, "video", item.id, true, true)} download>
                      Tải MP4
                    </a>
                    <a className="button button-secondary" href={renderExportUrl(projectId, item.id)} download={`${projectTitle} - v${item.version}.zip`}>
                      Xuất gói (.zip)
                    </a>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (!window.confirm(`Xoá file của bản v${item.version}?`)) return;
                        setError("");
                        remove.mutate(item.id, {
                          onError: (reason) => setError(reason instanceof Error ? reason.message : "Không xoá được"),
                        });
                      }}
                    >
                      Xoá
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export { renderKeys as renderHistoryKeys };
