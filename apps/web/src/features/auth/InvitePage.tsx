import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { fetchSessionUser } from "../../services/apiClient";
import { acceptInvite, fetchInvite, joinInvite } from "../../services/inviteApi";
import { ROLE_LABEL, type TeamRole } from "../../services/teamApi";

/** Public page behind an invitation link. The email is fixed by the invitation; the person only picks a name and password. */
export function InvitePage() {
  const { id = "" } = useParams();
  const invite = useQuery({ queryKey: ["invite", id], queryFn: () => fetchInvite(id), retry: false });
  const session = useQuery({ queryKey: ["auth-session"], queryFn: fetchSessionUser, retry: false });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Mật khẩu cần ít nhất 8 ký tự.");
    if (password !== again) return setError("Hai lần nhập mật khẩu chưa khớp.");
    setPending(true);
    try {
      await acceptInvite({ id, name: name.trim(), password });
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tham gia được.");
    } finally {
      setPending(false);
    }
  }

  async function join() {
    setError("");
    setPending(true);
    try {
      await joinInvite(id);
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tham gia được.");
    } finally {
      setPending(false);
    }
  }

  if (invite.isLoading) return <div className="auth-screen"><Card title="Lời mời"><p role="status">Đang kiểm tra liên kết…</p></Card></div>;
  if (invite.isError || !invite.data) {
    return (
      <div className="auth-screen">
        <Card title="Lời mời không dùng được">
          <p>Lời mời không hợp lệ hoặc đã hết hạn. Hãy nhờ người mời tạo liên kết mới.</p>
          <p><Link to="/login">Về trang đăng nhập</Link></p>
        </Card>
      </div>
    );
  }
  const data = invite.data;
  const roleLabel = ROLE_LABEL[data.role as TeamRole] ?? data.role;

  return (
    <div className="auth-screen">
      <Card title={`Tham gia ${data.workspaceName || "nhóm"}`}>
        <p>Bạn được mời với vai trò <strong>{roleLabel}</strong>.</p>
        {data.accountExists ? (
          session.data ? (
            <div className="form-stack">
              <p>Bạn đang đăng nhập là <strong>{session.data.name}</strong>. Lời mời chỉ nhận được bằng đúng tài khoản được mời.</p>
              {error ? <p role="alert" className="ui-field-error">{error}</p> : null}
              <div><Button loading={pending} onClick={() => { void join(); }}>Tham gia bằng tài khoản này</Button></div>
            </div>
          ) : (
            <p>Email này đã có tài khoản. <Link to={`/login?next=${encodeURIComponent(`/invite/${id}`)}`}>Đăng nhập</Link> rồi mở lại liên kết này để tham gia.</p>
          )
        ) : (
          <form className="form-stack" onSubmit={(event) => { void submit(event); }}>
            <Field label="Email (cố định theo lời mời)">{(field) => <input {...field} readOnly value={data.email} />}</Field>
            <Field label="Tên hiển thị">{(field) => <input {...field} required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />}</Field>
            <Field label="Mật khẩu" hint="Ít nhất 8 ký tự.">{(field) => <input {...field} type="password" required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}</Field>
            <Field label="Nhập lại mật khẩu" error={error || undefined}>{(field) => <input {...field} type="password" required autoComplete="new-password" value={again} onChange={(event) => setAgain(event.target.value)} />}</Field>
            <Button type="submit" loading={pending}>Tạo tài khoản và tham gia</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
