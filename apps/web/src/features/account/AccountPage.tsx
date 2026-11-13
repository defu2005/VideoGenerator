import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";
import { useToast } from "../../components/ui/Toast";
import { useConfirm } from "../../components/useConfirm";
import { fetchMe } from "../../services/meApi";
import {
  changePassword, createApiKey, deleteApiKey, disableTwoFactor, enableTwoFactor, listApiKeys, listSessions,
  regenerateBackupCodes, revokeOtherSessions, revokeSession, secretFromUri, updateName, verifyTotp,
} from "../../services/accountApi";
import { copyText } from "../team/InviteModal";

const onFail = (toast: ReturnType<typeof useToast>) => (cause: unknown) =>
  toast.error(cause instanceof Error ? cause.message : "Không thực hiện được.");

function downloadCodes(codes: string[]) {
  const url = URL.createObjectURL(new Blob([`${codes.join("\n")}\n`], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ma-du-phong.txt";
  link.click();
  URL.revokeObjectURL(url);
}

function ProfileCard({ name }: { name: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const save = useMutation({
    mutationFn: () => updateName(value.trim()),
    onSuccess: () => { toast.success("Đã lưu tên hiển thị."); void queryClient.invalidateQueries(); },
    onError: onFail(toast),
  });
  return (
    <Card title="Thông tin cá nhân">
      <form className="form-stack" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <Field label="Tên hiển thị">{(field) => <input {...field} value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} />}</Field>
        <div><Button type="submit" loading={save.isPending} disabled={!value.trim() || value.trim() === name}>Lưu tên</Button></div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent(""); setNext(""); setAgain("");
      toast.success("Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.");
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Không đổi được mật khẩu."),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (next.length < 8) return setError("Mật khẩu mới cần ít nhất 8 ký tự.");
    if (next !== again) return setError("Hai lần nhập mật khẩu mới chưa khớp.");
    change.mutate();
  }
  return (
    <Card title="Đổi mật khẩu">
      <form className="form-stack" onSubmit={submit}>
        <Field label="Mật khẩu hiện tại">{(field) => <input {...field} type="password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} />}</Field>
        <Field label="Mật khẩu mới" hint="Ít nhất 8 ký tự.">{(field) => <input {...field} type="password" autoComplete="new-password" required value={next} onChange={(event) => setNext(event.target.value)} />}</Field>
        <Field label="Nhập lại mật khẩu mới" error={error || undefined}>{(field) => <input {...field} type="password" autoComplete="new-password" required value={again} onChange={(event) => setAgain(event.target.value)} />}</Field>
        <div><Button type="submit" loading={change.isPending}>Đổi mật khẩu</Button></div>
      </form>
    </Card>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="form-stack" role="group" aria-label="Mã dự phòng">
      <p><strong>Lưu các mã dự phòng này ngay.</strong> Mỗi mã dùng được một lần khi mất điện thoại. Các mã sẽ không hiện lại sau khi bạn đóng phần này.</p>
      <ul className="backup-codes">{codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
      <div className="modal-actions">
        <Button variant="secondary" onClick={() => { void copyText(codes.join("\n")).then((ok) => (ok ? toast.success("Đã chép mã dự phòng.") : toast.error("Không chép được."))); }}>Chép</Button>
        <Button variant="secondary" onClick={() => downloadCodes(codes)}>Tải về (.txt)</Button>
        <Button onClick={onDone}>Tôi đã lưu</Button>
      </div>
    </div>
  );
}

function TwoFactorCard({ enabled, required }: { enabled: boolean; required: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["me"] }); };

  const start = useMutation({
    mutationFn: () => enableTwoFactor(password),
    onSuccess: (result) => { setSetup({ uri: result.totpURI, codes: result.backupCodes }); setPassword(""); setError(""); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Không bắt đầu được."),
  });
  const verify = useMutation({
    mutationFn: () => verifyTotp(code.trim()),
    onSuccess: () => {
      toast.success("Đã bật xác thực hai bước.");
      setCodes(setup?.codes ?? []); setSetup(null); setCode(""); setError(""); refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Mã không đúng."),
  });
  const regenerate = useMutation({
    mutationFn: () => regenerateBackupCodes(password),
    onSuccess: (result) => { setCodes(result.backupCodes); setPassword(""); setError(""); toast.success("Đã tạo mã dự phòng mới. Mã cũ không còn dùng được."); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Không tạo được mã."),
  });
  const disable = useMutation({
    mutationFn: () => disableTwoFactor(password),
    onSuccess: () => { setPassword(""); setError(""); toast.success("Đã tắt xác thực hai bước."); refresh(); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Không tắt được."),
  });

  async function onDisable() {
    const ok = await ask({
      title: "Tắt xác thực hai bước?",
      message: "Tài khoản sẽ chỉ còn được bảo vệ bằng mật khẩu.",
      confirmLabel: "Tắt xác thực hai bước",
    });
    if (ok) disable.mutate();
  }

  const secret = setup ? secretFromUri(setup.uri) : "";
  return (
    <Card title="Xác thực hai bước (2FA)" actions={enabled ? <Badge tone="success">Đã bật</Badge> : <Badge tone="warning">Chưa bật</Badge>}>
      {required && !enabled ? <p role="alert"><strong>Nhóm yêu cầu bạn bật xác thực hai bước</strong> trước khi dùng các trang khác.</p> : null}
      {codes ? <BackupCodes codes={codes} onDone={() => setCodes(null)} /> : setup ? (
        <div className="form-stack">
          <p>1. Mở ứng dụng xác thực (Google Authenticator, Authy, 1Password…) và thêm tài khoản bằng khóa dưới đây.</p>
          <p><code aria-label="Khóa thiết lập">{secret}</code>{" "}
            <Button size="sm" variant="secondary" onClick={() => { void copyText(secret).then((ok) => (ok ? toast.success("Đã chép khóa.") : toast.error("Không chép được."))); }}>Chép khóa</Button>
          </p>
          <p className="muted">Trên điện thoại có thể mở liên kết này để thêm nhanh: <a href={setup.uri}>Thêm vào ứng dụng xác thực</a></p>
          <p>2. Nhập mã 6 số mà ứng dụng hiển thị để xác nhận.</p>
          <Field label="Mã 6 số" error={error || undefined}>
            {(field) => <input {...field} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />}
          </Field>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => { setSetup(null); setCode(""); setError(""); }}>Hủy</Button>
            <Button loading={verify.isPending} disabled={code.length !== 6} onClick={() => verify.mutate()}>Xác nhận và bật</Button>
          </div>
        </div>
      ) : (
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (!enabled) start.mutate(); }}>
          <p className="muted">{enabled ? "Cần mật khẩu để tạo lại mã dự phòng hoặc tắt." : "Thêm một lớp bảo vệ: mỗi lần đăng nhập cần thêm mã từ điện thoại."}</p>
          <Field label="Mật khẩu hiện tại" error={error || undefined}>
            {(field) => <input {...field} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />}
          </Field>
          {enabled ? (
            <div className="modal-actions">
              <Button variant="secondary" disabled={!password} loading={regenerate.isPending} onClick={() => regenerate.mutate()}>Tạo lại mã dự phòng</Button>
              <Button variant="danger" disabled={!password} loading={disable.isPending} onClick={() => { void onDisable(); }}>Tắt 2FA</Button>
            </div>
          ) : <div><Button type="submit" loading={start.isPending}>Bật xác thực hai bước</Button></div>}
        </form>
      )}
      {dialog}
    </Card>
  );
}

function SessionsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const sessions = useQuery({ queryKey: ["my-sessions"], queryFn: listSessions });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["my-sessions"] }); };
  const one = useMutation({ mutationFn: revokeSession, onSuccess: () => { toast.success("Đã đăng xuất phiên."); refresh(); }, onError: onFail(toast) });
  const others = useMutation({ mutationFn: revokeOtherSessions, onSuccess: () => { toast.success("Đã đăng xuất các phiên khác."); refresh(); }, onError: onFail(toast) });
  async function onOne(token: string) {
    if (await ask({ title: "Đăng xuất phiên này?", message: "Thiết bị đó sẽ phải đăng nhập lại.", confirmLabel: "Đăng xuất" })) one.mutate(token);
  }
  async function onOthers() {
    if (await ask({ title: "Đăng xuất mọi thiết bị khác?", message: "Chỉ phiên hiện tại được giữ lại.", confirmLabel: "Đăng xuất tất cả" })) others.mutate();
  }
  const list = sessions.data ?? [];
  return (
    <Card title="Phiên đăng nhập" actions={list.length > 1 ? <Button size="sm" variant="danger" onClick={() => { void onOthers(); }}>Đăng xuất các phiên khác</Button> : undefined}>
      {list.length === 0 ? <p className="muted">Không có dữ liệu phiên.</p> : (
        <ul className="plain-list">
          {list.map((row) => (
            <li key={row.id}>
              <strong>{row.userAgent ? row.userAgent.slice(0, 60) : "Thiết bị không rõ"}</strong>
              <span className="muted"> · {row.ipAddress ?? "IP không rõ"} · bắt đầu {new Date(row.createdAt).toLocaleString("vi-VN")}</span>
              {" "}<Button size="sm" variant="ghost" onClick={() => { void onOne(row.token); }}>Đăng xuất</Button>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Card>
  );
}

const EXPIRY: Array<{ value: string; label: string }> = [
  { value: "30", label: "30 ngày" }, { value: "90", label: "90 ngày" }, { value: "365", label: "1 năm" }, { value: "0", label: "Không hết hạn" },
];

function ApiKeysCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { ask, dialog } = useConfirm();
  const keys = useQuery({ queryKey: ["my-api-keys"], queryFn: listApiKeys });
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [fresh, setFresh] = useState<string | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["my-api-keys"] }); };
  const create = useMutation({
    mutationFn: () => createApiKey(name.trim(), Number(days) || null),
    onSuccess: (result) => { setFresh(result.key); setName(""); toast.success("Đã tạo khóa API."); refresh(); },
    onError: onFail(toast),
  });
  const remove = useMutation({ mutationFn: deleteApiKey, onSuccess: () => { toast.success("Đã xóa khóa."); refresh(); }, onError: onFail(toast) });
  async function onRemove(id: string, label: string) {
    if (await ask({ title: "Xóa khóa API?", message: `Khóa "${label}" sẽ ngừng hoạt động ngay và không hoàn tác được.`, confirmLabel: "Xóa khóa" })) remove.mutate(id);
  }
  return (
    <Card title="Khóa API cá nhân">
      <p className="muted">Khóa dùng để cho một công cụ khác gọi API với quyền của bạn. Khóa chỉ hiện đầy đủ một lần lúc tạo.</p>
      {fresh ? (
        <div className="form-stack" role="group" aria-label="Khóa mới">
          <p><strong>Chép khóa này ngay, sau này sẽ không xem lại được.</strong></p>
          <input readOnly aria-label="Khóa API mới" value={fresh} onFocus={(event) => event.currentTarget.select()} />
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => { void copyText(fresh).then((ok) => (ok ? toast.success("Đã chép khóa.") : toast.error("Không chép được."))); }}>Chép khóa</Button>
            <Button onClick={() => setFresh(null)}>Tôi đã lưu</Button>
          </div>
        </div>
      ) : (
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <Field label="Tên khóa">{(field) => <input {...field} required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />}</Field>
          <Field label="Hết hạn sau">
            {(field) => <select {...field} value={days} onChange={(event) => setDays(event.target.value)}>{EXPIRY.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}
          </Field>
          <div><Button type="submit" loading={create.isPending} disabled={!name.trim()}>Tạo khóa</Button></div>
        </form>
      )}
      {keys.data && keys.data.length > 0 ? (
        <ul className="plain-list">
          {keys.data.map((key) => (
            <li key={key.id}>
              <strong>{key.name || "Khóa không tên"}</strong> <code>{`${key.prefix ?? ""}${key.start ?? ""}…`}</code>
              <span className="muted"> · tạo {new Date(key.createdAt).toLocaleDateString("vi-VN")}{key.expiresAt ? ` · hết hạn ${new Date(key.expiresAt).toLocaleDateString("vi-VN")}` : ""}</span>
              {" "}<Button size="sm" variant="danger" onClick={() => { void onRemove(key.id, key.name || "không tên"); }}>Xóa</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {dialog}
    </Card>
  );
}

export function AccountPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  if (!me.data) return <p role="status">Đang tải…</p>;
  return (
    <div className="page-stack">
      <PageHeader title="Tài khoản của tôi" description={me.data.user.email} helpHref="/help/khong-gian-va-quyen" />
      <ProfileCard name={me.data.user.name} />
      <PasswordCard />
      <TwoFactorCard enabled={Boolean(me.data.twoFactorEnabled)} required={Boolean(me.data.twoFactorRequired)} />
      <SessionsCard />
      <ApiKeysCard />
    </div>
  );
}
