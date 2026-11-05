import type {
  AnalyticsAccountStatus,
  AnalyticsDayPoint,
  AnalyticsKpiWithDelta,
  AnalyticsOverviewResponse,
  AnalyticsVideoRankItem,
  PlatformId,
} from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { LoadMore } from "../../components/ui/LoadMore";
import { ApiRequestError } from "../../services/apiClient";
import {
  analyticsKeys,
  getAnalyticsOverview,
  getPublicationMetrics,
  listAnalyticsAccounts,
  syncAnalyticsAccount,
} from "../../services/analyticsApi";
import { getProfiles } from "../../services/profilesApi";
import { oauthStartUrl } from "../../services/publishApi";
import { BarChart, LineChart, type LineSeries } from "./charts";

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  facebook_reels: "Facebook Reels",
  instagram_reels: "Instagram Reels",
  mock: "Mock",
};

const PLATFORM_COLOR: Record<string, string> = {
  youtube: "#c4302b",
  tiktok: "#111111",
  facebook_reels: "#1877f2",
  instagram_reels: "#e1306c",
  mock: "#6b7280",
};

const RANGE_PRESETS = [
  { days: 7, label: "7 ngày" },
  { days: 28, label: "28 ngày" },
  { days: 90, label: "90 ngày" },
] as const;

type SortKey = "title" | "platform" | "publishedAt" | "views" | "avgViewPct" | "likes" | "comments" | "score";
type SortDir = "asc" | "desc";

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangeFromDays(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: toDateInput(from), to: toDateInput(to) };
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("vi-VN").format(value);
}

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDelta(value: number): string {
  const abs = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return "0";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function seriesFromDays(points: AnalyticsDayPoint[]): LineSeries[] {
  const byPlatform = new Map<string, Array<{ x: string; y: number }>>();
  for (const point of points) {
    const list = byPlatform.get(point.platform) ?? [];
    list.push({ x: point.date, y: point.views });
    byPlatform.set(point.platform, list);
  }
  return [...byPlatform.entries()].map(([platform, pts]) => ({
    id: platform,
    label: PLATFORM_LABEL[platform] ?? platform,
    color: PLATFORM_COLOR[platform] ?? "#4b61b6",
    points: pts.sort((a, b) => a.x.localeCompare(b.x)),
  }));
}

function compareVideos(a: AnalyticsVideoRankItem, b: AnalyticsVideoRankItem, key: SortKey, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
  return String(av).localeCompare(String(bv), "vi") * mul;
}

function KpiTiles({ totals }: { totals: AnalyticsKpiWithDelta }) {
  const tiles: Array<{ key: keyof Omit<AnalyticsKpiWithDelta, "previous" | "delta">; label: string; format?: "hours" }> = [
    { key: "views", label: "Lượt xem" },
    { key: "watchHours", label: "Giờ xem", format: "hours" },
    { key: "likes", label: "Thích" },
    { key: "comments", label: "Bình luận" },
    { key: "shares", label: "Chia sẻ" },
    { key: "followersDelta", label: "Theo dõi (±)" },
  ];
  return (
    <section className="usage-stat-grid" aria-label="Chỉ số tổng">
      {tiles.map(({ key, label, format }) => {
        const value = totals[key];
        const delta = totals.delta[key];
        const display = format === "hours"
          ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)
          : formatNumber(value);
        return (
          <article className="panel usage-stat" key={key}>
            <span>{label}</span>
            <strong>{display}</strong>
            <small className={delta > 0 ? "analytics-delta-up" : delta < 0 ? "analytics-delta-down" : undefined}>
              {formatDelta(delta)} so với kỳ trước
            </small>
          </article>
        );
      })}
    </section>
  );
}

