import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ProfileDefaultBriefSchema,
  recommendBrief,
  type BriefSettings,
  type PlatformAccount,
  type PlatformId,
  type ProfileDetail,
} from "@vg/shared";
import { ApiRequestError } from "../../services/apiClient";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  useAddPlatformAccount,
  useDeletePlatformAccount,
  useProfile,
  useSetProfileArchived,
  useUpdatePlatformAccount,
  useUpdateProfile,
} from "../../hooks/useProfiles";
import { useProjects } from "../../hooks/useProjects";
import { BriefFields } from "../projects/BriefFields";
import {
  DEFAULT_GUIDELINE_DRAFT,
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
      </div>
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

function AccountsTab({ profile }: { profile: ProfileDetail }) {
  const add = useAddPlatformAccount();
  const update = useUpdatePlatformAccount();
  const remove = useDeletePlatformAccount();
  const [platform, setPlatform] = useState<PlatformId>("youtube");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [format, setFormat] = useState<"landscape" | "vertical" | "">("");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "private">("public");
  const [autoPublish, setAutoPublish] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PlatformAccount | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (editing) {
        await update.mutateAsync({
          profileId: profile.id,
          accountId: editing.id,
          input: {
            displayName,
            handle: handle.trim() || null,
            ...(format ? { format } : {}),
            publishSettings: { visibility, autoPublish },
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
            publishSettings: { visibility, autoPublish },
          },
        });
      }
      setDisplayName("");
      setHandle("");
      setFormat("");
      setVisibility("public");
      setAutoPublish(false);
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
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Tài khoản nền tảng</h2>
        {profile.accounts.length === 0 ? (
          <p className="page-subtitle">Chưa có tài khoản. Thêm YouTube, TikTok… (kết nối OAuth ở task sau).</p>
        ) : (
          <ul className="account-list">
            {profile.accounts.map((account) => (
              <li key={account.id} className="account-row">
                <div>
                  <strong>{account.displayName}</strong>
                  <div className="profile-card-meta">
                    <span>{PLATFORM_OPTIONS.find((item) => item.value === account.platform)?.label ?? account.platform}</span>
                    <span>{account.format === "vertical" ? "9:16" : "16:9"}</span>
                    {account.handle && <span>{account.handle}</span>}
                    <span className="connection-badge">{CONNECTION_LABEL[account.connection] ?? account.connection}</span>
                  </div>
                </div>
                <div className="account-row-actions">
                  <button className="button button-secondary" type="button" disabled title="Sẽ có ở TASK-024">Kết nối</button>
                  <button className="button button-secondary" type="button" onClick={() => startEdit(account)}>Sửa</button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => void remove.mutateAsync({ profileId: profile.id, accountId: account.id }).catch((err) => {
                      setError(err instanceof Error ? err.message : "Xóa thất bại");
                    })}
                  >
                    Xóa
                  </button>
                </div>
              </li>
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
