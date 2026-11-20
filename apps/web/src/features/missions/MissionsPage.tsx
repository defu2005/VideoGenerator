import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/ui/Toast";
import { cancelMission, createMission, getMission, listMissions, resumeMission, type Mission } from "../../services/missionsApi";

const STATE_LABEL: Record<string, string> = {
  planning: "Lên kế hoạch",
  producing: "Đang sản xuất",
  waiting_user: "Chờ bạn",
  scheduled: "Đã lên lịch",
  published: "Đã đăng",
  measuring: "Đang đo",
  done: "Xong",
  failed: "Lỗi",
  cancelled: "Đã huỷ",
};
const OPEN_STATES = new Set(["planning", "producing", "waiting_user", "scheduled", "published", "measuring"]);

export function MissionsPage() {
  const { id } = useParams();
  return id ? <MissionDetail id={id} /> : <MissionList />;
}

function MissionList() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [command, setCommand] = useState("");
  const list = useQuery({ queryKey: ["missions"], queryFn: listMissions });
  const create = useMutation({
    mutationFn: () => createMission(command.trim()),
    onSuccess: () => { setCommand(""); toast.success("Đã tạo mission."); void queryClient.invalidateQueries({ queryKey: ["missions"] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Không tạo được mission."),
  });

  return (
    <section className="missions-page">
      <h1>Mission</h1>
      <form className="missions-create" onSubmit={(event) => { event.preventDefault(); if (command.trim()) create.mutate(); }}>
        <label htmlFor="mission-command">Lệnh mới</label>
        <textarea id="mission-command" value={command} maxLength={2000} rows={3} onChange={(event) => setCommand(event.target.value)} placeholder="Ví dụ: làm 3 video về Berserk cho kênh A" />
        <button type="submit" disabled={!command.trim() || create.isPending}>Tạo mission</button>
      </form>
      {list.isLoading ? <Spinner /> : null}
      {list.isError ? <ErrorState message={list.error instanceof Error ? list.error.message : "Không tải được mission."} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.missions.length === 0 ? <p>Chưa có mission nào.</p> : null}
      <ul className="missions-list">
        {(list.data?.missions ?? []).map((mission) => (
          <li key={mission.id}>
            <Link to={`/missions/${mission.id}`}>{mission.command}</Link>
            <span className="missions-state">{STATE_LABEL[mission.state] ?? mission.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MissionDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const detail = useQuery({ queryKey: ["mission", id], queryFn: () => getMission(id) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["mission", id] });
    void queryClient.invalidateQueries({ queryKey: ["missions"] });
  };
  const resume = useMutation({
    mutationFn: () => resumeMission(id),
    onSuccess: () => { toast.success("Đã gỡ chờ."); refresh(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Không gỡ chờ được."),
  });
  const cancel = useMutation({
    mutationFn: () => cancelMission(id),
    onSuccess: () => { setConfirmCancel(false); toast.success("Đã huỷ mission."); refresh(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Không huỷ được."),
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.isError || !detail.data) return <ErrorState message={detail.error instanceof Error ? detail.error.message : "Không tải được mission."} onRetry={() => void detail.refetch()} />;
  const { mission, checkpoints } = detail.data;

  return (
    <section className="mission-detail">
      <Link to="/missions">← Tất cả mission</Link>
      <h1>{mission.command}</h1>
      <p className="missions-state">{STATE_LABEL[mission.state] ?? mission.state}</p>
      <AutonomyPreview mission={mission} />
      {mission.state === "waiting_user" ? (
        <p>
          Mission đang chờ bạn. Duyệt cổng nằm ở <Link to={`/projects/${mission.projectIds[0] ?? ""}`}>trang dự án</Link>; nút này chỉ gỡ chờ, không duyệt cổng.
          <button type="button" onClick={() => resume.mutate()} disabled={resume.isPending}>Gỡ chờ</button>
        </p>
      ) : null}
      {OPEN_STATES.has(mission.state) ? (
        <button type="button" className="danger" onClick={() => setConfirmCancel(true)}>Huỷ mission</button>
      ) : null}
      <h2>Kế hoạch</h2>
      {mission.plan.length === 0 ? <p>Chưa có kế hoạch.</p> : (
        <ol>{mission.plan.map((step, index) => <li key={index}>{String(step.title ?? JSON.stringify(step))}</li>)}</ol>
      )}
      <h2>Mốc đo</h2>
      {checkpoints.length === 0 ? <p>Chưa có mốc nào.</p> : (
        <ul>{checkpoints.map((c) => <li key={`${c.kind}-${c.at}`}>{c.kind} · {new Date(c.at).toLocaleString("vi-VN")}</li>)}</ul>
      )}
      <ConfirmDialog
        open={confirmCancel}
        title="Huỷ mission?"
        message="Mission sẽ dừng. Video đã đăng không tự gỡ."
        confirmLabel="Huỷ mission"
        cancelLabel="Quay lại"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </section>
  );
}

// Shows the autonomy level the mission was created with; it does not change any setting.
function AutonomyPreview({ mission }: { mission: Mission }) {
  const label = "Mức mission: " + mission.autonomyLevel + ". Cổng do chế độ của từng dự án quyết định; mức này chỉ giới hạn mission.";
  return <p className="mission-autonomy">{label}</p>;
}