function AccountSyncStrip({
  accounts,
  onSynced,
}: {
  accounts: AnalyticsAccountStatus[];
  onSynced: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const sync = useMutation({
    mutationFn: (accountId: string) => syncAnalyticsAccount(accountId),
    onSuccess: (result) => {
      setMessage(
        result.synced
          ? `Đã đồng bộ ${result.publicationsSynced} video.`
          : (result.reason ?? "Bỏ qua đồng bộ."),
      );
      onSynced();
    },
    onError: (err) => {
      setMessage(err instanceof ApiRequestError || err instanceof Error ? err.message : "Đồng bộ thất bại");
    },
    onSettled: () => setBusyId(null),
  });

  if (accounts.length === 0) {
    return (
      <section className="panel analytics-sync-strip" aria-label="Trạng thái đồng bộ">
        <p className="page-subtitle" style={{ margin: 0 }}>Chưa có tài khoản nền tảng.</p>
      </section>
    );
  }

  return (
    <section className="panel analytics-sync-strip" aria-label="Trạng thái đồng bộ">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TÀI KHOẢN</p>
          <h2>Đồng bộ thống kê</h2>
        </div>
      </div>
      <ul className="account-list">
        {accounts.map((account) => {
          const needsReconnect = account.analyticsStatus === "needs_reconnect";
          return (
            <li key={account.accountId} className="account-row analytics-sync-row">
              <div>
                <strong>{account.displayName}</strong>
                {" · "}
                {PLATFORM_LABEL[account.platform] ?? account.platform}
                {account.lastSyncAt && (
                  <span className="profile-card-meta"> Lần đồng bộ: {formatDateTime(account.lastSyncAt)}</span>
                )}
                {needsReconnect && (
                  <>
                    <p className="field-hint" style={{ margin: "0.35rem 0 0" }}>
                      Kết nối lại để bật thống kê
                    </p>
                    {account.missingScopes.length > 0 && (
                      <p className="field-hint" style={{ margin: "0.15rem 0 0" }}>
                        Thiếu quyền: {account.missingScopes.join(", ")}
                      </p>
                    )}
                  </>
                )}
                {account.lastError && !needsReconnect && (
                  <p className="request-error" role="status" style={{ margin: "0.35rem 0 0" }}>
                    {account.lastError}
                  </p>
                )}
              </div>
              <div className="account-row-actions">
                {needsReconnect ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => {
                      window.open(
                        oauthStartUrl(account.platform, account.accountId),
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                  >
                    Kết nối lại
                  </button>
                ) : (
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={busyId === account.accountId || sync.isPending}
                    onClick={() => {
                      setBusyId(account.accountId);
                      setMessage("");
                      sync.mutate(account.accountId);
                    }}
                  >
                    {busyId === account.accountId ? "Đang đồng bộ…" : "Đồng bộ ngay"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {message && <p className="field-hint" style={{ marginTop: 8 }}>{message}</p>}
    </section>
  );
}

function VideoDetailDrawer({
  video,
  onClose,
}: {
  video: AnalyticsVideoRankItem;
  onClose: () => void;
}) {
  const series = useQuery({
    queryKey: analyticsKeys.publication(video.publicationId),
    queryFn: () => getPublicationMetrics(video.publicationId),
  });

  const lineSeries: LineSeries[] = useMemo(() => {
    const snapshots = series.data?.snapshots ?? [];
    return [{
      id: "views",
      label: "Lượt xem",
      color: "#4b61b6",
      points: snapshots.map((snap) => ({
        x: snap.fetchedAt.slice(0, 10),
        y: snap.views ?? 0,
      })),
    }];
  }, [series.data?.snapshots]);

  return (
    <div className="visual-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="panel visual-drawer"
        role="dialog"
        aria-label={`Chi tiết ${video.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">VIDEO</p>
            <h2>{video.title}</h2>
            <p className="page-subtitle">
              {PLATFORM_LABEL[video.platform] ?? video.platform}
              {" · "}
              {formatDateTime(video.publishedAt)}
            </p>
          </div>
          <button className="button button-secondary" type="button" onClick={onClose}>Đóng</button>
        </header>
        <div className="usage-stat-grid">
          <article className="panel usage-stat"><span>Lượt xem</span><strong>{formatNumber(video.views)}</strong></article>
          <article className="panel usage-stat"><span>% xem TB</span><strong>{formatPct(video.avgViewPct)}</strong></article>
          <article className="panel usage-stat"><span>Thích</span><strong>{formatNumber(video.likes)}</strong></article>
          <article className="panel usage-stat"><span>Bình luận</span><strong>{formatNumber(video.comments)}</strong></article>
        </div>
        {video.externalUrl && (
          <p><a href={video.externalUrl} target="_blank" rel="noreferrer">Mở trên nền tảng</a></p>
        )}
        {video.projectId && (
          <p><Link to={`/projects/${video.projectId}/render`}>Mở dự án</Link></p>
        )}
        <section>
          <h3>Lịch sử chỉ số</h3>
          {series.isPending && <Spinner label="Đang tải lịch sử…" />}
          {series.isError && (
            <p className="request-error" role="alert">
              {series.error instanceof Error ? series.error.message : "Không tải được lịch sử"}
            </p>
          )}
          {series.isSuccess && (series.data.snapshots.length === 0
            ? <p className="usage-empty">Chưa có snapshot chỉ số.</p>
            : <LineChart series={lineSeries} ariaLabel="Lượt xem theo thời gian" />)}
        </section>
      </aside>
    </div>
  );
}

function VideosTable({
  videos,
  onSelect,
}: {
  videos: AnalyticsVideoRankItem[];
  onSelect: (video: AnalyticsVideoRankItem) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [shown, setShown] = useState(20);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(
    () => [...videos].sort((a, b) => compareVideos(a, b, sortKey, sortDir)),
    [videos, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "title" || key === "platform" ? "asc" : "desc");
  }

  function header(label: string, key: SortKey) {
    const active = sortKey === key;
    return (
      <th scope="col">
        <button
          type="button"
          className="analytics-sort-btn"
          aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          onClick={() => toggleSort(key)}
        >
          {label}
          {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  }

  if (videos.length === 0) {
    return <p className="usage-empty">Chưa có video trong khoảng thời gian này.</p>;
  }

  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            {header("Tiêu đề", "title")}
            {header("Nền tảng", "platform")}
            {header("Đăng lúc", "publishedAt")}
            {header("Lượt xem", "views")}
            {header("% xem TB", "avgViewPct")}
            {header("Thích", "likes")}
            {header("Bình luận", "comments")}
            {header("Điểm", "score")}
            <th scope="col">Liên kết</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map((video) => (
            <tr key={video.publicationId}>
              <th scope="row">
                <button type="button" className="analytics-link-btn" onClick={() => onSelect(video)}>
                  {video.title}
                </button>
              </th>
              <td>{PLATFORM_LABEL[video.platform] ?? video.platform}</td>
              <td>{formatDateTime(video.publishedAt)}</td>
              <td>{formatNumber(video.views)}</td>
              <td>{formatPct(video.avgViewPct)}</td>
              <td>{formatNumber(video.likes)}</td>
              <td>{formatNumber(video.comments)}</td>
              <td>{video.score == null ? "—" : String(Math.round(video.score))}</td>
              <td>
                {video.externalUrl
                  ? <a href={video.externalUrl} target="_blank" rel="noreferrer">Xem</a>
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore shown={Math.min(shown, sorted.length)} total={sorted.length} onMore={() => setShown((count) => count + 20)} />
    </div>
  );
}

export function AnalyticsPage() {
  const initial = rangeFromDays(28);
  const [rangePreset, setRangePreset] = useState<7 | 28 | 90 | "custom">(28);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [profileId, setProfileId] = useState("");
  const [platform, setPlatform] = useState<"" | PlatformId>("");
  const [selectedVideo, setSelectedVideo] = useState<AnalyticsVideoRankItem | null>(null);
  const queryClient = useQueryClient();

  const overviewQuery = useMemo(() => ({
    from,
    to,
    ...(profileId ? { profileId } : {}),
    ...(platform ? { platform } : {}),
  }), [from, to, profileId, platform]);

  const profiles = useQuery({
    queryKey: ["profiles", "analytics-filter"],
    queryFn: () => getProfiles({ includeArchived: false }),
  });

  const overview = useQuery({
    queryKey: analyticsKeys.overview(overviewQuery),
    queryFn: () => getAnalyticsOverview(overviewQuery),
  });

  const accounts = useQuery({
    queryKey: analyticsKeys.accounts,
    queryFn: () => listAnalyticsAccounts(),
  });

  function applyPreset(days: 7 | 28 | 90) {
    const range = rangeFromDays(days);
    setRangePreset(days);
    setFrom(range.from);
    setTo(range.to);
  }

  const data: AnalyticsOverviewResponse | undefined = overview.data;
  const lineSeries = useMemo(() => seriesFromDays(data?.series ?? []), [data?.series]);
  const barData = useMemo(
    () => (data?.byPlatform ?? []).map((row) => ({
      id: row.platform,
      label: PLATFORM_LABEL[row.platform] ?? row.platform,
      value: row.views,
      color: PLATFORM_COLOR[row.platform] ?? "#4b61b6",
    })),
    [data?.byPlatform],
  );

  return (
    <div className="page-stack usage-page analytics-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">THỐNG KÊ</p>
          <h1>Thống kê</h1>
          <p className="page-subtitle">Lượt xem, tương tác và trạng thái đồng bộ theo nền tảng.</p>
        </div>
      </div>

      <section className="panel usage-filters" aria-label="Bộ lọc thống kê">
        <div className="analytics-range-presets" role="group" aria-label="Khoảng thời gian">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.days}
              type="button"
              className={`button button-secondary${rangePreset === preset.days ? " is-active" : ""}`}
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className={`button button-secondary${rangePreset === "custom" ? " is-active" : ""}`}
            onClick={() => setRangePreset("custom")}
          >
            Tùy chọn
          </button>
        </div>
        <label>
          Từ ngày
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setRangePreset("custom");
              setFrom(event.target.value);
            }}
          />
        </label>
        <label>
          Đến ngày
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setRangePreset("custom");
              setTo(event.target.value);
            }}
          />
        </label>
        <label>
          Hồ sơ
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">Tất cả hồ sơ</option>
            {(profiles.data?.items ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
        <label>
          Nền tảng
          <select
            value={platform}
            onChange={(event) => setPlatform(event.target.value as "" | PlatformId)}
          >
            <option value="">Tất cả</option>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="facebook_reels">Facebook Reels</option>
            <option value="instagram_reels">Instagram Reels</option>
          </select>
        </label>
      </section>

      {accounts.isSuccess && (
        <AccountSyncStrip
          accounts={accounts.data.items}
          onSynced={() => {
            void queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
          }}
        />
      )}

      {overview.isPending && <Spinner label="Đang tải thống kê" />}
      {overview.isError && (
        <ErrorState
          message={overview.error instanceof Error ? overview.error.message : "Không thể tải thống kê"}
          onRetry={() => void overview.refetch()}
        />
      )}

      {data && (
        <>
          <KpiTiles totals={data.totals} />

          <section className="panel usage-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">BIỂU ĐỒ</p>
                <h2>Lượt xem theo ngày</h2>
              </div>
            </div>
            {lineSeries.length === 0
              ? <p className="usage-empty">Chưa có dữ liệu chuỗi thời gian.</p>
              : (
                <>
                  <div className="analytics-legend">
                    {lineSeries.map((s) => (
                      <span key={s.id}>
                        <i style={{ background: s.color }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                  <LineChart series={lineSeries} ariaLabel="Lượt xem theo ngày từng nền tảng" />
                </>
              )}
          </section>

          <section className="panel usage-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">BIỂU ĐỒ</p>
                <h2>Tỷ lệ theo nền tảng</h2>
              </div>
            </div>
            {barData.length === 0
              ? <p className="usage-empty">Chưa có dữ liệu theo nền tảng.</p>
              : <BarChart data={barData} ariaLabel="Lượt xem theo nền tảng" />}
          </section>

          <section className="panel usage-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">VIDEO</p>
                <h2>Danh sách video</h2>
              </div>
            </div>
            <VideosTable videos={data.videos} onSelect={setSelectedVideo} />
          </section>
        </>
      )}

      {selectedVideo && (
        <VideoDetailDrawer video={selectedVideo} onClose={() => setSelectedVideo(null)} />
      )}
    </div>
  );
}
