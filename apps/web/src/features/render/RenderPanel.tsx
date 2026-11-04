import type { Project, RenderIssueCode } from "@vg/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { pipelineKeys, usePipeline } from "../../hooks/usePipeline";
import { runPipeline } from "../../services/pipelineApi";
import { getProjectRender, renderFileUrl, renderThumbUrl } from "../../services/renderApi";
import { getProjectTimeline } from "../../services/timelineApi";

const renderKeys = { project: (projectId: string) => ["render", projectId] as const };

const ISSUE_LABEL: Record<RenderIssueCode, string> = {
  DURATION_MISMATCH: "Lệch thời lượng",
  SIZE_MISMATCH: "Sai kích thước",
  NO_VIDEO: "Không có hình",
  NO_AUDIO: "Không có tiếng",
  BLACK_FRAMES: "Khung đen",
  THUMBNAIL_FAILED: "Lỗi ảnh xem trước",
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
  const [error, setError] = useState("");
  const pipeline = usePipeline(project.id);
  const render = useQuery({ queryKey: renderKeys.project(project.id), queryFn: () => getProjectRender(project.id) });
  const timeline = useQuery({ queryKey: ["timeline", project.id], queryFn: () => getProjectTimeline(project.id) });

  const stage = pipeline.data?.stages.find((record) => record.stage === "RENDER");
  const rendering = pipeline.data?.activeJob?.stage === "RENDER" || stage?.state === "RUNNING" || stage?.state === "QUEUED";
  const wasRendering = useRef(false);
  useEffect(() => {
    // Reload the render once the job ends, so the player shows the new file.
    if (wasRendering.current && !rendering) void queryClient.invalidateQueries({ queryKey: renderKeys.project(project.id) });
    wasRendering.current = Boolean(rendering);
  }, [rendering, project.id, queryClient]);

  if (render.isPending || pipeline.isPending || timeline.isPending) return <Spinner label="Đang tải render" />;
  if (render.isError) return <ErrorState message={render.error.message} onRetry={() => void render.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;
  if (timeline.isError) return <ErrorState message={timeline.error.message} onRetry={() => void timeline.refetch()} />;

  const data = render.data.render;
  const scenes = timeline.data.timeline?.scenes ?? [];
  const hasTimeline = Boolean(timeline.data.timeline);
  const canRun = hasTimeline && Boolean(stage) && !pipeline.data.activeJob && !pipeline.isMutating;
  const progress = Math.round(stage?.progress ?? 0);

  async function runStage() {
    setError("");
    try {
      await runPipeline(project.id, "RENDER");
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thực hiện được yêu cầu");
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
          <button className="button button-primary" type="button" disabled={!canRun} onClick={() => void runStage()}>
            {data ? "Render lại" : "Render"}
          </button>
          {data && (
            <>
              <a className="button button-secondary" href={renderFileUrl(project.id, "video", data.id, true)} download>Tải video</a>
              {data.hasCredits && <a className="button button-secondary" href={renderFileUrl(project.id, "credits", data.id)} download>Tải credits</a>}
              {data.hasSubtitles && <a className="button button-secondary" href={renderFileUrl(project.id, "subtitles", data.id)} download>Tải phụ đề</a>}
            </>
          )}
        </div>
      </section>

      {data && (
        <>
          <section className="panel render-player">
            <video key={data.id} controls preload="metadata" src={renderFileUrl(project.id, "video", data.id)} aria-label="Video đã render" />
          </section>
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
                    <img src={renderThumbUrl(project.id, sceneId, data.id)} alt={label} loading="lazy" />
                    <figcaption>{label}</figcaption>
                  </figure>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}
