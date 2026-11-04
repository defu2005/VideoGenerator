import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ProfileDefaultBriefSchema,
  YOUTUBE_PLAYLIST_SCOPE_NOTE_VI,
  YOUTUBE_SETUP_HELP_VI,
  recommendBrief,
  type AccountConnectionDetail,
  type BriefSettings,
  type PlatformAccount,
  type PlatformId,
  type ProfileDetail,
} from "@vg/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../services/apiClient";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  profileKeys,
  useAddPlatformAccount,
  useDeletePlatformAccount,
  useProfile,
  useSetProfileArchived,
  useUpdatePlatformAccount,
  useUpdateProfile,
} from "../../hooks/useProfiles";
import { useProjects } from "../../hooks/useProjects";
import {
  accountConnectionKeys,
  checkAccountConnection,
  deleteAppCredentials,
  disconnectAccount,
  getAccountConnection,
  oauthStartUrl,
  saveAppCredentials,
} from "../../services/publishApi";
import { BriefFields } from "../projects/BriefFields";
import { ModelAdvisorPanel } from "../settings/ModelAdvisorPanel";
import {
  GuidelineFieldset,
  guidelineDraftFromSettings,
  guidelineSettingsFromDraft,
  type GuidelineDraft,
} from "../projects/GuidelineFieldset";
const TABS = [
  { id: "direction", label: "Định hướng" },
  { id: "brief", label: "Brief mặc định" },
  { id: "accounts", label: "Tài khoản" },
  { id: "projects", label: "Dự án" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const PLATFORM_OPTIONS: { value: PlatformId; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook_reels", label: "Facebook Reels" },
  { value: "instagram_reels", label: "Instagram Reels" },
];

const CONNECTION_LABEL: Record<string, string> = {
  NOT_CONNECTED: "Chưa kết nối",
  CONNECTED: "Đã kết nối",
  EXPIRED: "Hết hạn",
  ERROR: "Lỗi",
};

const EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000;

function appCredentialLabels(platform: PlatformId): { id: string; secret: string } {
  if (platform === "youtube") return { id: "Client ID", secret: "Client Secret" };
  if (platform === "tiktok") return { id: "Client Key", secret: "Client Secret" };
  return { id: "App ID", secret: "App Secret" };
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("vi-VN");
}

function isExpiringSoon(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  const expires = new Date(tokenExpiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  const remaining = expires - Date.now();
  return remaining > 0 && remaining < EXPIRY_WARN_MS;
}

function briefFromProfile(profile: ProfileDetail): BriefSettings {
  const { mode: _mode, autoRender: _auto, ...rest } = profile.defaultBrief;
  void _mode;
  void _auto;
  return rest;
}

function DirectionTab({ profile }: { profile: ProfileDetail }) {
  const update = useUpdateProfile();
  const archive = useSetProfileArchived();
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [direction, setDirection] = useState(profile.direction);
  const [language, setLanguage] = useState(profile.language);
  const [color, setColor] = useState(profile.color);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setName(profile.name);
    setDescription(profile.description);
    setDirection(profile.direction);
    setLanguage(profile.language);
    setColor(profile.color);
  }, [profile]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await update.mutateAsync({
        id: profile.id,
        input: { name, description, direction, language, color },
      });
      setMessage("Đã lưu định hướng.");
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "Lưu thất bại");
    }
  }

  return (
    <form className="panel form-panel" onSubmit={save}>
      {error && <p className="request-error" role="alert">{error}</p>}
      {message && <p className="field-hint">{message}</p>}
      <label className="form-field">
        <span>Tên</span>
        <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="form-field">
        <span>Mô tả</span>
        <textarea value={description} rows={2} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className="form-field">
        <span>Định hướng kênh</span>
        <textarea
          value={direction}
          rows={8}
          maxLength={8000}
          placeholder="Kênh nói về gì, góc nhìn, giọng điệu, điều cần tránh…"
          onChange={(event) => setDirection(event.target.value)}
        />
        <small className="field-hint">LLM dùng đoạn này khi gợi ý chủ đề và viết kịch bản (cắt ~800 ký tự trong prompt).</small>
      </label>
      <div className="form-row">
        <label className="form-field">
          <span>Ngôn ngữ</span>
          <input value={language} onChange={(event) => setLanguage(event.target.value)} />
        </label>
        <label className="form-field">
          <span>Màu</span>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
      </div>
      <div className="dialog-actions" style={{ justifyContent: "space-between" }}>
        <button
          className="button button-secondary"
          type="button"
          disabled={archive.isPending}
          onClick={() => void archive.mutateAsync({ id: profile.id, archived: profile.archivedAt === null })}
        >
          {profile.archivedAt ? "Bỏ lưu trữ" : "Lưu trữ hồ sơ"}
        </button>
        <button className="button button-primary" type="submit" disabled={update.isPending}>
          {update.isPending ? "Đang lưu…" : "Lưu"}
        </button>
      </div>
    </form>
  );
}

