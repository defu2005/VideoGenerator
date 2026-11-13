import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { fetchSessionUser, safeNextPath, setupStatus, signIn } from "../../services/apiClient";
import { verifyBackupCode, verifyTotp } from "../../services/accountApi";

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const session = useQuery({ queryKey: ["auth-session"], queryFn: fetchSessionUser, retry: false });
  const setup = useQuery({ queryKey: ["setup-status"], queryFn: setupStatus, retry: false });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [secondStep, setSecondStep] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");

  if (session.data) return <Navigate to={next} replace />;
  // No account yet: first run goes to the owner setup page instead of a login that can never succeed.
  if (setup.data && !setup.data.userExists) return <Navigate to="/setup" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await signIn(email.trim(), password);
      if (result.twoFactor) {
        setSecondStep(true);
        return;
      }
      navigate(next, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Không đăng nhập được. Kiểm tra server API có đang chạy không.");
    } finally {
      setPending(false);
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await (useBackup ? verifyBackupCode(code.trim()) : verifyTotp(code.trim()));
      window.location.assign(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mã không đúng.");
    } finally {
      setPending(false);
    }
  }

  if (secondStep) {
    return (
      <div className="auth-screen">
        <Card title="Xác thực hai bước">
          <form className="form-stack" onSubmit={(event) => { void onVerify(event); }}>
            <p>{useBackup ? "Nhập một mã dự phòng chưa dùng." : "Nhập mã 6 số từ ứng dụng xác thực trên điện thoại."}</p>
            <Field label={useBackup ? "Mã dự phòng" : "Mã 6 số"} error={error || undefined}>
              {(field) => (
                <input
                  {...field}
                  autoComplete="one-time-code"
                  inputMode={useBackup ? "text" : "numeric"}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              )}
            </Field>
            <Button type="submit" loading={pending}>Xác nhận</Button>
            <Button variant="ghost" onClick={() => { setUseBackup(!useBackup); setCode(""); setError(""); }}>
              {useBackup ? "Dùng mã từ ứng dụng" : "Dùng mã dự phòng"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <Card title="Đăng nhập">
        <p>Nhập email và mật khẩu của tài khoản trên máy này.</p>
        <form className="form-stack" onSubmit={onSubmit}>
          <Field label="Email">
            {(field) => (
              <input
                {...field}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Mật khẩu" error={error || undefined}>
            {(field) => (
              <input
                {...field}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            )}
          </Field>
          <Button type="submit" loading={pending}>Đăng nhập</Button>
        </form>
        <p className="muted">
          Quên mật khẩu? Trên máy chạy server, mở terminal ở thư mục dự án và chạy{" "}
          <code>npm run reset-password</code>.
        </p>
      </Card>
    </div>
  );
}
