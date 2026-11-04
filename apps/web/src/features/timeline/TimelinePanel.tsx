import type { Project, Timeline, TimelineWarningCode } from "@vg/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { pipelineKeys, usePipeline } from "../../hooks/usePipeline";
import { approvePipelineGate, runPipeline } from "../../services/pipelineApi";
import { getProjectTimeline } from "../../services/timelineApi";

const timelineKeys = { project: (projectId: string) => ["timeline", projectId] as const };

function clock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

const WARNING_LABEL: Record<TimelineWarningCode, string> = {
  VISUAL_MISSING: "Thiếu hình",
  VISUAL_NOT_APPROVED: "Hình chưa duyệt",
  MUSIC_NOT_READY: "Nhạc chưa sẵn sàng",
  DURATION_OVERRIDE_TOO_SHORT: "Thời lượng đặt tay quá ngắn",
  LICENSE_UNKNOWN: "License chưa rõ",
  LICENSE_NON_COMMERCIAL: "License phi thương mại",
};

function pct(value: number, total: number): string {
  return `${total > 0 ? (value / total) * 100 : 0}%`;
}

function Tracks({ timeline }: { timeline: Timeline }) {
  const total = timeline.totalDurationSec;
  return (
    <section className="panel timeline-tracks" aria-label="Các track">
      <div className="timeline-track">
        <span className="timeline-track-label">Hình</span>
        <div className="timeline-lane">
          {timeline.scenes.flatMap((scene) => scene.visuals.map((visual, index) => (
            <span
              key={`${scene.sceneId}-${index}`}
              className={`timeline-block visual${visual.kind === "PLACEHOLDER" ? " placeholder" : ""}`}
              style={{ left: pct(visual.startSec, total), width: pct(visual.endSec - visual.startSec, total) }}
              title={`${scene.label} · ${visual.kind === "PLACEHOLDER" ? "Ảnh tạm" : "Ảnh"}`}
            />
          )))}
        </div>
      </div>
      <div className="timeline-track">
        <span className="timeline-track-label">Giọng</span>
        <div className="timeline-lane">
          {timeline.scenes.map((scene) => scene.voice && (
            <span
              key={scene.sceneId}
              className="timeline-block voice"
              style={{ left: pct(scene.voice.startSec, total), width: pct(scene.voice.durationSec, total) }}
              title={`${scene.label} · ${scene.voice.durationSec.toFixed(1)}s`}
            />
          ))}
        </div>
      </div>
      <div className="timeline-track">
        <span className="timeline-track-label">Nhạc</span>
        <div className="timeline-lane">
          {timeline.music && (
            <span className="timeline-block music" style={{ left: 0, width: "100%" }} title={timeline.music.title}>
              {timeline.music.title}{timeline.music.loop ? " · lặp" : ""}
            </span>
          )}
        </div>
      </div>
      <div className="timeline-track">
        <span className="timeline-track-label">Phụ đề</span>
        <div className="timeline-lane">
          {timeline.subtitles && (
            <span className="timeline-block subtitle" style={{ left: 0, width: "100%" }}>{timeline.subtitles.cueCount} dòng</span>
          )}
        </div>
      </div>
    </section>
  );
}

export function TimelinePanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const pipeline = usePipeline(project.id);
  const timeline = useQuery({ queryKey: timelineKeys.project(project.id), queryFn: () => getProjectTimeline(project.id) });

  if (timeline.isPending || pipeline.isPending) return <Spinner label="Đang tải timeline" />;
  if (timeline.isError) return <ErrorState message={timeline.error.message} onRetry={() => void timeline.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;

  const data = timeline.data.timeline;
  const stage = pipeline.data.stages.find((record) => record.stage === "TIMELINE");
  const gate = pipeline.data.stages.find((record) => record.stage === "FINAL_APPROVAL");
  const canRun = Boolean(stage) && !pipeline.data.activeJob && !pipeline.isMutating;
  const onError = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Không thực hiện được yêu cầu");

  async function runStage() {
    setError("");
    try {
      await runPipeline(project.id, "TIMELINE");
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
      await timeline.refetch();
    } catch (reason) {
      onError(reason);
    }
  }

  async function approveGate() {
    setError("");
    try {
      const next = await approvePipelineGate(project.id, "FINAL_APPROVAL");
      queryClient.setQueryData(pipelineKeys.detail(project.id), next);
    } catch (reason) {
      onError(reason);
    }
  }

  const licenses = data ? Object.entries(data.licenseSummary) : [];

  return (
    <div className="timeline-panel">
      {error && <p className="request-error" role="alert">{error}</p>}
      <section className="panel timeline-header">
        <div>
          <p className="eyebrow">TIMELINE</p>
          <h2>{data ? `${clock(data.totalDurationSec)} · ${data.scenes.length} cảnh` : "Chưa có timeline"}</h2>
          <p>
            {data
              ? `${data.target.width}×${data.target.height} · ${data.target.fps} fps${stage?.message ? ` · ${stage.message}` : ""}`
              : "Chạy bước Timeline để ghép giọng, hình, nhạc và phụ đề lên một trục thời gian."}
          </p>
        </div>
        <div className="timeline-header-actions">
          <button className="button button-secondary" type="button" disabled={!canRun} onClick={() => void runStage()}>Chạy bước Timeline</button>
          {gate?.state === "WAITING_USER" && (
            <button className="button button-primary" type="button" disabled={!data || Boolean(pipeline.data.activeJob)} onClick={() => void approveGate()}>
              Duyệt &amp; render
            </button>
          )}
        </div>
      </section>

      {data && (
        <>
          {data.warnings.length > 0 && (
            <section className="panel timeline-warnings" aria-label="Cảnh báo">
              <h3>Cảnh báo ({data.warnings.length}) — không chặn render</h3>
              <ul>
                {data.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.sceneId ?? "all"}-${index}`}>
                    <strong>{WARNING_LABEL[warning.code] ?? warning.code}</strong> {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {licenses.length > 0 && (
            <p className="timeline-licenses">License: {licenses.map(([kind, count]) => `${kind} ×${count}`).join(" · ")}</p>
          )}
          <Tracks timeline={data} />
          <section className="panel timeline-scenes">
            <table>
              <thead>
                <tr><th>#</th><th>Cảnh</th><th>Bắt đầu</th><th>Dài</th><th>Giọng</th><th>Hình</th></tr>
              </thead>
              <tbody>
                {data.scenes.map((scene) => (
                  <tr key={scene.sceneId}>
                    <td>{scene.order + 1}</td>
                    <td>{scene.label}</td>
                    <td>{clock(scene.startSec)}</td>
                    <td>{scene.durationSec.toFixed(1)}s</td>
                    <td>{scene.voice ? `${scene.voice.durationSec.toFixed(1)}s` : "Im lặng"}</td>
                    <td>{scene.visuals.filter((visual) => visual.kind === "IMAGE").length}/{scene.visuals.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