function BriefTab({ profile }: { profile: ProfileDetail }) {
  const update = useUpdateProfile();
  const [brief, setBrief] = useState<BriefSettings>(() => briefFromProfile(profile));
  const [mode, setMode] = useState(profile.defaultBrief.mode);
  const [autoRender, setAutoRender] = useState(profile.defaultBrief.autoRender);
  const [autoModel, setAutoModel] = useState(profile.llm?.autoModel ?? true);
  const [voice, setVoice] = useState(profile.voice?.voice ?? "");
  const [rate, setRate] = useState(profile.voice?.rate ?? "+0%");
  const [guidelineDraft, setGuidelineDraft] = useState<GuidelineDraft>(() =>
    guidelineDraftFromSettings({ guidelines: profile.guidelines }));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setBrief(briefFromProfile(profile));
    setMode(profile.defaultBrief.mode);
    setAutoRender(profile.defaultBrief.autoRender);
    setAutoModel(profile.llm?.autoModel ?? true);
    setVoice(profile.voice?.voice ?? "");
    setRate(profile.voice?.rate ?? "+0%");
    setGuidelineDraft(guidelineDraftFromSettings({ guidelines: profile.guidelines }));
  }, [profile]);

  function changeBrief(path: string, value: string | number | boolean) {
    setBrief((current) => {
      if (path === "subtitles.enabled") return { ...current, subtitles: { ...current.subtitles, enabled: Boolean(value) } };
      if (path === "subtitles.maxCharsPerLine") return { ...current, subtitles: { ...current.subtitles, maxCharsPerLine: Number(value) } };
      if (path === "music.enabled") return { ...current, music: { ...current.music, enabled: Boolean(value) } };
      if (path === "music.volume") return { ...current, music: { ...current.music, volume: Number(value) } };
      if (path === "budget.mode") {
        return { ...current, budget: { ...current.budget, mode: value as BriefSettings["budget"]["mode"] } };
      }
      if (path.startsWith("budget.features.")) {
        const key = path.slice("budget.features.".length) as keyof NonNullable<BriefSettings["budget"]["features"]>;
        return { ...current, budget: { ...current.budget, features: { ...current.budget.features, [key]: value } } };
      }
      return { ...current, [path]: value } as BriefSettings;
    });
  }

  function resetBrief(path: string) {
    const resolved = recommendBrief({ topic: profile.name, settings: { ...brief, userSet: brief.userSet.filter((item) => item !== path) } }).values.settings;
    setBrief(resolved);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const defaultBrief = ProfileDefaultBriefSchema.parse({ ...brief, mode, autoRender });
      const guidelines = guidelineSettingsFromDraft(guidelineDraft);
      await update.mutateAsync({
        id: profile.id,
        input: {
          defaultBrief,
          voice: voice.trim() ? { voice: voice.trim(), ...(rate ? { rate } : {}) } : null,
          ...(guidelines ? { guidelines } : {}),
          llm: {
            ...(profile.llm ?? {}),
            autoModel,
          },
        },
      });
      setMessage("Đã lưu brief mặc định.");
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "Lưu thất bại");
    }
  }

  return (
    <form className="panel form-panel" onSubmit={save}>
      {error && <p className="request-error" role="alert">{error}</p>}
      {message && <p className="field-hint">{message}</p>}
      <BriefFields topic={profile.name} settings={brief} onChange={changeBrief} onReset={resetBrief} />
      <div className="form-row">
        <label className="form-field">
          <span>Mode mặc định</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="ASSISTED">ASSISTED</option>
            <option value="AUTO">AUTO</option>
            <option value="MANUAL">MANUAL</option>
          </select>
        </label>
        <label className="checkbox-field" style={{ alignSelf: "end", marginBottom: 12 }}>
          <input type="checkbox" checked={autoRender} onChange={(event) => setAutoRender(event.target.checked)} />
          Tự render
        </label>
        <label className="checkbox-field" style={{ alignSelf: "end", marginBottom: 12 }}>
          <input
            type="checkbox"
            aria-label="Tự chọn model"
            checked={autoModel}
            onChange={(event) => setAutoModel(event.target.checked)}
          />
          Tự chọn model
        </label>
      </div>
      <ModelAdvisorPanel scope="profile" id={profile.id} budgetMode={brief.budget.mode} />
      <div className="form-row">
        <label className="form-field">
          <span>Giọng đọc</span>
          <input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="vi-VN-HoaiMyNeural" />
        </label>
        <label className="form-field">
          <span>Tốc độ</span>
          <input value={rate} onChange={(event) => setRate(event.target.value)} placeholder="+0%" />
        </label>
      </div>
      <GuidelineFieldset draft={guidelineDraft} brief={brief} onChange={setGuidelineDraft} />
      <div className="dialog-actions">
        <button className="button button-primary" type="submit" disabled={update.isPending}>
          {update.isPending ? "Đang lưu…" : "Lưu brief"}
        </button>
      </div>
    </form>
  );
}

