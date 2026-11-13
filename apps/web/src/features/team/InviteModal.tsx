import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import {
  assignableRoles, createInvitation, ROLE_HINT, ROLE_LABEL,
  type Grant, type Invitation, type TeamChannel, type TeamRole,
} from "../../services/teamApi";
import { GrantEditor } from "./GrantEditor";

export function fullLink(link: string): string {
  return link.startsWith("http") ? link : `${window.location.origin}${link}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function InviteModal({
  open, onClose, myRole, channels,
}: { open: boolean; onClose: () => void; myRole: string; channels: TeamChannel[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("viewer");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [created, setCreated] = useState<Invitation | null>(null);
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: createInvitation,
    onSuccess: (invitation) => {
      setCreated(invitation);
      void queryClient.invalidateQueries({ queryKey: ["team-invitations"] });
      toast.success("Đã tạo lời mời. Gửi liên kết cho người được mời.");
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Không tạo được lời mời."),
  });

  function close() {
    setEmail(""); setRole("viewer"); setGrants([]); setCreated(null); setError("");
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    create.mutate({ email: email.trim(), role, grants: role === "owner" || role === "admin" ? [] : grants });
  }

  async function copy() {
    if (!created) return;
    const ok = await copyText(fullLink(created.link));
    if (ok) toast.success("Đã chép liên kết.");
    else toast.error("Không chép được. Hãy chọn và chép thủ công.");
  }

  return (
    <Modal open={open} title={created ? "Liên kết mời" : "Mời thành viên"} onClose={close}>
      {created ? (
        <div className="form-stack">
          <p>Gửi liên kết này cho <strong>{created.email}</strong>. Liên kết dùng được một lần và hết hạn sau 7 ngày.</p>
          <input readOnly aria-label="Liên kết mời" value={fullLink(created.link)} onFocus={(event) => event.currentTarget.select()} />
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => { void copy(); }}>Chép liên kết</Button>
            <Button onClick={close}>Xong</Button>
          </div>
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          <Field label="Email người được mời" error={error || undefined}>
            {(field) => <input {...field} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />}
          </Field>
          <Field label="Vai trò" hint={ROLE_HINT[role]}>
            {(field) => (
              <select {...field} value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
                {assignableRoles(myRole).map((item) => <option key={item} value={item}>{ROLE_LABEL[item]}</option>)}
              </select>
            )}
          </Field>
          <GrantEditor channels={channels} workspaceRole={role} value={grants} onChange={setGrants} />
          <div className="modal-actions">
            <Button variant="ghost" onClick={close}>Hủy</Button>
            <Button type="submit" loading={create.isPending}>Tạo lời mời</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
