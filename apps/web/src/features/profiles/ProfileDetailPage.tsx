import { ProfileKnowledgeTab } from "./ProfileKnowledgeTab";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  META_RECONNECT_SOON_VI,
  META_SETUP_HELP_VI,
  ProfileDefaultBriefSchema,
  TIKTOK_SETUP_HELP_VI,
  YOUTUBE_PLAYLIST_SCOPE_NOTE_VI,
  YOUTUBE_SETUP_HELP_VI,
  MOTION_TEMPLATES,
  recommendBrief,
  TTS_CATALOG,
  type AccountConnectionDetail,
  type BriefSettings,
  type PlatformAccount,
  type PlatformId,
  type ProfileDetail,
  type TikTokUploadModeValue,
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
  selectMetaTarget,
} from "../../services/publishApi";
import { BriefFields } from "../projects/BriefFields";
import { EditStyleFields } from "../projects/EditStyleFields";
import { ModelAdvisorPanel } from "../settings/ModelAdvisorPanel";
import {
  GuidelineFieldset,
  guidelineDraftFromSettings,
  guidelineSettingsFromDraft,
  type GuidelineDraft,
} from "../projects/GuidelineFieldset";
import { AutomationTab } from "./AutomationTab";
import { InsightsTab } from "./InsightsTab";
import { CommentSettingsForm } from "../comments/CommentSettingsForm";
import { setYoutubeCommentSync } from "../../services/commentsApi";
import { TopicsTab } from "./TopicsTab";
import { ProfileMemoryTab } from "./ProfileMemoryTab";
import { StyleTab } from "./StyleTab";
import { AutonomySettingsPanel } from "../operator/AutonomySettingsPanel";
const TABS = [
  { id: "direction", label: "Định hướng" },
  { id: "brief", label: "Brief mặc định" },
  { id: "style", label: "Phong cách" },
  { id: "topics", label: "Chủ đề" },
  { id: "automation", label: "Tự động" },
  { id: "autonomy", label: "Tự vận hành" },
  { id: "insights", label: "Bài học" },
  { id: "knowledge", label: "Tri thức" },
  { id: "memory", label: "Ghi nhớ" },
  { id: "accounts", label: "Tài khoản" },
  { id: "comments", label: "Bình luận" },
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
    setColor(profile.color);
  }, [profile.name, profile.description, profile.direction, profile.color]);
  useEffect(() => setLanguage(profile.language), [profile.language]);

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
  const [quotaPolicy, setQuotaPolicy] = useState(profile.llm?.quotaPolicy ?? "");
  const [paidCap, setPaidCap] = useState(profile.llm?.paidFallbackDailyUsd === undefined ? "" : String(profile.llm.paidFallbackDailyUsd));
  const [voice, setVoice] = useState(profile.voice?.voice ?? "");
  const [rate, setRate] = useState(profile.voice?.rate ?? "+0%");
  const [ttsProvider, setTtsProvider] = useState(profile.voice?.provider ?? "");
  const [ttsModel, setTtsModel] = useState(profile.voice?.model ?? "");
  const [ttsStyle, setTtsStyle] = useState(profile.voice?.style ?? "");
  const [guidelineDraft, setGuidelineDraft] = useState<GuidelineDraft>(() =>
    guidelineDraftFromSettings({ guidelines: profile.guidelines }));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setBrief(briefFromProfile(profile));
    setMode(profile.defaultBrief.mode);
    setAutoRender(profile.defaultBrief.autoRender);
    setAutoModel(profile.llm?.autoModel ?? true);
    setQuotaPolicy(profile.llm?.quotaPolicy ?? "");
    setPaidCap(profile.llm?.paidFallbackDailyUsd === undefined ? "" : String(profile.llm.paidFallbackDailyUsd));
    setVoice(profile.voice?.voice ?? "");
    setRate(profile.voice?.rate ?? "+0%");
    setTtsProvider(profile.voice?.provider ?? "");
    setTtsModel(profile.voice?.model ?? "");
    setTtsStyle(profile.voice?.style ?? "");
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
          voice: voice.trim() || ttsProvider || ttsModel.trim() || ttsStyle.trim()
            ? {
              ...(voice.trim() ? { voice: voice.trim() } : {}),
              ...(rate ? { rate } : {}),
              ...(ttsProvider ? { provider: ttsProvider } : {}),
              ...(ttsModel.trim() ? { model: ttsModel.trim() } : {}),
              ...(ttsStyle.trim() ? { style: ttsStyle.trim() } : {}),
            }
            : null,
          ...(guidelines ? { guidelines } : {}),
          llm: (() => {
            const { quotaPolicy: _policy, paidFallbackDailyUsd: _cap, ...rest } = profile.llm ?? {};
            return {
              ...rest,
              autoModel,
              ...(quotaPolicy === "wait" || quotaPolicy === "paid_fallback" ? { quotaPolicy } : {}),
              ...(paidCap.trim() ? { paidFallbackDailyUsd: Number(paidCap) } : {}),
            };
          })(),
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
      <fieldset className="form-row">
        <legend>Phong cách dựng</legend>
        <label className="form-field">
          <span>Preset</span>
          <select
            aria-label="Phong cách dựng"
            value={brief.edit?.preset ?? "story"}
            onChange={(event) => setBrief((current) => ({
              ...current,
              edit: { ...current.edit, preset: event.target.value as "calm" | "energetic" | "news" | "story" },
            }))}
          >
            <option value="calm">Điềm tĩnh</option>
            <option value="energetic">Nhanh</option>
            <option value="news">Tin tức</option>
            <option value="story">Kể chuyện</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label="Hiệu ứng âm thanh"
            checked={brief.edit?.sfx ?? true}
            onChange={(event) => setBrief((current) => ({ ...current, edit: { ...current.edit, sfx: event.target.checked } }))}
          />
          Hiệu ứng âm thanh
        </label>
        <EditStyleFields
          idPrefix="Hồ sơ"
          edit={brief.edit}
          onChange={(edit) => setBrief((current) => ({ ...current, edit }))}
        />
        <div style={{ gridColumn: "1 / -1", display: "grid", gap: 14 }}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              aria-label="Bật đồ họa động"
              checked={brief.motionGraphics?.enabled ?? false}
              onChange={(event) => setBrief((current) => ({
                ...current,
                motionGraphics: {
                  enabled: event.target.checked,
                  templates: current.motionGraphics?.templates ?? ["title_card", "kinetic_word", "end_card"],
                  brandColor: current.motionGraphics?.brandColor ?? "#0F172A",
                  accentColor: current.motionGraphics?.accentColor ?? "#F5C518",
                  font: current.motionGraphics?.font ?? "be-vietnam-pro",
                  endCard: current.motionGraphics?.endCard ?? true,
                },
              }))}
            />
            Bật đồ họa động
          </label>
          <div className="format-cards" aria-label="Mẫu đồ họa được phép">
            {MOTION_TEMPLATES.map((spec) => {
              const selected = brief.motionGraphics?.templates?.includes(spec.id) ?? false;
              return (
                <label key={spec.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    <input
                      type="checkbox"
                      aria-label={spec.nameVi}
                      checked={selected}
                      onChange={(event) => setBrief((current) => {
                        const currentTemplates = current.motionGraphics?.templates ?? [];
                        const templates = event.target.checked
                          ? [...currentTemplates, spec.id]
                          : currentTemplates.filter((id) => id !== spec.id);
                        return {
                          ...current,
                          motionGraphics: {
                            enabled: current.motionGraphics?.enabled ?? false,
                            templates,
                            brandColor: current.motionGraphics?.brandColor ?? "#0F172A",
                            accentColor: current.motionGraphics?.accentColor ?? "#F5C518",
                            font: current.motionGraphics?.font ?? "be-vietnam-pro",
                            endCard: current.motionGraphics?.endCard ?? true,
                          },
                        };
                      })}
                    />
                    <strong>{spec.nameVi}</strong>
                  </div>
                  <iframe title={spec.nameVi} sandbox="allow-scripts" src={`/api/motion/preview?template=${spec.id}`} />
                </label>
              );
            })}
          </div>
        </div>
        <label className="form-field">
          <span>Màu nền</span>
          <input aria-label="Màu nền đồ họa" type="color" value={brief.motionGraphics?.brandColor ?? "#0F172A"} onChange={(event) => setBrief((current) => ({
            ...current,
            motionGraphics: {
              enabled: current.motionGraphics?.enabled ?? false,
              templates: current.motionGraphics?.templates ?? [],
              brandColor: event.target.value,
              accentColor: current.motionGraphics?.accentColor ?? "#F5C518",
              font: current.motionGraphics?.font ?? "be-vietnam-pro",
              endCard: current.motionGraphics?.endCard ?? true,
            },
          }))} />
        </label>
        <label className="form-field">
          <span>Màu nhấn</span>
          <input aria-label="Màu nhấn đồ họa" type="color" value={brief.motionGraphics?.accentColor ?? "#F5C518"} onChange={(event) => setBrief((current) => ({
            ...current,
            motionGraphics: {
              enabled: current.motionGraphics?.enabled ?? false,
              templates: current.motionGraphics?.templates ?? [],
              brandColor: current.motionGraphics?.brandColor ?? "#0F172A",
              accentColor: event.target.value,
              font: current.motionGraphics?.font ?? "be-vietnam-pro",
              endCard: current.motionGraphics?.endCard ?? true,
            },
          }))} />
        </label>
        <label className="form-field">
          <span>Tên kênh trên thẻ kết</span>
          <input
            aria-label="Tên kênh trên thẻ kết"
            maxLength={32}
            value={brief.motionGraphics?.channelName ?? ""}
            onChange={(event) => setBrief((current) => ({
              ...current,
              motionGraphics: {
                enabled: current.motionGraphics?.enabled ?? false,
                templates: current.motionGraphics?.templates ?? [],
                brandColor: current.motionGraphics?.brandColor ?? "#0F172A",
                accentColor: current.motionGraphics?.accentColor ?? "#F5C518",
                font: current.motionGraphics?.font ?? "be-vietnam-pro",
                endCard: current.motionGraphics?.endCard ?? true,
                channelName: event.target.value,
              },
            }))}
          />
        </label>
        <label className="form-field">
          <span>Phông</span>
          <select aria-label="Phông đồ họa" value={brief.motionGraphics?.font ?? "be-vietnam-pro"} onChange={(event) => setBrief((current) => ({
            ...current,
            motionGraphics: {
              enabled: current.motionGraphics?.enabled ?? false,
              templates: current.motionGraphics?.templates ?? [],
              brandColor: current.motionGraphics?.brandColor ?? "#0F172A",
              accentColor: current.motionGraphics?.accentColor ?? "#F5C518",
              font: event.target.value === "system" ? "system" : "be-vietnam-pro",
              endCard: current.motionGraphics?.endCard ?? true,
            },
          }))}>
            <option value="be-vietnam-pro">Be Vietnam Pro</option>
            <option value="system">Phông hệ thống</option>
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            aria-label="Thẻ kết"
            checked={brief.motionGraphics?.endCard ?? true}
            onChange={(event) => setBrief((current) => ({
              ...current,
              motionGraphics: {
                enabled: current.motionGraphics?.enabled ?? false,
                templates: current.motionGraphics?.templates ?? [],
                brandColor: current.motionGraphics?.brandColor ?? "#0F172A",
                accentColor: current.motionGraphics?.accentColor ?? "#F5C518",
                font: current.motionGraphics?.font ?? "be-vietnam-pro",
                endCard: event.target.checked,
              },
            }))}
          />
          Thẻ kết
        </label>
      </fieldset>
      <div className="form-row">
        <label className="form-field">
          <span>Mode mặc định</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="ASSISTED">ASSISTED</option>
            <option value="AUTO">AUTO</option>
            <option value="MANUAL">MANUAL</option>
          </select>
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", minHeight: 38, marginTop: 18 }}>
          <label className="checkbox-field">
            <input type="checkbox" checked={autoRender} onChange={(event) => setAutoRender(event.target.checked)} />
            Tự render
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              aria-label="Tự chọn model"
              checked={autoModel}
              onChange={(event) => setAutoModel(event.target.checked)}
            />
            Tự chọn model
          </label>
        </div>
        <CopyrightStillsSelect profileId={profile.id} />
        <VisualQualitySelect profileId={profile.id} />
        <label className="form-field">
          <span>Khi hết quota miễn phí</span>
          <select aria-label="Chính sách quota của hồ sơ" value={quotaPolicy} onChange={(event) => setQuotaPolicy(event.target.value as typeof quotaPolicy)}>
            <option value="">Theo cài đặt app</option>
            <option value="wait">Chờ reset</option>
            <option value="paid_fallback">Dùng model trả phí</option>
          </select>
        </label>
        <label className="form-field">
          <span>Trần trả phí của hồ sơ (USD/ngày)</span>
          <input aria-label="Trần trả phí của hồ sơ" type="number" min={0} step="0.01" value={paidCap} placeholder="Theo app" onChange={(event) => setPaidCap(event.target.value)} />
        </label>
      </div>
      <ModelAdvisorPanel scope="profile" id={profile.id} budgetMode={brief.budget.mode} />
      <div className="form-row">
        <label className="form-field">
          <span>Nhà cung cấp TTS</span>
          <select aria-label="Nhà cung cấp TTS" value={ttsProvider} onChange={(event) => setTtsProvider(event.target.value)}>
            <option value="">Mặc định app</option>
            {TTS_CATALOG.filter((entry) => entry.id !== "mock").map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
          {TTS_CATALOG.find((entry) => entry.id === ttsProvider)?.wordTimings && <small>Có mốc thời gian từng từ</small>}
        </label>
        <label className="form-field">
          <span>Giọng đọc</span>
          <input value={voice} onChange={(event) => setVoice(event.target.value)} placeholder="vi-VN-HoaiMyNeural" />
        </label>
        <label className="form-field">
          <span>Tốc độ</span>
          <input value={rate} onChange={(event) => setRate(event.target.value)} placeholder="+0%" />
        </label>
        <label className="form-field">
          <span>Phong cách</span>
          <input aria-label="Phong cách giọng" value={ttsStyle} onChange={(event) => setTtsStyle(event.target.value)} />
        </label>
        <label className="form-field">
          <span>Model</span>
          <input aria-label="Model giọng" value={ttsModel} onChange={(event) => setTtsModel(event.target.value)} />
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
  const [busy, setBusy] = useState<"disconnect" | "check" | "saveCreds" | "deleteCreds" | "metaTarget" | null>(null);
  const [selectedMetaTargetId, setSelectedMetaTargetId] = useState("");
  const [confirmAccount, setConfirmAccount] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmCreds, setConfirmCreds] = useState(false);

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
  const isMeta = account.platform === "facebook_reels" || account.platform === "instagram_reels";
  const expiringSoon = isExpiringSoon(detail?.tokenExpiresAt ?? null);
  const metaTargets = detail?.metaTargets ?? [];
  const needsMetaPicker = isMeta && metaTargets.length > 0
    && (!externalId || externalId.startsWith("pending:"));

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
    setConfirmDisconnect(false);
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
    setConfirmCreds(false);
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

  async function onSelectMetaTarget(event: FormEvent) {
    event.preventDefault();
    if (!selectedMetaTargetId) return;
    setBusy("metaTarget");
    onError("");
    try {
      const result = await selectMetaTarget(profileId, account.id, selectedMetaTargetId);
      queryClient.setQueryData(accountConnectionKeys.detail(profileId, account.id), result);
      await queryClient.invalidateQueries({ queryKey: profileKeys.detail(profileId) });
      setSelectedMetaTargetId("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Chọn Page/Instagram thất bại");
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
          {account.platform === "youtube" && connection === "EXPIRED" ? (
            <p>Ở chế độ Testing, quyền có thể hết hạn sau 7 ngày. Kiểm tra trạng thái Publish app trên Google Cloud.</p>
          ) : null}
          {detail?.marketWarning && <p role="status">{detail.marketWarning}</p>}
          {detail && (
            <div className="page-subtitle" style={{ margin: "0.45rem 0 0", display: "grid", gap: 4 }}>
              {detail.tokenExpiresAt && (
                <span>
                  Token hết hạn: {formatDateTime(detail.tokenExpiresAt)}
                  {expiringSoon && (
                    <span style={{ color: "#b42318", fontWeight: 700, marginLeft: 8 }}>
                      {isMeta ? META_RECONNECT_SOON_VI : "Sắp hết hạn"}
                    </span>
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
          {account.platform === "tiktok" && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hướng dẫn kết nối TikTok</summary>
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
                {TIKTOK_SETUP_HELP_VI}
              </pre>
            </details>
          )}
          {isMeta && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Hướng dẫn kết nối Meta (FB/IG Reels)</summary>
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
                {META_SETUP_HELP_VI}
              </pre>
            </details>
          )}
          {account.platform === "tiktok" && (
            <p className="field-hint" style={{ margin: "0.5rem 0 0" }}>
              {account.publishSettings.tiktokUploadMode === "inbox"
                ? "Chế độ: Gửi vào hộp thư nháp (hoàn tất trong app TikTok)."
                : "Chế độ: Direct Post. App chưa duyệt audit thì chỉ đăng được riêng tư (SELF_ONLY)."}
            </p>
          )}
          {account.platform === "youtube" && account.publishSettings.playlistId && (
            <p className="field-hint" style={{ margin: "0.5rem 0 0" }}>{YOUTUBE_PLAYLIST_SCOPE_NOTE_VI}</p>
          )}
          {needsMetaPicker && (
            <form
              className="form-panel"
              style={{ marginTop: 12, padding: 12 }}
              onSubmit={(event) => void onSelectMetaTarget(event)}
            >
              <p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
                {account.platform === "facebook_reels"
                  ? "Chọn Facebook Page để đăng Reels"
                  : "Chọn tài khoản Instagram chuyên nghiệp"}
              </p>
              <label className="form-field">
                <span>{account.platform === "facebook_reels" ? "Page" : "Instagram"}</span>
                <select
                  value={selectedMetaTargetId}
                  required
                  onChange={(event) => setSelectedMetaTargetId(event.target.value)}
                >
                  <option value="">— Chọn —</option>
                  {metaTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}{target.handle ? ` (${target.handle})` : ""} · {target.id}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy === "metaTarget" || !selectedMetaTargetId}
                style={{ marginTop: 8 }}
              >
                {busy === "metaTarget" ? "Đang lưu…" : "Lưu lựa chọn"}
              </button>
            </form>
          )}
        </div>
        <div className="account-row-actions">
          {connected ? (
            <>
              {account.platform === "youtube" && (
                <label className="field-hint" style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: 280 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(detail?.commentsEnabled)}
                    onChange={(event) => {
                      const current = detail;
                      if (!current) return;
                      void setYoutubeCommentSync(account.id, event.target.checked).then((result) => {
                        queryClient.setQueryData(accountConnectionKeys.detail(profileId, account.id), {
                          ...current,
                          commentsEnabled: result.commentsEnabled,
                          commentsStatus: result.commentsStatus,
                        });
                      }).catch((err: unknown) => {
                        onError(err instanceof Error ? err.message : "Không bật được quản lý bình luận");
                      });
                    }}
                  />
                  Quản lý bình luận YouTube
                </label>
              )}
              {detail?.commentsStatus === "needs_reconnect" && (
                <p className="field-hint" style={{ margin: 0, maxWidth: 220 }}>
                  Kết nối lại để quản lý bình luận
                </p>
              )}
              {detail?.commentsStatus === "unsupported" && (
                <p className="field-hint" style={{ margin: 0, maxWidth: 240 }}>
                  TikTok chưa hỗ trợ đọc bình luận qua API
                </p>
              )}
              {detail?.analyticsStatus === "needs_reconnect" && (
                <div style={{ display: "grid", gap: 4 }}>
                  <p className="field-hint" style={{ margin: 0, maxWidth: 220 }}>
                    Kết nối lại để bật thống kê
                  </p>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!canConnect || connectionQuery.isPending}
                    title={connectBlockedReason ?? undefined}
                    onClick={() => openConnect()}
                  >
                    Kết nối lại
                  </button>
                </div>
              )}
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
                onClick={() => setConfirmDisconnect(true)}
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
            onClick={() => setConfirmAccount(true)}
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
                  onClick={() => setConfirmCreds(true)}
                >
                  Xóa thông tin ứng dụng
                </button>
              )}
            </div>
            {credMessage && <p className="field-hint">{credMessage}</p>}
          </form>
        </section>
      )}
      <ConfirmDialog
        open={confirmAccount}
        title="Xóa tài khoản?"
        message={`Tài khoản ${displayName} sẽ rời khỏi hồ sơ. Video đã đăng không bị xóa trên nền tảng.`}
        confirmLabel="Xóa tài khoản"
        cancelLabel="Giữ lại"
        busy={remove.isPending}
        onCancel={() => setConfirmAccount(false)}
        onConfirm={() => {
          void remove.mutateAsync({ profileId, accountId: account.id }).then(() => {
            setConfirmAccount(false);
            onDeleted();
          }).catch((err) => {
            onError(err instanceof Error ? err.message : "Xóa thất bại");
          });
        }}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        title="Ngắt kết nối?"
        message="Token đã lưu của tài khoản này sẽ bị xóa. Bạn có thể kết nối lại sau."
        confirmLabel="Ngắt kết nối"
        cancelLabel="Giữ kết nối"
        busy={busy === "disconnect"}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => { void onDisconnect(); }}
      />
      <ConfirmDialog
        open={confirmCreds}
        title="Xóa thông tin ứng dụng?"
        message="Mã ứng dụng đã lưu cho tài khoản này sẽ bị xóa. Kết nối sau đó dùng giá trị trong .env nếu có."
        confirmLabel="Xóa thông tin"
        cancelLabel="Giữ lại"
        busy={busy === "deleteCreds"}
        onCancel={() => setConfirmCreds(false)}
        onConfirm={() => { void onDeleteCredentials(); }}
      />
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
  const [tiktokUploadMode, setTiktokUploadMode] = useState<TikTokUploadModeValue>("direct_post");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlatformAccount | null>(null);

  const formPlatform = editing?.platform ?? platform;
  const showYoutubePublishExtras = formPlatform === "youtube";
  const showTiktokPublishExtras = formPlatform === "tiktok";

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
      const tiktokExtras = showTiktokPublishExtras
        ? { tiktokUploadMode }
        : {};
      if (editing) {
        await update.mutateAsync({
          profileId: profile.id,
          accountId: editing.id,
          input: {
            displayName,
            handle: handle.trim() || null,
            ...(format ? { format } : {}),
            publishSettings: { visibility, autoPublish, ...youtubeExtras, ...tiktokExtras },
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
            publishSettings: { visibility, autoPublish, ...youtubeExtras, ...tiktokExtras },
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
      setTiktokUploadMode("direct_post");
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
    setTiktokUploadMode(account.publishSettings.tiktokUploadMode === "inbox" ? "inbox" : "direct_post");
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
          {displayName.includes("@") ? <small>Tên gợi nhớ, không phải email đăng nhập</small> : null}
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
        {showTiktokPublishExtras && (
          <label className="form-field">
            <span>Cách đăng TikTok</span>
            <select
              value={tiktokUploadMode}
              onChange={(event) => setTiktokUploadMode(event.target.value as TikTokUploadModeValue)}
            >
              <option value="direct_post">Direct Post (đăng thẳng)</option>
              <option value="inbox">Gửi vào hộp thư nháp</option>
            </select>
            <small className="field-hint">
              {tiktokUploadMode === "inbox"
                ? "Tải lên inbox; bạn mở app TikTok để chỉnh và đăng."
                : "App chưa được TikTok duyệt thì Direct Post chỉ đăng được riêng tư (SELF_ONLY)."}
            </small>
          </label>
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

function VisualQualitySelect({ profileId }: { profileId: string }) {
  const [quality, setQuality] = useState<"budget" | "best">("budget");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void fetch(`/api/profiles/${profileId}/visual-quality`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { quality?: string };
      if (body.quality === "best") setQuality("best");
    }).catch(() => undefined);
  }, [profileId]);
  return (
    <label className="form-field">
      <span>Chất lượng ảnh</span>
      <select aria-label="Chất lượng ảnh" value={quality} onChange={(event) => {
        const next = event.target.value === "best" ? "best" : "budget";
        setQuality(next);
        void fetch(`/api/profiles/${profileId}/visual-quality`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quality: next }),
        });
      }}>
        <option value="budget">Tiết kiệm — theo ngân sách</option>
        <option value="best">Tốt nhất — tìm rộng hơn, tốn thêm lượt tìm và vision</option>
      </select>
      <button
        type="button"
        className="button button-secondary"
        style={{ marginTop: 6, width: "fit-content", minHeight: 28, padding: "0 10px", fontSize: 11 }}
        onClick={() => {
        void fetch("/api/profiles/visual-quality", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quality: "best" }),
        }).then(() => {
          setQuality("best");
          setNotice("Đã bật Tốt nhất cho mọi hồ sơ.");
        }).catch(() => setNotice("Chưa đổi được các hồ sơ."));
      }}>Dùng chế độ Tốt nhất cho mọi hồ sơ</button>
      {notice ? <small>{notice}</small> : <small>Hồ sơ mới mặc định Tốt nhất. Hồ sơ cũ giữ Tiết kiệm cho đến khi bạn đổi.</small>}
    </label>
  );
}

