import type { Project, ThumbnailPosition, ThumbnailState } from "@vg/shared";
import { thumbnailUploadError } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiRequestError } from "../../services/apiClient";
import {
  getThumbnail,
  recomposeThumbnail,
  regenerateThumbnail,
  thumbnailImageUrl,
  uploadThumbnail,
} from "../../services/thumbnailApi";

const POSITIONS: { value: ThumbnailPosition; label: string }[] = [
  { value: "top", label: "Trên" },
  { value: "center", label: "Giữa" },
  { value: "bottom", label: "Dưới" },
];

export function ThumbnailCard({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["thumbnail", project.id],
    queryFn: () => getThumbnail(project.id),
  });
  const [text, setText] = useState("");
  const [position, setPosition] = useState<ThumbnailPosition>("bottom");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query.data?.meta) return;
    setText(query.data.meta.text);
    setPosition(query.data.meta.position);
  }, [query.data?.meta]);

  const refresh = async (next: ThumbnailState) => {
    queryClient.setQueryData(["thumbnail", project.id], next);
    await queryClient.invalidateQueries({ queryKey: ["project", project.id] });
  };

  const recompose = useMutation({
    mutationFn: (frameId: string) => recomposeThumbnail(project.id, { frameId, text, position }),
    onSuccess: async (next) => {
      setError("");
      await refresh(next);
    },
    onError: (err) => setError(messageOf(err)),
  });

  const regenerate = useMutation({
    mutationFn: () => regenerateThumbnail(project.id),
    onSuccess: async (next) => {
      setError("");
      await refresh(next);
    },
    onError: (err) => setError(messageOf(err)),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadThumbnail(project.id, file),
    onSuccess: async (next) => {
      setError("");
      await refresh(next);
    },
    onError: (err) => setError(messageOf(err)),
  });

  const data = query.data;
  const bust = data?.meta ? `${data.meta.frameTimeSec}-${data.meta.source}-${data.meta.text}` : "0";

  return (
    <section className="panel" aria-label="Thumbnail" style={{ marginTop: "0.75rem" }}>
      <h3>Thumbnail</h3>
      {query.isLoading ? <p className="page-subtitle">Đang tải thumbnail…</p> : null}
      {error && <p className="request-error" role="alert">{error}</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
        <figure style={{ margin: 0 }}>
          <figcaption>YouTube 16:9</figcaption>
          {data?.hasLandscape
            ? <img alt="Thumbnail ngang" src={thumbnailImageUrl(project.id, "landscape", bust)} style={{ width: 240, height: 135, objectFit: "cover" }} />
            : <p className="page-subtitle">Chưa có ảnh ngang.</p>}
        </figure>
        <figure style={{ margin: 0 }}>
          <figcaption>Bìa dọc</figcaption>
          {data?.hasCover
            ? <img alt="Ảnh bìa dọc" src={thumbnailImageUrl(project.id, "cover", bust)} style={{ width: 120, height: 213, objectFit: "cover" }} />
            : <p className="page-subtitle">Chưa có ảnh dọc.</p>}
        </figure>
      </div>
      {data && (data.candidates?.length ?? 0) > 0 && (
        <div
          role="list"
          aria-label="Khung hình"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: "0.5rem", marginTop: "0.75rem" }}
        >
          {data.candidates.map((frame) => (
            <button
              key={frame.id}
              type="button"
              className="button button-secondary"
              aria-label={`Chọn khung ${frame.timeSec} giây`}
              disabled={recompose.isPending}
              onClick={() => recompose.mutate(frame.id)}
            >
              <img
                alt=""
                src={thumbnailImageUrl(project.id, frame.id, String(frame.timeSec))}
                style={{ width: "100%", height: 64, objectFit: "cover", display: "block" }}
              />
              <span>{frame.timeSec.toFixed(1)}s</span>
            </button>
          ))}
        </div>
      )}
      <div className="form-row" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.75rem" }}>
        <label className="form-field">
          <span>Chữ trên ảnh</span>
          <input
            aria-label="Chữ trên ảnh"
            value={text}
            maxLength={32}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Vị trí</span>
          <select
            aria-label="Vị trí chữ"
            value={position}
            onChange={(event) => setPosition(event.target.value as ThumbnailPosition)}
          >
            {POSITIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button
          className="button"
          type="button"
          disabled={recompose.isPending || !(data?.candidates?.length)}
          onClick={() => {
            const frameId = data?.meta?.frameId ?? data?.candidates?.[0]?.id;
            if (frameId) recompose.mutate(frameId);
          }}
        >
          Tạo lại
        </button>
        <button className="button button-secondary" type="button" disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
          Tạo lại tự động
        </button>
        <label className="button button-secondary">
          Tải ảnh lên
          <input
            aria-label="Tải ảnh lên"
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const problem = thumbnailUploadError({ type: file.type, size: file.size });
              if (problem) {
                setError(problem);
                return;
              }
              upload.mutate(file);
            }}
          />
        </label>
      </div>
      {data?.meta && (
        <p className="field-hint">Nguồn: {data.meta.source === "manual" ? "thủ công" : data.meta.source === "ai" ? "AI" : "tự động"} · {data.meta.frameTimeSec.toFixed(1)}s</p>
      )}
    </section>
  );
}

function messageOf(error: unknown): string {
  return error instanceof ApiRequestError || error instanceof Error ? error.message : "Không tạo được thumbnail";
}
