import type { Project, VoiceTrack } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { usePipeline, pipelineKeys } from "../../hooks/usePipeline";
import { useScenes } from "../../hooks/useScenes";
import { runPipeline } from "../../services/pipelineApi";
import { getProjectVoice, regenerateVoice, uploadVoice } from "../../services/voiceApi";

const voiceKeys = { project: (projectId: string) => ["voice", projectId] as const };

function formatDuration(seconds: number): string {
  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  return `${minutes}:${String(roundedSeconds % 60).padStart(2, "0")}`;
}

function audioUrl(projectId: string, track: VoiceTrack): string {
  return `/api/projects/${projectId}/voice/${track.id}/audio`;
}

export function VoicePanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const scenes = useScenes(project.id);
  const pipeline = usePipeline(project.id);
  const voice = useQuery({ queryKey: voiceKeys.project(project.id), queryFn: () => getProjectVoice(project.id) });
  const stage = pipeline.data?.stages.find((record) => record.stage === "VOICE");
  const tracksByScene = new Map((voice.data?.tracks ?? []).map((track) => [track.sceneId, track]));
  const refreshVoice = () => queryClient.invalidateQueries({ queryKey: voiceKeys.project(project.id) });
  const refreshPipeline = () => queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
  const regenerate = useMutation({
    mutationFn: (sceneId: string) => regenerateVoice(project.id, sceneId),
    onSuccess: () => { void refreshVoice(); void refreshPipeline(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Unable to regenerate voice"),
  });
  const upload = useMutation({
    mutationFn: ({ sceneId, file }: { sceneId: string; file: File }) => uploadVoice(project.id, sceneId, file),
    onSuccess: () => { void refreshVoice(); void refreshPipeline(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Unable to upload voice"),
  });
  const canRun = stage?.state !== undefined && !pipeline.data?.activeJob && !pipeline.isMutating;

  if (scenes.isPending || voice.isPending || pipeline.isPending) return <Spinner label="Loading voice tracks" />;
  if (scenes.isError) return <ErrorState message={scenes.error.message} onRetry={() => void scenes.refetch()} />;
  if (voice.isError) return <ErrorState message={voice.error.message} onRetry={() => void voice.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;

  const narratedScenes = scenes.data.scenes.filter((scene) => scene.narration.trim());
  async function createVoice() {
    setError("");
    try {
      await runPipeline(project.id, "VOICE");
      await refreshPipeline();
      await refreshVoice();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to run the voice stage");
    }
  }

  return (
    <div className="voice-panel">
      {error && <p className="request-error" role="alert">{error}</p>}
      <section className="panel voice-header">
        <div>
          <p className="eyebrow">VOICE TRACKS</p>
          <h2>{voice.data.tracks.length} / {narratedScenes.length} scenes · {formatDuration(voice.data.totalDurationSec)}</h2>
          <p>{voice.data.voice ?? "Mặc định"} · {voice.data.rate ?? "+0%"}</p>
        </div>
        <button className="button button-primary" type="button" disabled={!canRun} onClick={() => void createVoice()}>
          Tạo giọng đọc
        </button>
      </section>
      {narratedScenes.length === 0 ? (
        <section className="panel voice-empty"><h2>Chưa có lời thoại</h2><p>Thêm lời thoại cho các cảnh trước khi tạo giọng đọc.</p></section>
      ) : (
        <div className="voice-scene-list">
          {narratedScenes.map((scene) => {
            const track = tracksByScene.get(scene.id);
            const estimate = scene.estDurationSec;
            const durationMismatch = Boolean(track && estimate > 0 && Math.abs(track.durationSec - estimate) / estimate > 0.3);
            return (
              <article className="panel voice-scene" key={scene.id}>
                <div className="voice-scene-heading">
                  <div><p className="eyebrow">SCENE {scene.order + 1}</p><h3>{scene.label}</h3></div>
                  {track && <span className={`voice-origin ${track.origin === "USER" ? "user" : "agent"}`}>{track.origin === "USER" ? "Của bạn" : "AI"}</span>}
                </div>
                <details className="voice-narration">
                  <summary><span>Lời thoại</span><span className="voice-narration-preview">{scene.narration}</span></summary>
                  <p>{scene.narration}</p>
                </details>
                {track ? (
                  <>
                    <audio controls preload="metadata" src={audioUrl(project.id, track)} aria-label={`Voice for ${scene.label}`} />
                    <p className={durationMismatch ? "voice-duration warning" : "voice-duration"}>
                      {formatDuration(track.durationSec)} · ước tính cảnh {formatDuration(estimate)}
                      {durationMismatch && <span role="alert"> · Chênh lệch lớn hơn 30%</span>}
                    </p>
                    <small>{track.provider} · {track.voice} · {track.rate}{(track.timingSource === "provider" || track.timingSource === "aligned") ? " · Có mốc thời gian từng từ" : ""}</small>
                  </>
                ) : <p className="voice-missing">Chưa có giọng đọc</p>}
                <div className="voice-actions">
                  <button className="button button-secondary" type="button" disabled={regenerate.isPending} onClick={() => regenerate.mutate(scene.id)}>Tạo lại</button>
                  <label className="button button-secondary voice-upload">
                    Tải lên giọng của tôi
                    <input
                      type="file"
                      accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
                      disabled={upload.isPending}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) upload.mutate({ sceneId: scene.id, file });
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