function CopyrightStillsSelect({ profileId }: { profileId: string }) {
  const [mode, setMode] = useState<"off" | "commentary">("off");
  useEffect(() => {
    void fetch(`/api/profiles/${profileId}/visual-copyright`).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { allowCopyrightedStills?: string };
      if (body.allowCopyrightedStills === "commentary") setMode("commentary");
    }).catch(() => undefined);
  }, [profileId]);
  return (
    <label className="form-field">
      <span>Ảnh có bản quyền</span>
      <select aria-label="Ảnh có bản quyền" value={mode} onChange={(event) => {
        const allowCopyrightedStills = event.target.value === "commentary" ? "commentary" : "off";
        setMode(allowCopyrightedStills);
        void fetch(`/api/profiles/${profileId}/visual-copyright`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowCopyrightedStills }),
        });
      }}>
        <option value="off">Tắt — ưu tiên ảnh có giấy phép</option>
        <option value="commentary">Bình luận — tối đa 4 giây, có rủi ro Content ID</option>
      </select>
      <small>Bật bình luận thì video có thể bị Content ID, mất tiền quảng cáo hoặc bị gỡ. Chỉ bạn đổi được mục này.</small>
    </label>
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
      <nav className="tab-bar" aria-label="Tab hồ sơ">
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
        <>
          <MarketSettings key={`market:${profile.data.id}`} profile={profile.data} />
          <DirectionTab key={`direction:${profile.data.id}`} profile={profile.data} />
        </>
      ) : activeTab === "brief" ? (
        <BriefTab profile={profile.data} />
      ) : activeTab === "style" ? (
        <StyleTab key={profile.data.id} profileId={profile.data.id} />
      ) : activeTab === "topics" ? (
        <TopicsTab profile={profile.data} />
      ) : activeTab === "automation" ? (
        <AutomationTab profile={profile.data} />
      ) : activeTab === "autonomy" ? (
        <AutonomySettingsPanel key={profile.data.id} profileId={profile.data.id} />
      ) : activeTab === "insights" ? (
        <InsightsTab profile={profile.data} />
      ) : activeTab === "knowledge" ? (
        <ProfileKnowledgeTab key={profile.data.id} profileId={profile.data.id} />
      ) : activeTab === "memory" ? (
        <ProfileMemoryTab key={profile.data.id} profileId={profile.data.id} />
      ) : activeTab === "accounts" ? (
        <AccountsTab profile={profile.data} />
      ) : activeTab === "comments" ? (
        <CommentSettingsForm profileId={profile.data.id} />
      ) : (
        <ProjectsTab profile={profile.data} />
      )}
    </div>
  );
}
import { MarketSettings } from "./MarketSettings";
