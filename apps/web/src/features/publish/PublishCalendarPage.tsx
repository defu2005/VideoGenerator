import type { PublicationListItem } from "@vg/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { listPublications } from "../../services/publishApi";

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Đang chờ",
  SCHEDULED: "Đã lên lịch",
  UPLOADING: "Đang tải lên",
  PUBLISHED: "Đã đăng",
  FAILED: "Thất bại",
  CANCELLED: "Đã hủy",
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function groupByDay(items: PublicationListItem[]): Array<{ day: string; items: PublicationListItem[] }> {
  const map = new Map<string, PublicationListItem[]>();
  for (const item of items) {
    const key = dayKey(item.scheduledFor ?? item.publishedAt ?? item.createdAt);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, group]) => ({ day, items: group }));
}

export function PublishCalendarPage() {
  const query = useQuery({
    queryKey: ["publications", "calendar"],
    queryFn: () => listPublications(),
  });

  if (query.isLoading) return <Spinner label="Đang tải lịch đăng…" />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : "Không tải được lịch đăng"}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const groups = groupByDay(query.data?.items ?? []);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <h1>Lịch đăng</h1>
          <p className="page-subtitle">Các bài đăng sắp tới và đã đăng trên mọi hồ sơ.</p>
        </div>
      </header>
      {groups.length === 0 ? (
        <section className="panel">
          <p className="page-subtitle">Chưa có bài đăng nào.</p>
        </section>
      ) : (
        groups.map(({ day, items }) => (
          <section key={day} className="panel" aria-label={`Ngày ${day}`}>
            <h2 style={{ marginTop: 0 }}>{day}</h2>
            <ul className="account-list">
              {items.map((item) => (
                <li key={item.id} className="account-row">
                  <div>
                    <strong>{item.projectTitle ?? item.projectId.slice(0, 8)}</strong>
                    {" · "}
                    {item.accountDisplayName ?? item.platform ?? "Tài khoản"}
                    {" · "}
                    {STATUS_LABEL[item.status] ?? item.status}
                    {item.externalUrl && (
                      <>
                        {" · "}
                        <a href={item.externalUrl} target="_blank" rel="noreferrer">Xem</a>
                      </>
                    )}
                    <div className="profile-card-meta">
                      <Link to={`/projects/${item.projectId}/render`}>Mở dự án</Link>
                      {item.profileId && (
                        <>
                          {" · "}
                          <Link to={`/profiles/${item.profileId}/accounts`}>Hồ sơ</Link>
                        </>
                      )}
                    </div>
                    {item.guardrailReason && (
                      <p className="request-error" role="status">{item.guardrailReason}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
