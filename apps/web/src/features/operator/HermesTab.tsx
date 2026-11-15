import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { getSupervisionData } from "../../services/operatorApi";

export function HermesTab() {
  const query = useQuery({
    queryKey: ["operator", "supervision"],
    queryFn: getSupervisionData,
    refetchInterval: 5000,
  });

  if (query.isPending) return <Spinner label="Đang tải thông tin giám sát Hermes" />;
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;

  const { duty, instances, escalations, actions, leases, pause } = query.data;

  return (
    <div className="hermes-supervision-tab" data-testid="hermes-supervision-tab">
      <section className="panel" data-testid="hermes-duty-section">
        <h2>Trực nhật & Các Instance</h2>
        <div className="duty-status-card">
          {duty ? (
            <p>
              🛡️ <strong>Đang trực:</strong> <code>{duty.instance}</code> (hết hạn: {new Date(duty.expiresAt).toLocaleTimeString("vi-VN")})
            </p>
          ) : (
            <p>🛡️ <strong>Đang trực:</strong> Chưa có instance nào nhận trực.</p>
          )}
        </div>
        <h3>Danh sách Instance ({instances.length})</h3>
        {instances.length === 0 ? (
          <p>Chưa ghi nhận instance nào kết nối.</p>
        ) : (
          <ul className="instance-list">
            {instances.map((inst) => (
              <li key={inst.instance} className="instance-item">
                <code>{inst.instance}</code>
                <span> — {inst.onDuty ? "🛡️ Đang trực" : "Dự phòng (Standby)"}</span>
                <span> · Thấy lúc: {new Date(inst.lastSeenAt).toLocaleString("vi-VN")}</span>
                {inst.version ? <span> · Phiên bản: {inst.version}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" data-testid="hermes-pause-section">
        <h2>Trạng thái tạm dừng</h2>
        {pause ? (
          <div className="pause-alert">
            <p>
              ⚠️ <strong>Operator đang tạm dừng bởi:</strong> <code>{pause.by}</code>
            </p>
            <p><strong>Lý do:</strong> {pause.reason}</p>
            <p><strong>Thời gian:</strong> Đến {new Date(pause.until).toLocaleString("vi-VN")}</p>
          </div>
        ) : (
          <p>Operator đang hoạt động bình thường (không tạm dừng).</p>
        )}
      </section>

      <section className="panel" data-testid="hermes-escalations-section">
        <h2>Chuyển giao việc (Escalations)</h2>
        {escalations.length === 0 ? (
          <p>Không có việc nào đang chuyển giao.</p>
        ) : (
          <ul className="escalation-list">
            {escalations.map((esc) => (
              <li key={esc.id} className="escalation-item">
                <div className="escalation-header">
                  <strong>[{esc.kind}]</strong> {esc.summary}
                  <span className={`status-badge status-${esc.status}`}> · {esc.status}</span>
                </div>
                <div className="escalation-details">
                  <span>Chuyển tới: {esc.toKind}</span>
                  {esc.outcome ? <span> · Kết quả: {esc.outcome}</span> : null}
                  {esc.note ? <span> · Ghi chú: {esc.note}</span> : null}
                  <span> · Số lần chuyển: {esc.hops}</span>
                  {esc.deadlineAt ? <span> · Hạn: {new Date(esc.deadlineAt).toLocaleTimeString("vi-VN")}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" data-testid="hermes-leases-section">
        <h2>Khóa tài nguyên đang giữ (Leases)</h2>
        {leases.length === 0 ? (
          <p>Không có tài nguyên nào đang bị khóa.</p>
        ) : (
          <ul className="lease-list">
            {leases.map((lease) => (
              <li key={`${lease.resourceKind}:${lease.resourceId}`} className="lease-item">
                <code>{lease.resourceKind}:{lease.resourceId}</code>
                <span> — Giữ bởi: <strong>{lease.holderInstance}</strong> ({lease.holderKind})</span>
                <span> · Hết hạn: {new Date(lease.expiresAt).toLocaleTimeString("vi-VN")}</span>
                {lease.preemptedBy ? <span> · Bị tiếp quản bởi: {lease.preemptedBy}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" data-testid="hermes-actions-section">
        <h2>Thao tác gần đây của Hermes</h2>
        {actions.length === 0 ? (
          <p>Chưa có thao tác nào từ Hermes trong nhật ký audit.</p>
        ) : (
          <ul className="hermes-action-list">
            {actions.map((act) => (
              <li key={act.id} className="action-item">
                <code>{act.tool}</code>
                <span> ({act.decision}): {act.summary}</span>
                <span> · {new Date(act.created_at).toLocaleString("vi-VN")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
