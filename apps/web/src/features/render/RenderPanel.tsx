import type { Project, RenderIssueCode, RenderVariantAspect, RenderVersion } from "@vg/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { pipelineKeys, usePipeline } from "../../hooks/usePipeline";
import {
  getProjectRender,
  listProjectRenders,
  renderFileUrl,
  renderThumbUrl,
  startProjectRender,
  startProjectRenderVariants,
} from "../../services/renderApi";
import { getProjectTimeline } from "../../services/timelineApi";
import { AutoReportPanel } from "./AutoReportPanel";
import { MetadataPanel } from "./MetadataPanel";
import { RenderHistory, renderHistoryKeys } from "./RenderHistory";

const renderKeys = { project: (projectId: string) => ["render", projectId] as const };

const ISSUE_LABEL: Record<RenderIssueCode, string> = {
  DURATION_MISMATCH: "Lệch thời lượng",
  SIZE_MISMATCH: "Sai kích thước",
  NO_VIDEO: "Không có hình",
  NO_AUDIO: "Không có tiếng",
  BLACK_FRAMES: "Khung đen",
  THUMBNAIL_FAILED: "Lỗi ảnh xem trước",
  FRAME_MISMATCH: "Frame không khớp",
  SUBTITLE_ILLEGIBLE: "Phụ đề khó đọc",
  RENDER_VISION_FAILED: "Lỗi AI nhìn sau render",
  VERTICAL_TOO_LONG: "Bản dọc quá dài",
};

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RenderPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const projectAspect: RenderVariantAspect = project.settings.aspectRatio === "9:16" ? "9:16" : "16:9";
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [format, setFormat] = useState<RenderVariantAspect>(projectAspect);
  const [variantsBusy, setVariantsBusy] = useState(false);
  // Variant renders run in the background on the server: poll the history until this many finished renders exist.
  const [variantsTarget, setVariantsTarget] = useState<{ count: number; until: number } | null>(null);
  const pipeline = usePipeline(project.id);
  const render = useQuery({ queryKey: renderKeys.project(project.id), queryFn: () => getProjectRender(project.id) });
  const history = useQuery({
    queryKey: renderHistoryKeys.list(project.id),
    queryFn: () => listProjectRenders(project.id),
    refetchInterval: variantsTarget ? 5000 : false,
  });
  const timeline = useQuery({ queryKey: ["timeline", project.id], queryFn: () => getProjectTimeline(project.id) });

  const stage = pipeline.data?.stages.find((record) => record.stage === "RENDER");
  const rendering = pipeline.data?.activeJob?.stage === "RENDER" || stage?.state === "RUNNING" || stage?.state === "QUEUED";
  const wasRendering = useRef(false);
  useEffect(() => {
    // Reload the render once the job ends, so the player shows the new file.
    if (wasRendering.current && !rendering) {
      void queryClient.invalidateQueries({ queryKey: renderKeys.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: renderHistoryKeys.list(project.id) });
    }
    wasRendering.current = Boolean(rendering);
  }, [rendering, project.id, queryClient]);

  useEffect(() => {
    const current = render.data?.render?.id ?? null;
    if (!current) return;
    setSelectedId((prev) => prev && history.data?.renders.some((item) => item.id === prev && !item.deleted) ? prev : current);
  }, [render.data?.render?.id, history.data?.renders]);

  useEffect(() => {
    if (!variantsTarget) return;
    const done = history.data?.renders.filter((item) => item.status === "DONE" && !item.deleted).length ?? 0;
    if (done >= variantsTarget.count || Date.now() > variantsTarget.until) {
      setVariantsTarget(null);
      void queryClient.invalidateQueries({ queryKey: renderKeys.project(project.id) });
    }
  }, [history.data?.renders, variantsTarget, project.id, queryClient]);

  if (render.isPending || pipeline.isPending || timeline.isPending || history.isPending) return <Spinner label="Đang tải render" />;
  if (render.isError) return <ErrorState message={render.error.message} onRetry={() => void render.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;
  if (timeline.isError) return <ErrorState message={timeline.error.message} onRetry={() => void timeline.refetch()} />;
  if (history.isError) return <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />;

  const versions = history.data.renders;
  const selected: RenderVersion | null = versions.find((item) => item.id === selectedId && !item.deleted)
    ?? versions.find((item) => item.id === render.data.render?.id && !item.deleted)
    ?? null;
  const data = selected ?? (render.data.render
    ? {
        ...render.data.render,
        version: 0,
        note: null,
        pinned: false,
        deleted: false,
        reviewThreadId: null,
        hasMetadata: false,
      }
    : null);
  const scenes = timeline.data.timeline?.scenes ?? [];
  const hasTimeline = Boolean(timeline.data.timeline);
  const canRun = hasTimeline && Boolean(stage) && !pipeline.data.activeJob && !pipeline.isMutating && !variantsBusy && !variantsTarget;
  const progress = Math.round(stage?.progress ?? 0);
  const useVersionUrls = Boolean(selected);
  const playerVertical = (data?.aspectRatio ?? (data && data.height > data.width ? "9:16" : "16:9")) === "9:16";

  async function runStage() {
    setError("");
    try {
      await startProjectRender(project.id, format);
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thực hiện được yêu cầu");
    }
  }

  async function runAllFormats() {
    setError("");
    setVariantsBusy(true);
    try {
      const result = await startProjectRenderVariants(project.id);
      if (result.queued.length) {
        const done = history.data?.renders.filter((item) => item.status === "DONE" && !item.deleted).length ?? 0;
        setVariantsTarget({ count: done + result.queued.length, until: Date.now() + 30 * 60_000 });
      }
      await queryClient.invalidateQueries({ queryKey: renderKeys.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: renderHistoryKeys.list(project.id) });
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không render được mọi định dạng");
    } finally {
      setVariantsBusy(false);
    }
  }

  const statusLine = rendering
    ? `Đang render ${progress}%${stage?.message ? ` · ${stage.message}` : ""}`
    : stage?.state === "FAILED"
      ? `Render lỗi: ${stage.error?.message ?? stage.message ?? "không rõ"}`
      : stage?.state === "STALE" && data
        ? "Timeline đã đổi — bản render này đã cũ, hãy render lại."
        : stage?.message ?? "";

  return (
    <div className="render-panel">
      {error && <p className="request-error" role="alert">{error}</p>}
      <section className="panel render-header">
        <div>
          <p className="eyebrow">RENDER</p>
          <h2>{data ? `${clock(data.durationSec)} · ${data.width}×${data.height} · ${megabytes(data.sizeBytes)}` : "Chưa có video"}</h2>
          <p>
            {hasTimeline
              ? statusLine || "Ghép hình, giọng, nhạc và phụ đề thành một tệp MP4 bằng FFmpeg."
              : "Chưa có timeline — hoàn tất tab Timeline trước khi render."}
          </p>
          {rendering && (
            <div className="render-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
        <div className="render-actions">
          <label className="render-format">
            <span>Định dạng</span>
            <select
              aria-label="Định dạng"
              value={format}
              disabled={!canRun && !rendering}
              onChange={(event) => setFormat(event.target.value as RenderVariantAspect)}
            >
              <option value="16:9">Ngang 16:9{projectAspect === "16:9" ? " (mặc định)" : ""}</option>
              <option value="9:16">Dọc 9:16{projectAspect === "9:16" ? " (mặc định)" : ""}</option>
            </select>
          </label>
          <button className="button button-primary" type="button" disabled={!canRun} onClick={() => void runStage()}>
            {data ? "Render lại" : "Render"}
          </button>
          {project.profileId && (
            <button
              className="button button-secondary"
              type="button"
              disabled={!canRun}
              onClick={() => void runAllFormats()}
            >
              {variantsBusy || variantsTarget ? "Đang render các định dạng…" : "Render cho mọi tài khoản của hồ sơ"}
            </button>
          )}
          {data && (
            <>
              <a className="button button-secondary" href={renderFileUrl(project.id, "video", data.id, true, useVersionUrls)} download>Tải video</a>
              {data.hasCredits && <a className="button button-secondary" href={renderFileUrl(project.id, "credits", data.id, false, useVersionUrls)} download>Tải credits</a>}
              {data.hasSubtitles && <a className="button button-secondary" href={renderFileUrl(project.id, "subtitles", data.id, false, useVersionUrls)} download>Tải phụ đề</a>}
            </>
          )}
        </div>
      </section>

      {data && (
        <>
          <section className={`panel render-player${playerVertical ? " is-vertical" : ""}`}>
            <video key={data.id} controls preload="metadata" src={renderFileUrl(project.id, "video", data.id, false, useVersionUrls)} aria-label="Video đã render" />
          </section>
          <RenderHistory
            projectId={project.id}
            projectTitle={project.title}
            renders={versions}
            selectedId={data.id}
            onSelect={setSelectedId}
          />
          <MetadataPanel project={project} />
          <AutoReportPanel project={project} />
          <section className={`panel render-report${data.report.ok ? "" : " has-errors"}`} aria-label="Kiểm tra video">
            <h3>
              {data.report.ok ? "Kiểm tra: đạt" : "Kiểm tra: có lỗi"}
              {data.report.issues.length ? ` · ${data.report.issues.length} vấn đề` : ""}
            </h3>
            <p>
              Thời lượng {data.report.durationSec.toFixed(2)}s / timeline {data.report.expectedDurationSec.toFixed(2)}s
              {" · "}{data.report.hasAudio ? "có tiếng" : "không có tiếng"}
              {" · "}{data.report.clipsRendered} cảnh dựng mới, {data.report.clipsReused} dùng lại
              {" · "}{data.report.elapsedSec.toFixed(1)}s
            </p>
            {data.report.issues.length > 0 && (
              <ul>
                {data.report.issues.map((issue, index) => (
                  <li key={`${issue.code}-${issue.sceneId ?? "all"}-${index}`} className={issue.severity === "ERROR" ? "error" : "warn"}>
                    <strong>{ISSUE_LABEL[issue.code] ?? issue.code}</strong> {issue.message}
                    {issue.sceneId && (issue.code === "FRAME_MISMATCH" || issue.code === "SUBTITLE_ILLEGIBLE" || issue.code === "BLACK_FRAMES") && (
                      <>
                        {" · "}
                        <Link to={`/projects/${project.id}?tab=visuals&scene=${issue.sceneId}`}>Sửa scene này</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.report.thumbnails.length > 0 && (
            <section className="panel render-thumbs" aria-label="Ảnh xem trước từng cảnh">
              {data.report.thumbnails.map((sceneId) => {
                const scene = scenes.find((item) => item.sceneId === sceneId);
                const label = scene ? `${scene.order + 1}. ${scene.label}` : sceneId;
                return (
                  <figure key={sceneId}>
                    <img src={renderThumbUrl(project.id, sceneId, data.id, useVersionUrls)} alt={label} loading="lazy" />
                    <figcaption>{label}</figcaption>
                  </figure>
                );
              })}
            </section>
          )}
        </>
      )}

      {!data && (
        <>
          <MetadataPanel project={project} />
          <AutoReportPanel project={project} />
        </>
      )}
    </div>
  );
}
