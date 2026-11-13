import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { validatePlatformAppInput, type PlatformAccount, type PlatformId } from "@vg/shared";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { findDuplicateAccounts, getAllAccounts, getPlatformApp, savePlatformApp } from "../../services/connectionsApi";
import { addPlatformAccount, deletePlatformAccount, getProfiles, updatePlatformAccount } from "../../services/profilesApi";
import { getAccountConnection, oauthStartUrl, saveAppCredentials } from "../../services/publishApi";
import { PLATFORM_LABEL } from "./platforms";
import { useToast } from "../../components/ui/Toast";
import { VerifyPlatformApp } from "./VerifyPlatformApp";

type Step = "choose" | "app" | "connect" | "done";

const STEP_LABEL: Record<Step, string> = {
  choose: "1. Chọn nền tảng",
  app: "2. Ứng dụng nhà phát triển",
  connect: "3. Đăng nhập",
  done: "4. Xong",
};

const PLATFORMS: PlatformId[] = ["youtube", "tiktok", "facebook_reels", "instagram_reels"];

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Không thực hiện được";
}

export function AddAccountWizard({
  open,
  onClose,
  defaultProfileId,
  accountId,
  editApp = false,
}: {
  open: boolean;
  onClose: () => void;
  defaultProfileId?: string;
  accountId?: string;
  editApp?: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const existingAccounts = useQuery({ queryKey: ["accounts", "all"], queryFn: getAllAccounts, enabled: open && Boolean(accountId) });
  const profiles = useQuery({ queryKey: ["profiles", "list"], queryFn: () => getProfiles(), enabled: open });
  const [step, setStep] = useState<Step>("choose");
  const [platform, setPlatform] = useState<PlatformId>("youtube");
  const [profileId, setProfileId] = useState(defaultProfileId ?? "");
  const [displayName, setDisplayName] = useState("");
  const [createdAccount, setAccount] = useState<PlatformAccount | null>(null);
  const account = accountId ? existingAccounts.data?.accounts.find((item) => item.id === accountId) ?? null : createdAccount;
  const [resuming, setResuming] = useState(false);
  const [showLoginHelp, setShowLoginHelp] = useState(false);
  const [editingApp, setEditingApp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [loginStartedAt, setLoginStartedAt] = useState(0);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scope, setScope] = useState<"app" | "profile">("app");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(accountId ? "app" : "choose");
    setResuming(Boolean(accountId) && !editApp);
    setEditingApp(editApp);
    setAccount(null);
    setError("");
    setWaiting(false);
    setDisplayName("");
    setClientId("");
    setClientSecret("");
    setCopied(false);
  }, [open, accountId, editApp]);

  useEffect(() => {
    if (profileId || !profiles.data?.items[0]) return;
    setProfileId(defaultProfileId ?? profiles.data.items[0].id);
  }, [profiles.data, profileId, defaultProfileId]);

  const activePlatform = account?.platform ?? platform;
  const activeProfile = account?.profileId ?? profileId;
  const app = useQuery({
    queryKey: ["connections", "platform-app", activePlatform, activeProfile, account?.id ?? ""],
    queryFn: () => getPlatformApp(activePlatform, activeProfile || undefined, account?.id),
    enabled: open && step !== "choose" && account !== null,
  });
  useEffect(() => {
    if (!resuming || !app.data) return;
    if (app.data.configured && !app.data.problems?.length) setStep("connect");
    setResuming(false);
  }, [resuming, app.data]);

  useEffect(() => {
    if (app.data?.source === "profile") setScope("profile");
    else setScope("app");
  }, [app.data?.source]);

  useEffect(() => {
    setShowLoginHelp(false);
    if (!open || !waiting || activePlatform !== "youtube") return;
    const timer = setTimeout(() => setShowLoginHelp(true), 20_000);
    return () => clearTimeout(timer);
  }, [open, waiting, activePlatform]);

  const connection = useQuery({
    queryKey: ["accounts", "connection", account?.id ?? ""],
    queryFn: () => getAccountConnection(account!.profileId, account!.id),
    enabled: open && waiting && account !== null,
    refetchInterval: 2000,
  });

  const duplicates = useQuery({
    queryKey: ["accounts", "duplicates", activePlatform, connection.data?.externalId ?? "", account?.id ?? ""],
    queryFn: () => findDuplicateAccounts(activePlatform, connection.data!.externalId!, account!.id),
    enabled: step === "done" && Boolean(connection.data?.externalId) && account !== null,
  });

  useEffect(() => {
    if (!waiting || !connection.data) return;
    if (connection.data.connection === "CONNECTED") {
      setWaiting(false);
      setStep("done");
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    } else if (connection.data.connection === "ERROR" && !connection.isFetching && connection.dataUpdatedAt > loginStartedAt + 1000) {
      setWaiting(false);
      setError(connection.data.connectionError ?? "Chưa kết nối được. Hãy đăng nhập lại.");
    }
  }, [waiting, connection.data, connection.isFetching, connection.dataUpdatedAt, loginStartedAt, queryClient]);

  async function onChoose(event: FormEvent) {
    event.preventDefault();
    if (!profileId) {
      setError("Chọn hồ sơ trước.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await addPlatformAccount(profileId, {
        platform,
        displayName: PLATFORM_LABEL[platform],
      });
      setAccount(created);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setStep("app");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveApp(event: FormEvent) {
    event.preventDefault();
    if (!validation.ok) return;
    setBusy(true);
    setError("");
    try {
      if (app.data?.source === "account" && account) {
        await saveAppCredentials(account.profileId, account.id, { clientId: clientId.trim(), clientSecret: clientSecret.trim() });
      } else await savePlatformApp(activePlatform, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        scope,
        ...(scope === "profile" ? { profileId: activeProfile } : {}),
      });
      setClientId("");
      setClientSecret("");
      const refreshed = await app.refetch();
      if (refreshed.error) throw refreshed.error;
      if (refreshed.data?.problems?.length) {
        setError("Ứng dụng đang dùng vẫn có lỗi. Kiểm tra phạm vi lưu rồi nhập lại.");
      } else setStep("connect");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function openLogin() {
    if (!account) return;
    setError("");
    setLoginStartedAt(Date.now());
    window.open(oauthStartUrl(account.platform, account.id), "_blank", "noopener,noreferrer");
    setWaiting(true);
  }

  async function closeWizard() {
    if (busy) return;
    if (step !== "done" && createdAccount && !accountId) {
      setBusy(true);
      try {
        await deletePlatformAccount(createdAccount.profileId, createdAccount.id, true);
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        toast.success("Đã huỷ thêm tài khoản");
      } catch (reason) {
        setError(errorMessage(reason));
        return;
      } finally {
        setBusy(false);
      }
    }
    onClose();
  }

  const validation = validatePlatformAppInput(activePlatform, { clientId, clientSecret });

  async function copyRedirect() {
    if (!app.data) return;
    try {
      await navigator.clipboard.writeText(app.data.redirectUri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const profileOptions = (profiles.data?.items ?? []).map((profile) => ({ value: profile.id, label: profile.name }));

  return (
    <Modal open={open} title={accountId ? "Kết nối tài khoản nền tảng" : "Thêm tài khoản nền tảng"} onClose={() => void closeWizard()} closeOnBackdrop>
      <button type="button" aria-label="Đóng trình kết nối" className="link-button" disabled={busy} onClick={() => void closeWizard()}>×</button>
      <ol className="wizard-steps" aria-label="Các bước">
        {(Object.keys(STEP_LABEL) as Step[]).map((id) => (
          <li key={id} aria-current={id === step ? "step" : undefined}>{STEP_LABEL[id]}</li>
        ))}
      </ol>
      {(connection.data?.marketWarning ?? account?.marketWarning) && (
        <p role="status">{connection.data?.marketWarning ?? account?.marketWarning}</p>
      )}

      {step === "choose" ? (
        <form onSubmit={(event) => void onChoose(event)} className="form-stack">
          <Select
            label="Nền tảng"
            value={platform}
            onChange={(value) => setPlatform(value as PlatformId)}
            options={PLATFORMS.map((id) => ({ value: id, label: PLATFORM_LABEL[id] }))}
          />
          {profileOptions.length === 0 && !profiles.isPending
            ? <p className="ui-field-error">Chưa có hồ sơ nào. Hãy tạo hồ sơ trước.</p>
            : <Select label="Hồ sơ" value={profileId} onChange={setProfileId} options={profileOptions} />}
          <div className="key-row-actions">
            <Button type="submit" loading={busy} disabled={!profileId}>Tiếp</Button>
            <Button variant="ghost" onClick={() => void closeWizard()}>Huỷ</Button>
          </div>
        </form>
      ) : null}

      {step === "app" ? (
        <div className="form-stack">
          {app.isError || existingAccounts.isError ? <p role="alert">{app.error?.message ?? existingAccounts.error?.message}</p>
            : app.isPending ? <p>Đang kiểm tra ứng dụng…</p> : null}
          {app.data ? (
            <>
              <p>
                {app.data.configured
                  ? `Đã có ứng dụng (${sourceLabel(app.data.source)}${app.data.hint ? ` · ${app.data.hint}` : ""}). Có thể dùng luôn hoặc nhập ứng dụng khác.`
                  : "Nền tảng cần một ứng dụng nhà phát triển (Client ID và Client Secret) để đăng nhập."}
              </p>
              {app.data.howToVi.length > 0 ? (
                <ol className="connection-howto">{app.data.howToVi.map((line) => <li key={line}>{line}</li>)}</ol>
              ) : null}
              {app.data.noteVi ? <p>{app.data.noteVi}</p> : null}
              {app.data.problems?.length ? <div role="alert">
                {app.data.problems.map((problem) => <p key={problem}>{problem}</p>)}
                <Button variant="secondary" onClick={() => setEditingApp(true)}>Nhập lại</Button>
              </div> : null}
              <div className="copy-line">
                <span>Redirect URI:</span>
                <code data-testid="redirect-uri">{app.data.redirectUri}</code>
                <Button size="sm" variant="secondary" onClick={() => void copyRedirect()}>{copied ? "Đã chép" : "Chép"}</Button>
              </div>
              {app.data.consoleUrl ? (
                <p><a href={app.data.consoleUrl} target="_blank" rel="noopener noreferrer">Mở trang quản lý ứng dụng</a></p>
              ) : null}
              {!app.data.problems?.length || editingApp ? <form onSubmit={(event) => void onSaveApp(event)} className="form-stack">
                <Field label="Client ID" error={clientId ? validation.errors.clientId : undefined}>
                  {(props) => <input {...props} type="text" autoComplete="off" value={clientId} onChange={(event) => setClientId(event.target.value)} />}
                </Field>
                <Field label="Client Secret" error={clientSecret ? validation.errors.clientSecret : undefined}>
                  {(props) => <input {...props} type="password" autoComplete="off" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />}
                </Field>
                {clientSecret ? validation.warnings.map((warning) => <p key={warning}>{warning}</p>) : null}
                {app.data.source !== "account" ? <Select
                  label="Dùng cho"
                  value={scope}
                  onChange={(value) => setScope(value === "profile" ? "profile" : "app")}
                  options={[
                    { value: "app", label: "Mọi hồ sơ (dùng chung)" },
                    { value: "profile", label: "Chỉ hồ sơ này" },
                  ]}
                /> : null}
                <div className="key-row-actions">
                  <Button type="submit" loading={busy} disabled={!validation.ok}>Lưu và tiếp</Button>
                  {app.data.configured && !app.data.problems?.length ? <Button variant="secondary" onClick={() => setStep("connect")}>Dùng ứng dụng hiện có</Button> : null}
                </div>
              </form> : null}
              {activePlatform === "youtube" && app.data.configured ? <VerifyPlatformApp profileId={activeProfile} accountId={account?.id} /> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {step === "connect" ? (
        <div className="form-stack">
          <p>Bấm Đăng nhập để mở trang của {PLATFORM_LABEL[activePlatform]} trong tab mới. Sau khi bạn cho phép, cửa sổ này tự chuyển sang bước cuối.</p>
          <div className="key-row-actions">
            <Button onClick={openLogin}>{waiting ? "Mở lại trang đăng nhập" : "Đăng nhập"}</Button>
            <Button variant="ghost" onClick={() => { setWaiting(false); setStep("app"); }}>Quay lại</Button>
          </div>
          {waiting ? <p role="status">Đang chờ bạn đăng nhập…</p> : null}
          {showLoginHelp ? <aside>
            <strong>Trang đăng nhập báo lỗi?</strong>
            <ul>{app.data?.troubleshootVi?.map(({ code, titleVi, fixVi }) => <li key={code}>{titleVi} · {fixVi}</li>)}</ul>
            <VerifyPlatformApp profileId={activeProfile} accountId={account?.id} />
            <Button variant="secondary" onClick={() => { setWaiting(false); setEditingApp(true); setStep("app"); }}>Sửa ứng dụng</Button>
          </aside> : null}
        </div>
      ) : null}

      {step === "done" ? (
        <div className="form-stack">
          <p role="status">
            Đã kết nối {connection.data?.displayName ?? account?.displayName}
            {connection.data?.handle ? ` (${connection.data.handle})` : ""}.
          </p>
          {duplicates.data && duplicates.data.duplicates.length > 0 ? (
            <p className="ui-field-error" role="alert">
              Kênh này đã có trong hồ sơ {duplicates.data.duplicates.map((item) => item.profileName).join(", ")}. Video có thể bị
              đăng hai lần; hãy xoá bớt một tài khoản nếu không cố ý.
            </p>
          ) : null}
          <div className="key-row-actions">
            <Field label="Đổi tên gợi nhớ" hint={displayName.includes("@") ? "Tên gợi nhớ, không phải email đăng nhập" : "Không bắt buộc."}>
              {(props) => <input {...props} maxLength={200} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />}
            </Field>
            <Button variant="secondary" loading={busy} disabled={!displayName.trim() || displayName.includes("@")} onClick={async () => {
              if (!account) return;
              setBusy(true);
              try {
                await updatePlatformAccount(account.profileId, account.id, { displayName: displayName.trim() });
                await queryClient.invalidateQueries({ queryKey: ["accounts"] });
                onClose();
              } catch (reason) { setError(errorMessage(reason)); }
              finally { setBusy(false); }
            }}>Lưu tên</Button>
            <Button onClick={onClose}>Xong</Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
      {step !== "choose" && step !== "done" ? <Button variant="ghost" disabled={busy} onClick={() => void closeWizard()}>Huỷ</Button> : null}
    </Modal>
  );
}

function sourceLabel(source: string): string {
  if (source === "account") return "riêng tài khoản này";
  if (source === "profile") return "riêng hồ sơ";
  if (source === "app") return "dùng chung trong app";
  if (source === "env") return "từ file .env";
  return "chưa có";
}
