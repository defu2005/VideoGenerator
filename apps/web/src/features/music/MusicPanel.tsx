import type { MusicCandidate, MusicSettingsPatch, Project, ProjectMusic } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { pipelineKeys, usePipeline } from "../../hooks/usePipeline";
import { approvePipelineGate, runPipeline } from "../../services/pipelineApi";
import {
  getProjectMusic,
  musicPreviewUrl,
  searchMusic,
  selectMusic,
  selectNoMusic,
  updateMusicSettings,
  uploadMusic,
} from "../../services/musicApi";

const musicKeys = { project: (projectId: string) => ["music", projectId] as const };

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "?:??";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function licenseBadge(candidate: MusicCandidate): { label: string; tone: "ok" | "warn" } {
  const { kind, attributionRequired } = candidate.license;
  if (kind === "USER_PROVIDED") return { label: "Của bạn", tone: "ok" };
  if (kind === "UNKNOWN") return { label: "License chưa rõ", tone: "warn" };
  if (kind.includes("NC")) return { label: "Phi thương mại", tone: "warn" };
  if (attributionRequired) return { label: `${candidate.license.name} · cần ghi nguồn`, tone: "ok" };
  return { label: candidate.license.name || kind, tone: "ok" };
}

const PROVIDER_LABEL: Record<MusicCandidate["provider"], string> = {
  openverse: "Openverse",
  local: "Thư viện máy",
  upload: "Tải lên",
  mock: "Mock",
};

type MixForm = { volume: number; fadeInSec: number; fadeOutSec: number; duckingDb: number };

function mixFrom(music: ProjectMusic | undefined): MixForm | null {
  const selection = music?.selection;
  if (!selection) return null;
  return { volume: selection.volume, fadeInSec: selection.fadeInSec, fadeOutSec: selection.fadeOutSec, duckingDb: selection.duckingDb };
}

