import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { createOwner, setupStatus } from "../../services/apiClient";

export function SetupPage() {
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ["setup-status"], queryFn: setupStatus, retry: false });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (status.data?.userExists) return <Navigate to="/login" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await createOwner({
        name: name.trim(),
        email: email.trim(),
        password,
        ...(setupCode.trim() ? { setupCode: setupCode.trim() } : {}),
      });
      navigate("/login", { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không tạo được tài khoản.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-screen">
      <Card title="Thiết lập chủ sở hữu">
        <p>Lần đầu mở app, hãy tạo tài khoản chủ sở hữu. Việc này chỉ làm được một lần.</p>
        <form className="form-stack" onSubmit={onSubmit}>
          <Field label="Tên">
            {(field) => (
              <input {...field} type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
            )}
          </Field>
          <Field label="Email">
            {(field) => (
              <input {...field} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
            )}
          </Field>
          <Field label="Mật khẩu" hint="Ít nhất 8 ký tự." error={error || undefined}>
            {(field) => (
              <input {...field} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            )}
          </Field>
          <Field label="Mã thiết lập" hint="Để trống nếu bạn đang mở trang trên chính máy chạy app. Nếu không, lấy mã trong log của server.">
            {(field) => (
              <input {...field} type="text" autoComplete="off" value={setupCode} onChange={(event) => setSetupCode(event.target.value)} />
            )}
          </Field>
          <Button type="submit" loading={pending}>Tạo chủ sở hữu</Button>
        </form>
      </Card>
    </div>
  );
}
