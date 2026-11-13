import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Toggle } from "../../components/ui/Toggle";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/useConfirm";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { fetchMe } from "../../services/meApi";
import {
  assignableRoles, cancelInvitation, changeRole, fetchInvitations, fetchMembers, fetchWorkspaceSettings,
  removeMember, ROLE_LABEL, saveGrants, saveWorkspaceSettings,
  type Grant, type TeamMember, type TeamRole,
} from "../../services/teamApi";
import { GrantEditor } from "./GrantEditor";
import { copyText, fullLink, InviteModal } from "./InviteModal";
import { ServiceKeysCard } from "./ServiceKeysCard";

function when(value: string | null): string {
  if (!value) return "Chưa từng";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN");
}

export function TeamPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const members = useQuery({ queryKey: ["team-members"], queryFn: fetchMembers });
  const invitations = useQuery({ queryKey: ["team-invitations"], queryFn: fetchInvitations });
  const settings = useQuery({ queryKey: ["team-settings"], queryFn: fetchWorkspaceSettings });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [draftGrants, setDraftGrants] = useState<Grant[]>([]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["team-members"] });
    void queryClient.invalidateQueries({ queryKey: ["team-invitations"] });
  };
  const onError = (cause: unknown) => toast.error(cause instanceof Error ? cause.message : "Không thực hiện được.");

  const roleMutation = useMutation({
    mutationFn: (input: { userId: string; role: TeamRole }) => changeRole(input.userId, input.role),
    onSuccess: () => { toast.success("Đã đổi vai trò."); refresh(); },
    onError,
  });
  const grantsMutation = useMutation({
    mutationFn: (input: { userId: string; grants: Grant[] }) => saveGrants(input.userId, input.grants),
    onSuccess: () => { toast.success("Đã lưu quyền theo kênh."); setEditing(null); refresh(); },
    onError,
  });
  const removeMutation = useMutation({
    mutationFn: removeMember,
    onSuccess: () => { toast.success("Đã xóa thành viên."); refresh(); },
    onError,
  });
  const cancelMutation = useMutation({
    mutationFn: cancelInvitation,
    onSuccess: () => { toast.success("Đã hủy lời mời."); refresh(); },
    onError,
  });
  const settingsMutation = useMutation({
    mutationFn: saveWorkspaceSettings,
    onSuccess: () => { toast.success("Đã lưu cài đặt nhóm."); void queryClient.invalidateQueries({ queryKey: ["team-settings"] }); },
    onError,
  });

  const myRole = me.data?.role ?? "viewer";
  const canTouch = (member: TeamMember) => !member.isSelf && (myRole === "owner" || (member.role !== "owner" && member.role !== "admin"));

  if (members.isLoading) return <Spinner label="Đang tải danh sách nhóm" />;
  if (members.isError || !members.data) return <ErrorState message="Không tải được danh sách nhóm." onRetry={() => { void members.refetch(); }} />;
  const channels = members.data.channels;
  const channelName = (id: string) => channels.find((channel) => channel.id === id)?.name ?? "Kênh đã xóa";

  async function onRemove(member: TeamMember) {
    const ok = await ask({
      title: "Xóa thành viên?",
      message: `${member.name} sẽ mất quyền truy cập ngay và các phiên đăng nhập của họ trong nhóm này không còn dùng được. Họ có thể được mời lại sau.`,
      confirmLabel: "Xóa thành viên",
    });
    if (ok) removeMutation.mutate(member.userId);
  }

  async function onCancelInvite(id: string, email: string) {
    const ok = await ask({ title: "Hủy lời mời?", message: `Liên kết mời gửi tới ${email} sẽ không còn dùng được.`, confirmLabel: "Hủy lời mời" });
    if (ok) cancelMutation.mutate(id);
  }

  async function onRequireTwoFactor(next: boolean) {
    const ok = await ask({
      title: next ? "Bắt buộc xác thực hai bước?" : "Bỏ yêu cầu xác thực hai bước?",
      message: next
        ? "Chủ sở hữu và quản trị viên chưa bật xác thực hai bước sẽ chỉ vào được trang Tài khoản của tôi cho tới khi bật xong."
        : "Chủ sở hữu và quản trị viên sẽ không còn bị buộc phải bật xác thực hai bước.",
      confirmLabel: next ? "Bắt buộc" : "Bỏ yêu cầu",
    });
    if (ok) settingsMutation.mutate({ requireTwoFactor: next });
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Nhóm"
        description="Thành viên, vai trò và kênh mỗi người được làm việc."
        helpHref="/help/khong-gian-va-quyen"
        actions={<Button onClick={() => setInviteOpen(true)}>Mời thành viên</Button>}
      />

      <Card title="Thành viên">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th scope="col">Tên</th><th scope="col">Vai trò</th><th scope="col">Kênh</th>
                <th scope="col">2FA</th><th scope="col">Hoạt động gần nhất</th><th scope="col"><span className="sr-only">Thao tác</span></th>
              </tr>
            </thead>
            <tbody>
              {members.data.members.map((member) => (
                <tr key={member.userId}>
                  <td>{member.name}{member.isSelf ? " (bạn)" : ""}<br /><span className="muted">{member.email}</span></td>
                  <td>
                    {canTouch(member) ? (
                      <select
                        aria-label={`Vai trò của ${member.name}`}
                        value={member.role}
                        onChange={(event) => roleMutation.mutate({ userId: member.userId, role: event.target.value as TeamRole })}
                      >
                        {[...new Set<TeamRole>([member.role, ...assignableRoles(myRole)])].map((role) => (
                          <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                        ))}
                      </select>
                    ) : ROLE_LABEL[member.role]}
                  </td>
                  <td>
                    {member.role === "owner" || member.role === "admin" ? "Mọi kênh"
                      : member.grants.length === 0 ? "Chưa được giao kênh nào"
                        : member.grants.map((grant) => `${channelName(grant.profileId)} (${ROLE_LABEL[grant.role]})`).join(", ")}
                  </td>
                  <td>{member.twoFactorEnabled ? <Badge tone="success">Đã bật</Badge> : <Badge tone="neutral">Chưa bật</Badge>}</td>
                  <td>{when(member.lastActiveAt)}</td>
                  <td>
                    {canTouch(member) ? (
                      <span className="row-actions">
                        {member.role !== "owner" && member.role !== "admin" ? (
                          <Button
                            size="sm" variant="secondary"
                            onClick={() => { setEditing(member); setDraftGrants(member.grants.map((grant) => ({ profileId: grant.profileId, role: grant.role as Grant["role"] }))); }}
                          >Quyền theo kênh</Button>
                        ) : null}
                        <Button size="sm" variant="danger" onClick={() => { void onRemove(member); }}>Xóa</Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Lời mời đang chờ">
        {invitations.data && invitations.data.invitations.length > 0 ? (
          <ul className="plain-list">
            {invitations.data.invitations.map((invite) => (
              <li key={invite.id}>
                <strong>{invite.email}</strong> · {ROLE_LABEL[invite.role]} · hết hạn {when(invite.expiresAt)}
                {" "}
                <Button size="sm" variant="secondary" onClick={() => { void copyText(fullLink(invite.link)).then((ok) => (ok ? toast.success("Đã chép liên kết.") : toast.error("Không chép được liên kết."))); }}>Chép liên kết</Button>
                {" "}
                <Button size="sm" variant="ghost" onClick={() => { void onCancelInvite(invite.id, invite.email); }}>Hủy</Button>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Không có lời mời nào đang chờ.</p>}
      </Card>

      {settings.data ? (
        <Card title="Bảo mật của nhóm">
          <Toggle
            label="Bắt buộc chủ sở hữu và quản trị viên bật xác thực hai bước"
            checked={Boolean(settings.data.flags.requireTwoFactor)}
            onChange={(next) => { if (settings.data?.canEdit) void onRequireTwoFactor(next); }}
          />
          {!settings.data.canEdit ? <p className="muted">Chỉ chủ sở hữu đổi được cài đặt này.</p> : null}
        </Card>
      ) : null}

      {myRole === "owner" || myRole === "admin" ? <ServiceKeysCard /> : null}

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} myRole={myRole} channels={channels} />

      <Modal open={editing !== null} title={editing ? `Quyền theo kênh · ${editing.name}` : ""} onClose={() => setEditing(null)}>
        {editing ? (
          <div className="form-stack">
            <p className="muted">Vai trò chung: {ROLE_LABEL[editing.role]}. Quyền theo kênh chỉ có thể giảm, không nâng thêm.</p>
            <GrantEditor channels={channels} workspaceRole={editing.role} value={draftGrants} onChange={setDraftGrants} />
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => setEditing(null)}>Hủy</Button>
              <Button loading={grantsMutation.isPending} onClick={() => grantsMutation.mutate({ userId: editing.userId, grants: draftGrants })}>Lưu</Button>
            </div>
          </div>
        ) : null}
      </Modal>
      {dialog}
    </div>
  );
}
