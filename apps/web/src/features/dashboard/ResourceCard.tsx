import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "../../components/ui/Card";
import { apiRequest } from "../../services/apiClient";

type ResourceClass = { class: string; labelVi: string; limit: number; running: number; waiting: number };
type Resources = {
  enabled: boolean;
  workerCap: number;
  sample: { cpuPct: number; ramPct: number; diskFreeBytes: number | null; gpuPct: number | null } | null;
  overVi: string[];
  classes: ResourceClass[];
};

function gb(bytes: number | null): string {
  return bytes === null ? "—" : `${(bytes / 1024 ** 3).toFixed(0)} GB`;
}

/** TASK-129b: machine load and slots per work class. */
export function ResourceCard() {
  const query = useQuery({
    queryKey: ["resources"],
    queryFn: () => apiRequest<Resources>("/resources"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const data = query.data;
  if (!data || !Array.isArray(data.classes)) return null;
  const sample = data.sample;
  return (
    <Card
      title="Tài nguyên"
      actions={<Link className="text-button" to="/settings/render#tai-nguyen">Cài đặt</Link>}
    >
      {sample ? (
        <p className="page-subtitle">
          CPU {Math.round(sample.cpuPct)}% · RAM {Math.round(sample.ramPct)}% · Ổ đĩa trống {gb(sample.diskFreeBytes)}
          {sample.gpuPct !== null ? ` · GPU ${Math.round(sample.gpuPct)}%` : ""}
        </p>
      ) : (
        <p className="page-subtitle">Đang đo máy…</p>
      )}
      {data.overVi.length > 0 && <p role="status">Máy đang quá tải ({data.overVi.join(", ")}), hệ thống giảm bớt việc chạy cùng lúc.</p>}
      {!data.enabled && <p className="page-subtitle">Bộ điều tiết đang tắt: chỉ giữ mức tối đa {data.workerCap} việc cùng lúc.</p>}
      <ul className="attention-list">
        {data.classes.map((item) => (
          <li key={item.class}>
            {item.labelVi}: {item.running}/{item.limit} đang chạy{item.waiting > 0 ? `, ${item.waiting} đang chờ` : ""}
          </li>
        ))}
      </ul>
    </Card>
  );
}
