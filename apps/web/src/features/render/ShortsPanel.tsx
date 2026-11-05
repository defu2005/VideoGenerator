import type { ReframeMode } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { renderFileUrl } from "../../services/renderApi";
import { exportClips, getClips, proposeClips, updateClips, type ClipView } from "../../services/clipsApi";

const clipKeys = { project: (projectId: string) => ["clips", projectId] as const };

export function ShortsPanel({ projectId, renderId }: { projectId: string; renderId: string }) {
  const queryClient = useQueryClient();
  const clips = useQuery({ queryKey: clipKeys.project(projectId), queryFn: () => getClips(projectId) });
  const [count, setCount] = useState(3);
  const [minSec, setMinSec] = useState(20);
  const [maxSec, setMaxSec] = useState(45);
  const [reframe, setReframe] = useState<ReframeMode>("center");
  const [drafts, setDrafts] = useState<ClipView["proposals"]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!clips.data) return;
    setCount(clips.data.options.count);
    setMinSec(clips.data.options.minSec);
    setMaxSec(clips.data.options.maxSec);
    setReframe(clips.data.options.reframe);
    setDrafts(clips.data.proposals);
  }, [clips.data]);

  const busy = clips.data?.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING") ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void clips.refetch(); }, 1500);
    return () => window.clearInterval(timer);
  }, [busy, clips]);

  const propose = useMutation({
    mutationFn: () => proposeClips(projectId, { count, minSec, maxSec, reframe }),
    onSuccess: (view) => {
      queryClient.setQueryData(clipKeys.project(projectId), view);
      setMessage(`Đã đề xuất ${view.proposals.length} đoạn.`);
    },
  });
  const save = useMutation({
    mutationFn: () => updateClips(projectId, drafts.map((item) => ({
      id: item.id, start: item.start, end: item.end, hook: item.hook, title: item.title, selected: item.selected,
    }))),
    onSuccess: (view) => {
      queryClient.setQueryData(clipKeys.project(projectId), view);
      setMessage("Đã lưu chỉnh sửa.");
    },
  });
  const exporting = useMutation({
    mutationFn: () => exportClips(projectId, drafts.filter((item) => item.selected).map((item) => item.id)),
    onSuccess: (view) => {
      queryClient.setQueryData(clipKeys.project(projectId), view);
      setMessage("Đã tạo job xuất clip.");
    },
  });

  if (clips.isPending) return <Spinner label="Đang tải Shorts" />;
  if (clips.isError || !clips.data) {
    return <ErrorState message="Không tải được phần Shorts" onRetry={() => void clips.refetch()} />;
  }
  const view = clips.data;
  const selected = drafts.filter((item) => item.selected).length;
  const error = propose.error ?? save.error ?? exporting.error;

  return (
    <section className="panel shorts-panel" aria-label="Tạo Shorts">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SHORTS</p>
          <h2>Tạo Shorts</h2>
          <p>Cắt các đoạn dọc từ bản render ngang và đưa vào lịch đăng.</p>
        </div>
      </div>
      {!view.eligible && <p className="request-error" role="alert">{view.reason}</p>}
      <div className="shorts-options">
        <label>Số đoạn<input aria-label="Số đoạn" type="number" min={1} max={8} value={count} onChange={(event) => setCount(Number(event.target.value) || 1)} /></label>
        <label>Ngắn nhất (giây)<input aria-label="Độ dài ngắn nhất" type="number" min={15} max={90} value={minSec} onChange={(event) => setMinSec(Number(event.target.value) || 20)} /></label>
        <label>Dài nhất (giây)<input aria-label="Độ dài dài nhất" type="number" min={15} max={90} value={maxSec} onChange={(event) => setMaxSec(Number(event.target.value) || 45)} /></label>
        <label>Khung hình
          <select aria-label="Chế độ khung hình" value={reframe} onChange={(event) => setReframe(event.target.value as ReframeMode)}>
            <option value="center">Giữa khung</option>
            <option value="blur-fill">Làm mờ nền</option>
            <option value="smart">Theo điểm nhấn</option>
          </select>
        </label>
        <button className="button button-secondary" type="button" disabled={!view.eligible || propose.isPending} onClick={() => void propose.mutate()}>
          {propose.isPending ? "Đang đề xuất…" : "Tạo đề xuất"}
        </button>
      </div>
      {error instanceof Error && <p className="request-error" role="alert">{error.message}</p>}
      {message && <p className="form-hint">{message}</p>}
      <ul className="shorts-list">
        {drafts.map((proposal, index) => (
          <li key={proposal.id} className="shorts-item">
            <label className="field-checkbox">
              <input
                type="checkbox"
                aria-label={`Chọn ${proposal.title}`}
                checked={proposal.selected}
                onChange={(event) => setDrafts((current) => current.map((item) => item.id === proposal.id ? { ...item, selected: event.target.checked } : item))}
              />
              Đoạn {index + 1} · {proposal.score} điểm · {proposal.status}
            </label>
            <p>{proposal.snippet}</p>
            <video
              aria-label={`Xem trước ${proposal.title}`}
              controls
              preload="metadata"
              src={`${renderFileUrl(projectId, "video", renderId)}#t=${proposal.start},${proposal.end}`}
            />
            <label>Bắt đầu<input aria-label={`Bắt đầu ${proposal.title}`} type="number" step="0.1" value={proposal.start} onChange={(event) => setDrafts((current) => current.map((item) => item.id === proposal.id ? { ...item, start: Number(event.target.value) } : item))} /></label>
            <label>Kết thúc<input aria-label={`Kết thúc ${proposal.title}`} type="number" step="0.1" value={proposal.end} onChange={(event) => setDrafts((current) => current.map((item) => item.id === proposal.id ? { ...item, end: Number(event.target.value) } : item))} /></label>
            <label>Hook<input aria-label={`Hook ${proposal.title}`} value={proposal.hook} maxLength={60} onChange={(event) => setDrafts((current) => current.map((item) => item.id === proposal.id ? { ...item, hook: event.target.value } : item))} /></label>
            <label>Tiêu đề<input aria-label={`Tiêu đề ${proposal.title}`} value={proposal.title} onChange={(event) => setDrafts((current) => current.map((item) => item.id === proposal.id ? { ...item, title: event.target.value } : item))} /></label>
            <p className="field-hint">{proposal.reason}</p>
          </li>
        ))}
      </ul>
      {drafts.length > 0 && (
        <div className="form-actions">
          <button className="button button-secondary" type="button" disabled={save.isPending} onClick={() => void save.mutate()}>Lưu chỉnh sửa</button>
          <button className="button button-primary" type="button" disabled={selected === 0 || exporting.isPending} onClick={() => void exporting.mutate()}>
            {exporting.isPending ? "Đang xuất…" : `Xuất ${selected} clip`}
          </button>
        </div>
      )}
      {view.jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING") && (
        <ul aria-label="Tiến độ xuất clip">
          {view.jobs.map((job) => <li key={job.id}>{job.status} · {job.progress}% {job.message ?? ""}</li>)}
        </ul>
      )}
      {view.children.length > 0 && (
        <ul aria-label="Clip đã tạo">
          {view.children.map((child) => (
            <li key={child.id}><Link to={`/projects/${child.id}/render`}>{child.title}</Link> · {child.status}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
