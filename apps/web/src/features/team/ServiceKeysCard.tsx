import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/useConfirm";
import { fetchServiceKeys, revokeServiceKey, type ServiceKey } from "../../services/teamApi";

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "—";
}

/** Keys held by owners and admins, including the one the local services use. Only a preview is ever shown. */
export function ServiceKeysCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const keys = useQuery({ queryKey: ["service-keys"], queryFn: fetchServiceKeys });
  const revoke = useMutation({
    mutationFn: revokeServiceKey,
    onSuccess: () => { toast.success("Đã thu hồi khóa."); void queryClient.invalidateQueries({ queryKey: ["service-keys"] }); },
    onError: (cause) => toast.error(cause instanceof Error ? cause.message : "Không thu hồi được khóa."),
  });

  async function onRevoke(key: ServiceKey) {
    const ok = await ask({
      title: "Thu hồi khóa?",
      message: key.isLocalService
        ? "Đây là khóa của dịch vụ chạy trên máy này (operator, MCP). Thu hồi sẽ làm các dịch vụ đó mất quyền cho tới khi server khởi động lại (khi khởi động, server thấy khóa đã thu hồi và tự tạo khóa mới)."
        : `Khóa "${key.name || key.preview}" sẽ ngừng hoạt động ngay. Việc này không hoàn tác được.`,
      confirmLabel: "Thu hồi",
    });
    if (ok) revoke.mutate(key.id);
  }

  return (
    <Card title="Khóa của dịch vụ">
      {keys.data && keys.data.keys.length > 0 ? (
        <ul className="plain-list">
          {keys.data.keys.map((key) => (
            <li key={key.id}>
              <strong>{key.name || "Khóa không tên"}</strong> <code>{key.preview}</code>
              {" "}{key.isLocalService ? <Badge tone="info">Dịch vụ trên máy</Badge> : null}
              {" "}{key.enabled ? <Badge tone="success">Đang dùng</Badge> : <Badge tone="neutral">Đã thu hồi</Badge>}
              <br />
              <span className="muted">Chủ khóa: {key.ownerName} · tạo {day(key.createdAt)} · dùng gần nhất {day(key.lastUsedAt)} · hết hạn {key.expiresAt ? day(key.expiresAt) : "không"}</span>
              {key.enabled && key.canRevoke ? <>{" "}<Button size="sm" variant="danger" onClick={() => { void onRevoke(key); }}>Thu hồi</Button></> : null}
            </li>
          ))}
        </ul>
      ) : <p className="muted">Chưa có khóa nào.</p>}
      {dialog}
    </Card>
  );
}