export function MusicPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [mix, setMix] = useState<MixForm | null>(null);
  const pipeline = usePipeline(project.id);
  const music = useQuery({ queryKey: musicKeys.project(project.id), queryFn: () => getProjectMusic(project.id) });

  useEffect(() => { setMix(mixFrom(music.data)); }, [music.data]);

  const onResult = (data: ProjectMusic) => {
    queryClient.setQueryData(musicKeys.project(project.id), data);
    void queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
  };
  const onError = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Không thực hiện được yêu cầu");
  const search = useMutation({ mutationFn: (text: string | null) => searchMusic(project.id, text), onSuccess: onResult, onError });
  const select = useMutation({ mutationFn: (candidateId: string) => selectMusic(project.id, candidateId), onSuccess: onResult, onError });
  const none = useMutation({ mutationFn: () => selectNoMusic(project.id), onSuccess: onResult, onError });
  const settings = useMutation({ mutationFn: (patch: MusicSettingsPatch) => updateMusicSettings(project.id, patch), onSuccess: onResult, onError });
  const upload = useMutation({ mutationFn: (file: File) => uploadMusic(project.id, file), onSuccess: onResult, onError });
  const busy = search.isPending || select.isPending || none.isPending || settings.isPending || upload.isPending;

  if (music.isPending || pipeline.isPending) return <Spinner label="Đang tải nhạc nền" />;
  if (music.isError) return <ErrorState message={music.error.message} onRetry={() => void music.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;

  const data = music.data;
  const selection = data.selection;
  const current = data.selectedCandidate;
  const searchStage = pipeline.data.stages.find((record) => record.stage === "MUSIC_SEARCH");
  const gate = pipeline.data.stages.find((record) => record.stage === "MUSIC_REVIEW");
  const canRunStage = Boolean(searchStage) && !pipeline.data.activeJob && !pipeline.isMutating;
  const gateReady = selection?.status === "APPROVED" || selection?.status === "NONE" || !data.enabled;
  const queryValue = query ?? data.query;

  function act(run: () => void) {
    setError("");
    run();
  }

  async function runStage() {
    setError("");
    try {
      await runPipeline(project.id, "MUSIC_SEARCH");
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
      await music.refetch();
    } catch (reason) {
      onError(reason);
    }
  }

  async function approveGate() {
    setError("");
    try {
      const next = await approvePipelineGate(project.id, "MUSIC_REVIEW");
      queryClient.setQueryData(pipelineKeys.detail(project.id), next);
    } catch (reason) {
      onError(reason);
    }
  }

  function saveMix() {
    if (!mix) return;
    act(() => settings.mutate(mix));
  }

  return (
    <div className="music-panel">
      {error && <p className="request-error" role="alert">{error}</p>}
      <section className="panel music-header">
        <div>
          <p className="eyebrow">BACKGROUND MUSIC</p>
          <h2>{data.enabled ? (current ? current.title : selection?.status === "NONE" ? "Không dùng nhạc" : "Chưa chọn nhạc") : "Nhạc nền đang tắt"}</h2>
          <p>Mood: {data.mood || "—"} · Năng lượng: {data.energy || "—"} · Video ~{formatDuration(data.videoDurationSec)}</p>
        </div>
        <div className="music-header-actions">
          <button className="button button-secondary" type="button" disabled={!canRunStage} onClick={() => void runStage()}>Chạy bước tìm nhạc</button>
          {gate?.state === "WAITING_USER" && (
            <button className="button button-primary" type="button" disabled={!gateReady || Boolean(pipeline.data.activeJob)} title={gateReady ? undefined : "Chọn một bản nhạc hoặc 'Không dùng nhạc' trước"} onClick={() => void approveGate()}>
              Duyệt nhạc → tiếp tục
            </button>
          )}
        </div>
      </section>

      <section className="panel music-current">
        {current ? (
          <>
            <div className="music-current-heading">
              <div>
                <h3>{current.title}</h3>
                <small>{current.artist ?? "Không rõ tác giả"} · {formatDuration(current.durationSec)} · {PROVIDER_LABEL[current.provider]}</small>
              </div>
              <span className={`music-status ${selection?.status === "APPROVED" ? "ok" : "warn"}`}>
                {selection?.status === "APPROVED" ? (selection.selectedBy === "USER" ? "Bạn đã chọn" : "AI đã chọn") : "Cần duyệt"}
              </span>
            </div>
            {musicPreviewUrl(project.id, current) && <audio controls preload="none" src={musicPreviewUrl(project.id, current) ?? undefined} aria-label={`Nhạc ${current.title}`} />}
            {current.license.attributionRequired && <p className="music-attribution">Ghi nguồn: {current.license.attributionText || current.license.name}</p>}
          </>
        ) : (
          <p className="music-empty">{selection?.status === "NONE" ? "Video sẽ không có nhạc nền." : "Chọn một bản bên dưới, tải nhạc của bạn lên, hoặc chọn 'Không dùng nhạc'."}</p>
        )}
        {mix && (
          <div className="music-mix">
            <label>
              Âm lượng {Math.round(mix.volume * 100)}%
              <input type="range" min={0} max={1} step={0.05} value={mix.volume} onChange={(event) => setMix({ ...mix, volume: Number(event.currentTarget.value) })} />
            </label>
            <label>
              Fade in (giây)
              <input type="number" min={0} max={30} step={0.5} value={mix.fadeInSec} onChange={(event) => setMix({ ...mix, fadeInSec: Number(event.currentTarget.value) })} />
            </label>
            <label>
              Fade out (giây)
              <input type="number" min={0} max={30} step={0.5} value={mix.fadeOutSec} onChange={(event) => setMix({ ...mix, fadeOutSec: Number(event.currentTarget.value) })} />
            </label>
            <label>
              Giảm nhạc khi có lời (dB)
              <input type="number" min={-40} max={0} step={1} value={mix.duckingDb} onChange={(event) => setMix({ ...mix, duckingDb: Number(event.currentTarget.value) })} />
            </label>
            <button className="button button-secondary" type="button" disabled={busy} onClick={saveMix}>Lưu cài đặt</button>
          </div>
        )}
        <div className="music-actions">
          <button className="button button-secondary" type="button" disabled={busy || selection?.status === "NONE"} onClick={() => act(() => none.mutate())}>Không dùng nhạc</button>
          <label className="button button-secondary music-upload">
            Tải nhạc của tôi
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/flac,.mp3,.wav,.m4a,.ogg,.flac"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) act(() => upload.mutate(file));
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </section>

      <form
        className="panel music-search"
        onSubmit={(event) => {
          event.preventDefault();
          act(() => search.mutate(queryValue.trim() || null));
        }}
      >
        <label htmlFor="music-query">Từ khóa tìm nhạc</label>
        <input id="music-query" value={queryValue} maxLength={200} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="vd: calm piano ambient" />
        <button className="button button-primary" type="submit" disabled={busy}>{search.isPending ? "Đang tìm…" : "Tìm nhạc"}</button>
      </form>

      {data.candidates.length === 0 ? (
        <section className="panel music-empty"><p>Chưa có bản nhạc nào. Bấm "Tìm nhạc" hoặc chạy bước tìm nhạc.</p></section>
      ) : (
        <div className="music-list">
          {data.candidates.map((candidate) => {
            const badge = licenseBadge(candidate);
            const preview = musicPreviewUrl(project.id, candidate);
            const selected = selection?.candidateId === candidate.id;
            const tooShort = candidate.durationSec !== null && data.videoDurationSec > 0 && candidate.durationSec < data.videoDurationSec;
            return (
              <article className={`panel music-candidate${selected ? " selected" : ""}`} key={candidate.id}>
                <div className="music-candidate-heading">
                  <div>
                    <h3>{candidate.title}</h3>
                    <small>{candidate.artist ?? "Không rõ tác giả"} · {formatDuration(candidate.durationSec)}{tooShort ? " · sẽ lặp lại" : ""} · {PROVIDER_LABEL[candidate.provider]}</small>
                  </div>
                  <span className={`music-license ${badge.tone}`}>{badge.label}</span>
                </div>
                {candidate.tags.length > 0 && <p className="music-tags">{candidate.tags.slice(0, 8).join(" · ")}</p>}
                {preview && <audio controls preload="none" src={preview} aria-label={`Nghe thử ${candidate.title}`} />}
                <div className="music-actions">
                  <button className="button button-secondary" type="button" disabled={busy || (selected && selection?.status === "APPROVED")} onClick={() => act(() => select.mutate(candidate.id))}>
                    {selected && selection?.status === "APPROVED" ? "Đang dùng" : "Dùng bản này"}
                  </button>
                  {candidate.sourceUrl && <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">Nguồn</a>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
