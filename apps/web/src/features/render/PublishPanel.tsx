import type { PlatformAccount, Project, Publication, PublishVisibility } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ApiRequestError } from "../../services/apiClient";
import { getProfile } from "../../services/profilesApi";
import {
  createPublications,
  listProjectPublications,
} from "../../services/publishApi";
import { Spinner } from "../../components/Spinner";
import { ThumbnailCard } from "./ThumbnailCard";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Đang chờ",
  SCHEDULED: "Đã lên lịch",
  UPLOADING: "Đang tải lên",
  PUBLISHED: "Đã đăng",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
};

const VISIBILITY_LABEL: Record<PublishVisibility, string> = {
  public: "Công khai",
  unlisted: "Không liệt kê",
  private: "Riêng tư",
};

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PublishPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const profileId = project.profileId;
  const profile = useQuery({
    queryKey: ["profile", profileId],
    queryFn: () => getProfile(profileId!),
    enabled: Boolean(profileId),
  });
  const publications = useQuery({
    queryKey: ["publications", project.id],
    queryFn: () => listProjectPublications(project.id),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((item) => item.status === "QUEUED" || item.status === "UPLOADING" || item.status === "SCHEDULED")
        ? 2_000
        : false;
    },
  });

  const accounts = useMemo(
    () => (profile.data?.accounts ?? []).filter((account) => account.enabled),
    [profile.data?.accounts],
  );

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [scheduledLocal, setScheduledLocal] = useState(() => toLocalInputValue(new Date()));
  const [visibility, setVisibility] = useState<PublishVisibility | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accounts.length) return;
    setSelected((prev) => {
      const next = { ...prev };
      for (const account of accounts) {
        if (next[account.id] === undefined) next[account.id] = account.connection === "CONNECTED";
      }
      return next;
    });
  }, [accounts]);

  const publish = useMutation({
    mutationFn: async () => {
      const accountIds = accounts.filter((account) => selected[account.id]).map((account) => account.id);
      if (accountIds.length === 0) throw new Error("Chọn ít nhất một tài khoản");
      const scheduledFor = new Date(scheduledLocal).toISOString();
      return createPublications(project.id, {
        accountIds,
        scheduledFor,
        ...(visibility ? { visibility } : {}),
      });
    },
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["publications", project.id] });
    },
    onError: (err) => {
      setError(err instanceof ApiRequestError || err instanceof Error ? err.message : "Đăng thất bại");
    },
  });

  if (!profileId) {
    return (
      <section className="panel" aria-label="Đăng">
        <h3>Đăng</h3>
        <ThumbnailCard project={project} />
        <p className="page-subtitle">Gán dự án vào một hồ sơ có tài khoản để đăng video.</p>
      </section>
    );
  }

  return (
    <section className="panel publish-panel" aria-label="Đăng">
      <h3>Đăng</h3>
      <ThumbnailCard project={project} />
      {profile.isLoading || publications.isLoading ? <Spinner label="Đang tải…" /> : null}
      {profile.isError && <p className="request-error" role="alert">Không tải được tài khoản hồ sơ.</p>}
      {error && <p className="request-error" role="alert">{error}</p>}

      {accounts.length === 0 ? (
        <p className="page-subtitle">Hồ sơ chưa có tài khoản. Thêm và kết nối ở tab Tài khoản.</p>
      ) : (
        <>
          <ul className="account-list">
            {accounts.map((account) => (
              <li key={account.id} className="account-row">
                <label className="form-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(selected[account.id])}
                    disabled={account.connection !== "CONNECTED"}
                    onChange={(event) => setSelected((prev) => ({ ...prev, [account.id]: event.target.checked }))}
                  />
                  <span>
                    <strong>{account.displayName}</strong>
                    {" · "}
                    {account.platform}
                    {" · "}
                    {account.connection === "CONNECTED" ? "Đã kết nối" : "Chưa kết nối"}
                    {" · mặc định "}
                    {VISIBILITY_LABEL[account.publishSettings.visibility]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="form-row" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.75rem" }}>
            <label className="form-field">
              <span>Thời gian đăng</span>
              <input
                type="datetime-local"
                value={scheduledLocal}
                onChange={(event) => setScheduledLocal(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Hiển thị</span>
              <select
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as PublishVisibility | "")}
              >
                <option value="">Theo tài khoản</option>
                <option value="public">Công khai</option>
                <option value="unlisted">Không liệt kê</option>
                <option value="private">Riêng tư</option>
              </select>
            </label>
            <button
              className="button"
              type="button"
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? "Đang gửi…" : "Đăng"}
            </button>
          </div>
        </>
      )}

      <PublicationStatusList items={publications.data?.items ?? []} accounts={accounts} />
    </section>
  );
}

function PublicationStatusList({
  items,
  accounts,
}: {
  items: Publication[];
  accounts: PlatformAccount[];
}) {
  if (items.length === 0) return null;
  const nameOf = (accountId: string) => accounts.find((item) => item.id === accountId)?.displayName ?? accountId.slice(0, 8);
  return (
    <div className="publish-status-list" style={{ marginTop: "1rem" }}>
      <h4 style={{ marginBottom: "0.5rem" }}>Trạng thái đăng</h4>
      <ul className="account-list">
        {items.map((item) => (
          <li key={item.id} className="account-row">
            <div>
              <strong>{nameOf(item.accountId)}</strong>
              {" · "}
              {STATUS_LABEL[item.status] ?? item.status}
              {item.progress > 0 && item.status === "UPLOADING" ? ` (${item.progress}%)` : ""}
              {item.externalUrl && (
                <>
                  {" · "}
                  <a href={item.externalUrl} target="_blank" rel="noreferrer">Xem video</a>
                </>
              )}
              {item.latestMetrics && (item.latestMetrics.views != null || item.latestMetrics.likes != null) && (
                <p className="field-hint" style={{ margin: "0.35rem 0 0" }}>
                  {item.latestMetrics.views != null && (
                    <>Lượt xem: {new Intl.NumberFormat("vi-VN").format(item.latestMetrics.views)}</>
                  )}
                  {item.latestMetrics.views != null && item.latestMetrics.likes != null && " · "}
                  {item.latestMetrics.likes != null && (
                    <>Thích: {new Intl.NumberFormat("vi-VN").format(item.latestMetrics.likes)}</>
                  )}
                </p>
              )}
              {item.guardrailReason && (
                <p className="request-error" role="status" style={{ margin: "0.35rem 0 0" }}>
                  {item.guardrailReason}
                </p>
              )}
              {(item.warnings ?? []).length > 0 && (
                <ul className="field-hint" aria-label="Cảnh báo đăng" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {item.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              {item.lastError && (item.status === "FAILED" || item.status === "SCHEDULED") && (
                <p className="request-error" role="status" style={{ margin: "0.35rem 0 0" }}>
                  {item.lastError}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
