import { wrapLines, type Project } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { usePipeline, pipelineKeys } from "../../hooks/usePipeline";
import { useScenes } from "../../hooks/useScenes";
import { runPipeline } from "../../services/pipelineApi";
import { downloadProjectSubtitle, getProjectSubtitles, patchProjectSubtitleCue } from "../../services/subtitlesApi";
import { getProjectVoice } from "../../services/voiceApi";

const subtitleKeys = { project: (projectId: string) => ["subtitles", projectId] as const };

function formatTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const rounded = Math.max(0, Math.round(safe * 1000));
  const hours = Math.floor(rounded / 3_600_000);
  const minutes = Math.floor((rounded % 3_600_000) / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1000);
  const ms = rounded % 1000;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0").slice(0, 1)}`;
}

export function SubtitlePanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const scenes = useScenes(project.id);
  const pipeline = usePipeline(project.id);
  const subtitles = useQuery({ queryKey: subtitleKeys.project(project.id), queryFn: () => getProjectSubtitles(project.id) });
  const voice = useQuery({ queryKey: ["voice", project.id], queryFn: () => getProjectVoice(project.id) });
  const [error, setError] = useState("");
  const sceneMap = new Map((scenes.data?.scenes ?? []).map((scene) => [scene.id, scene]));
  const stage = pipeline.data?.stages.find((record) => record.stage === "SUBTITLE");
  const canRun = stage?.state !== undefined && !pipeline.data?.activeJob && !pipeline.isMutating;
  const updateCue = useMutation({
    mutationFn: ({ index, text }: { index: number; text: string }) => patchProjectSubtitleCue(project.id, index, text),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: subtitleKeys.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Unable to save subtitle"),
  });

  if (scenes.isPending || subtitles.isPending || pipeline.isPending || voice.isPending) return <Spinner label="Loading subtitles" />;
  if (scenes.isError) return <ErrorState message={scenes.error.message} onRetry={() => void scenes.refetch()} />;
  if (subtitles.isError) return <ErrorState message={subtitles.error.message} onRetry={() => void subtitles.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;

  async function createSubtitles() {
    setError("");
    try {
      await runPipeline(project.id, "SUBTITLE");
      await queryClient.invalidateQueries({ queryKey: subtitleKeys.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to run subtitle stage");
    }
  }

  const cues = subtitles.data?.cues ?? [];
  const defaultMaxChars = { "16:9": 42, "9:16": 28, "1:1": 32 } as const;
  const maxChars = project.settings.subtitles.maxCharsPerLine ?? defaultMaxChars[project.settings.aspectRatio ?? "16:9"] ?? 42;
  const cueGroups = new Map<string, typeof cues>();
  for (const cue of cues) {
    const key = cue.sceneId ?? "unassigned";
    cueGroups.set(key, [...(cueGroups.get(key) ?? []), cue]);
  }
  return (
    <div className="subtitle-panel">
      {error && <p className="request-error" role="alert">{error}</p>}
      <section className="panel subtitle-header">
        <div>
          <p className="eyebrow">SUBTITLES</p>
          <h2>{cues.length} dòng · {project.settings.subtitles.enabled ? "đang bật" : "đã tắt"}</h2>
          <p>{subtitles.data?.totalDurationSec ? `${formatTime(subtitles.data.totalDurationSec)} tổng` : "Chưa có phụ đề"}</p>
        </div>
        <div className="voice-actions">
          <a className="button button-secondary" href={downloadProjectSubtitle(project.id, "srt")} target="_blank" rel="noreferrer">Tải .srt</a>
          <a className="button button-secondary" href={downloadProjectSubtitle(project.id, "ass")} target="_blank" rel="noreferrer">Tải .ass</a>
          <button className="button button-primary" type="button" disabled={!canRun} onClick={() => void createSubtitles()}>Tạo phụ đề</button>
        </div>
      </section>
      {cues.length === 0 ? (
        <section className="panel subtitle-empty"><h2>Chưa có phụ đề</h2><p>Chạy bước phụ đề để tạo phụ đề từ giọng đọc.</p></section>
      ) : (
        <div className="subtitle-list">
          {[...cueGroups.entries()].map(([sceneId, sceneCues]) => {
            const scene = sceneId === "unassigned" ? undefined : sceneMap.get(sceneId);
            return (
              <article className="panel subtitle-scene" key={sceneId}>
                <div className="voice-scene-heading">
                  <div><p className="eyebrow">{scene ? `SCENE ${scene.order + 1}` : "CUE"}</p><h3>{scene?.label ?? "Subtitle line"}</h3></div>
                </div>
                {sceneCues.map((cue) => {
                  const track = cue.sceneId ? voice.data?.tracks.find((item) => item.sceneId === cue.sceneId) : undefined;
                  const wrapped = wrapLines(cue.text, maxChars, 2);
                  const overLong = wrapped.length > 2 || wrapped.some((line) => line.length > maxChars);
                  return (
                    <div className="subtitle-cue" key={`${cue.sceneId ?? "scene"}-${cue.index ?? 0}-${cue.text}`}>
                      <div className="subtitle-row">
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            if (!track || !cue.sceneId) return;
                            const audio = new Audio(`/api/projects/${project.id}/voice/${track.id}/audio`);
                            audio.currentTime = cue.startSec;
                            void audio.play();
                          }}
                          aria-label={`Play subtitle cue ${cue.index ?? 0}`}
                        >▶</button>
                        <span className="subtitle-time">{formatTime(cue.startSec)} → {formatTime(cue.endSec)}</span>
                        <input
                          defaultValue={cue.text}
                          onBlur={(event) => {
                            const nextValue = event.currentTarget.value.trim();
                            if (nextValue === cue.text) return;
                            updateCue.mutate({ index: cue.index ?? 0, text: nextValue || cue.text });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              const nextValue = (event.currentTarget as HTMLInputElement).value.trim();
                              if (nextValue !== cue.text) updateCue.mutate({ index: cue.index ?? 0, text: nextValue || cue.text });
                            }
                          }}
                          aria-label={`Edit subtitle text ${cue.index ?? 0}`}
                        />
                        {cue.edited && <span className="voice-origin user">đã sửa</span>}
                      </div>
                      {overLong && <small className="field-error">Dòng dài hơn {maxChars} ký tự</small>}
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