function AccountCard({
  profileId,
  account,
  onEdit,
  onDeleted,
  onError,
}: {
  profileId: string;
  account: PlatformAccount;
  onEdit: (account: PlatformAccount) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const remove = useDeletePlatformAccount();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [credMessage, setCredMessage] = useState("");
  const [checkMessage, setCheckMessage] = useState("");
  const [busy, setBusy] = useState<"disconnect" | "check" | "saveCreds" | "deleteCreds" | null>(null);

  const connectionQuery = useQuery({
    queryKey: accountConnectionKeys.detail(profileId, account.id),
    queryFn: () => getAccountConnection(profileId, account.id),
  });

  const detail: AccountConnectionDetail | undefined = connectionQuery.data;
  const connection = detail?.connection ?? account.connection;
  const displayName = detail?.displayName ?? account.displayName;
  const handle = detail?.handle ?? account.handle;
  const externalId = detail?.externalId ?? account.externalId;
  const redirectUri = detail?.redirectUri
    ?? oauthStartUrl(account.platform, account.id).replace(/\/start\?.*/, "/callback");
  const labels = appCredentialLabels(account.platform);
  const showAppCreds = account.platform !== "mock";
  const canConnect = detail?.canConnect ?? false;
  const connectBlockedReason = detail?.connectBlockedReason ?? null;
  const reconnect = connection === "EXPIRED" || connection === "ERROR";
  const connected = connection === "CONNECTED";
  const expiringSoon = isExpiringSoon(detail?.tokenExpiresAt ?? null);

  async function invalidateConnection() {
    await queryClient.invalidateQueries({ queryKey: accountConnectionKeys.detail(profileId, account.id) });
    await queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) });
  }

  function openConnect() {
    if (!canConnect) return;
    window.open(oauthStartUrl(account.platform, account.id), "_blank", "noopener,noreferrer");
    window.setTimeout(() => {
      void invalidateConnection();
    }, 1500);
  }

  async function onDisconnect() {
    if (!window.confirm("Ngắt kết nối tài khoản này? Token đã lưu sẽ bị xóa.")) return;
    setBusy("disconnect");
    onError("");
    try {
      await disconnectAccount(profileId, account.id);
      await invalidateConnection();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Ngắt kết nối thất bại");
    } finally {
      setBusy(null);
    }
  }

  async function onCheck() {
    setBusy("check");
    setCheckMessage("");
    onError("");
    try {
      const result = await checkAccountConnection(profileId, account.id);
      queryClient.setQueryData(accountConnectionKeys.detail(profileId, account.id), result);
      await queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) });
      setCheckMessage(
        result.connection === "CONNECTED"
          ? "Kết nối ổn."
          : (result.connectionError ?? CONNECTION_LABEL[result.connection] ?? result.connection),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Kiểm tra thất bại");
    } finally {
      setBusy(null);
    }
  }

  async function onSaveCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy("saveCreds");
    setCredMessage("");
    onError("");
    try {
      const saved = await saveAppCredentials(profileId, account.id, {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setClientId("");
      setClientSecret("");
      setCredMessage(`Đã lưu (…${saved.idHint}).`);
      await invalidateConnection();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Lưu thông tin ứng dụng thất bại");
    } finally {
      setBusy(null);
    }
  }

  async function onDeleteCredentials() {
    if (!window.confirm("Xóa thông tin ứng dụng đã lưu cho tài khoản này?")) return;
    setBusy("deleteCreds");
    setCredMessage("");
    onError("");
    try {
      await deleteAppCredentials(profileId, account.id);
      setCredMessage("Đã xóa thông tin ứng dụng.");
      await invalidateConnection();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Xóa thông tin ứng dụng thất bại");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="account-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong>{displayName}</strong>
          <div className="profile-card-meta">
            <span>{PLATFORM_OPTIONS.find((item) => item.value === account.platform)?.label ?? account.platform}</span>
            <span>{account.format === "vertical" ? "9:16" : "16:9"}</span>
            {handle && <span>{handle}</span>}
            {externalId && <span>ID: {externalId}</span>}
            <span className={`connection-badge${connection === "EXPIRED" || connection === "ERROR" ? " is-error" : ""}`}>
              {CONNECTION_LABEL[connection] ?? connection}
            </span>
          </div>
          {(connection === "EXPIRED" || connection === "ERROR") && (detail?.connectionError || account.connectionError) && (
            <p className="request-error" role="alert" style={{ margin: "0.35rem 0 0" }}>
              {detail?.connectionError ?? account.connectionError}
            </p>
          )}
          {detail && (
            <div className="page-subtitle" style={{ margin: "0.45rem 0 0", display: "grid", gap: 4 }}>
              {detail.tokenExpiresAt && (
                <span>
                  Token hết hạn: {formatDateTime(detail.tokenExpiresAt)}
                  {expiringSoon && (
                    <span style={{ color: "#b42318", fontWeight: 700, marginLeft: 8 }}>Sắp hết hạn</span>
                  )}
                </span>
              )}
              {detail.scopes.length > 0 && (
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                  Quyền:
                  {detail.scopes.map((scope) => (
                    <span key={scope} className="connection-badge">{scope}</span>
                  ))}
                </span>
              )}
              {detail.lastCheckedAt && (
                <span>Lần kiểm tra: {formatDateTime(detail.lastCheckedAt)}</span>
              )}
            </div>
          )}
          <p className="page-subtitle" style={{ margin: "0.35rem 0 0" }}>
            Redirect URI:{" "}
            <code>{redirectUri}</code>
            {" "}
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void navigator.clipboard.writeText(redirectUri)}
            >
              Sao chép
            </button>
          </p>
          {account.platform === "youtube" && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hướng dẫn kết nối YouTube</summary>
              <pre
                className="page-subtitle"
                style={{
                  whiteSpace: "pre-wrap",
                  margin: "0.5rem 0 0",
                  fontFamily: "inherit",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                {YOUTUBE_SETUP_HELP_VI}
              </pre>
            </details>
          )}
          {account.platform === "youtube" && account.publishSettings.playlistId && (
            <p className="field-hint" style={{ margin: "0.5rem 0 0" }}>{YOUTUBE_PLAYLIST_SCOPE_NOTE_VI}</p>
          )}
        </div>
        <div className="account-row-actions">
          {connected ? (
            <>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy === "check"}
                onClick={() => void onCheck()}
              >
                {busy === "check" ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={busy === "disconnect"}
                onClick={() => void onDisconnect()}
              >
                Ngắt kết nối
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              <button
                className="button button-secondary"
                type="button"
                disabled={!canConnect || connectionQuery.isPending}
                title={connectBlockedReason ?? undefined}
                onClick={() => openConnect()}
              >
                {reconnect ? "Kết nối lại" : "Kết nối"}
              </button>
              {!canConnect && connectBlockedReason && (
                <small className="field-hint" style={{ maxWidth: 220 }}>{connectBlockedReason}</small>
              )}
            </div>
          )}
          <button className="button button-secondary" type="button" onClick={() => onEdit(account)}>Sửa</button>
          <button
            className="button button-secondary"
            type="button"
            disabled={remove.isPending}
            onClick={() => void remove.mutateAsync({ profileId, accountId: account.id }).then(onDeleted).catch((err) => {
              onError(err instanceof Error ? err.message : "Xóa thất bại");
            })}
          >
            Xóa
          </button>
        </div>
      </div>
      {checkMessage && <p className="field-hint" style={{ margin: "0.5rem 0 0" }}>{checkMessage}</p>}
      {showAppCreds && (
        <section style={{ marginTop: 12, borderTop: "1px solid #eef0f4", paddingTop: 12 }}>
          <h3 style={{ margin: "0 0 0.35rem", fontSize: 14 }}>Thông tin ứng dụng</h3>
          <p className="page-subtitle" style={{ margin: "0 0 0.75rem" }}>
            {detail?.appCredentials.configured
              ? `Đã cấu hình (…${detail.appCredentials.idHint ?? ""})`
              : "Chưa cấu hình (dùng .env nếu có)"}
          </p>
          <form className="form-panel" style={{ padding: 0, boxShadow: "none", border: "none" }} onSubmit={(event) => void onSaveCredentials(event)}>
            <div className="form-row">
              <label className="form-field">
                <span>{labels.id}</span>
                <input
                  value={clientId}
                  autoComplete="off"
                  required
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>{labels.secret}</span>
                <input
                  type="password"
                  value={clientSecret}
                  autoComplete="off"
                  required
                  onChange={(event) => setClientSecret(event.target.value)}
                />
              </label>
            </div>
            <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
              <button className="button button-primary" type="submit" disabled={busy === "saveCreds"}>
                {busy === "saveCreds" ? "Đang lưu…" : "Lưu thông tin ứng dụng"}
              </button>
              {detail?.appCredentials.configured && (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy === "deleteCreds"}
                  onClick={() => void onDeleteCredentials()}
                >
                  Xóa thông tin ứng dụng
                </button>
              )}
            </div>
            {credMessage && <p className="field-hint">{credMessage}</p>}
          </form>
        </section>
      )}
    </li>
  );
}

function AccountsTab({ profile }: { profile: ProfileDetail }) {
  const add = useAddPlatformAccount();
  const update = useUpdatePlatformAccount();
  const [platform, setPlatform] = useState<PlatformId>("youtube");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [format, setFormat] = useState<"landscape" | "vertical" | "">("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [autoPublish, setAutoPublish] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlatformAccount | null>(null);

  const formPlatform = editing?.platform ?? platform;
  const showYoutubePublishExtras = formPlatform === "youtube";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const youtubeExtras = showYoutubePublishExtras
        ? {
          categoryId: categoryId.trim(),
          playlistId: playlistId.trim(),
        }
        : {};
      if (editing) {
        await update.mutateAsync({
          profileId: profile.id,
          accountId: editing.id,
          input: {
            displayName,
            handle: handle.trim() || null,
            ...(format ? { format } : {}),
            publishSettings: { visibility, autoPublish, ...youtubeExtras },
          },
        });
        setEditing(null);
      } else {
        await add.mutateAsync({
          profileId: profile.id,
          input: {
            platform,
            displayName,
            handle: handle.trim() || null,
            ...(format ? { format } : {}),
            publishSettings: { visibility, autoPublish, ...youtubeExtras },
          },
        });
      }
      setDisplayName("");
      setHandle("");
      setFormat("");
      setVisibility("public");
      setAutoPublish(false);
      setCategoryId("");
      setPlaylistId("");
    } catch (err) {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "Thao tác thất bại");
    }
  }

  function startEdit(account: PlatformAccount) {
    setEditing(account);
    setPlatform(account.platform);
    setDisplayName(account.displayName);
    setHandle(account.handle ?? "");
    setFormat(account.format);
    setVisibility(account.publishSettings.visibility);
    setAutoPublish(account.publishSettings.autoPublish);
    setCategoryId(account.publishSettings.categoryId ?? "");
    setPlaylistId(account.publishSettings.playlistId ?? "");
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Tài khoản nền tảng</h2>
        {error && <p className="request-error" role="alert">{error}</p>}
        {profile.accounts.length === 0 ? (
          <p className="page-subtitle">Chưa có tài khoản. Thêm YouTube, TikTok… rồi nhấn Kết nối.</p>
        ) : (
          <ul className="account-list">
            {profile.accounts.map((account) => (
              <AccountCard
                key={account.id}
                profileId={profile.id}
                account={account}
                onEdit={startEdit}
                onDeleted={() => setError("")}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </section>
      <form className="panel form-panel" onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>{editing ? "Sửa tài khoản" : "Thêm tài khoản"}</h2>
        {error && <p className="request-error" role="alert">{error}</p>}
        {!editing && (
          <label className="form-field">
            <span>Nền tảng</span>
            <select value={platform} onChange={(event) => setPlatform(event.target.value as PlatformId)}>
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="form-field">
          <span>Tên hiển thị</span>
          <input value={displayName} required maxLength={200} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="form-field">
          <span>Handle</span>
          <input value={handle} maxLength={200} placeholder="@channel" onChange={(event) => setHandle(event.target.value)} />
        </label>
        <label className="form-field">
          <span>Định dạng</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
            <option value="">Mặc định theo nền tảng</option>
            <option value="landscape">Landscape 16:9</option>
            <option value="vertical">Vertical 9:16</option>
          </select>
        </label>
        <div className="form-row">
          <label className="form-field">
            <span>Visibility</span>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>
              <option value="public">public</option>
              <option value="unlisted">unlisted</option>
              <option value="private">private</option>
            </select>
          </label>
          <label className="checkbox-field" style={{ alignSelf: "end", marginBottom: 12 }}>
            <input type="checkbox" checked={autoPublish} onChange={(event) => setAutoPublish(event.target.checked)} />
            Tự đăng
          </label>
        </div>
        {showYoutubePublishExtras && (
          <>
            <div className="form-row">
              <label className="form-field">
                <span>Category ID (YouTube)</span>
                <input
                  value={categoryId}
                  placeholder="27 (Education)"
                  maxLength={20}
                  onChange={(event) => setCategoryId(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Playlist ID (YouTube)</span>
                <input
                  value={playlistId}
                  placeholder="PL…"
                  maxLength={200}
                  onChange={(event) => setPlaylistId(event.target.value)}
                />
              </label>
            </div>
            {playlistId.trim() && (
              <p className="field-hint">{YOUTUBE_PLAYLIST_SCOPE_NOTE_VI}</p>
            )}
          </>
        )}
        <div className="dialog-actions">
          {editing && (
            <button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Hủy sửa</button>
          )}
          <button className="button button-primary" type="submit" disabled={add.isPending || update.isPending}>
            {editing ? "Lưu tài khoản" : "Thêm tài khoản"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProjectsTab({ profile }: { profile: ProfileDetail }) {
  const projects = useProjects({
    profileId: profile.id,
    includeArchived: false,
    archivedOnly: false,
    sort: "updatedAt",
    order: "desc",
    page: 1,
    pageSize: 20,
  });

  if (projects.isPending) return <Spinner label="Đang tải dự án" />;
  if (projects.isError) {
    return <ErrorState message={projects.error instanceof Error ? projects.error.message : "Lỗi"} onRetry={() => void projects.refetch()} />;
  }
  if (projects.data.items.length === 0) {
    return <p className="page-subtitle">Chưa có dự án gắn với hồ sơ này.</p>;
  }
  return (
    <div className="project-list panel">
      {projects.data.items.map((project) => (
        <article key={project.id} className="project-card">
          <div className="project-card-main">
            <div className="project-card-title">
              <Link to={`/projects/${project.id}/overview`}><h2>{project.title}</h2></Link>
            </div>
            <p className="project-topic">{project.topic}</p>
            <div className="project-meta">
              <span>{project.status}</span>
              <span>{project.mode}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ProfileDetailPage() {
  const { id = "", tab = "direction" } = useParams();
  const profile = useProfile(id);
  const activeTab = (TABS.some((item) => item.id === tab) ? tab : "direction") as TabId;

  const heading = useMemo(() => profile.data?.name ?? "Hồ sơ", [profile.data?.name]);

  if (!TABS.some((item) => item.id === tab)) {
    return <Navigate replace to={`/profiles/${id}/direction`} />;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Link to="/profiles">Hồ sơ</Link></p>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {profile.data && <span className="profile-color-dot" style={{ background: profile.data.color }} />}
            {heading}
          </h1>
        </div>
      </div>
      <nav className="tab-bar" aria-label="Profile tabs">
        {TABS.map((item) => (
          <Link
            key={item.id}
            to={`/profiles/${id}/${item.id}`}
            className={item.id === activeTab ? "active" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {profile.isPending ? (
        <Spinner label="Đang tải hồ sơ" />
      ) : profile.isError ? (
        <ErrorState message={profile.error instanceof Error ? profile.error.message : "Lỗi"} onRetry={() => void profile.refetch()} />
      ) : !profile.data ? (
        <section className="state-card"><h2>Không tìm thấy hồ sơ</h2><Link to="/profiles">Quay lại danh sách</Link></section>
      ) : activeTab === "direction" ? (
        <DirectionTab profile={profile.data} />
      ) : activeTab === "brief" ? (
        <BriefTab profile={profile.data} />
      ) : activeTab === "accounts" ? (
        <AccountsTab profile={profile.data} />
      ) : (
        <ProjectsTab profile={profile.data} />
      )}
    </div>
  );
}
