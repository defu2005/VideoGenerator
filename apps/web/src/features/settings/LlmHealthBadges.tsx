import { useQuery } from "@tanstack/react-query";
import { getLlmHealth } from "../../services/llmApi";

const REASON_LABEL = { rate_limit: "giới hạn tốc độ", quota: "hết quota", unavailable: "nhà cung cấp quá tải" } as const;

export function formatRestUntil(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** TASK-127: one badge per provider that is resting; renders nothing when all is well or the API is unreachable. */
export function LlmHealthBadges() {
  const health = useQuery({ queryKey: ["llm-health"], queryFn: getLlmHealth, refetchInterval: 30_000, retry: false });
  const cooldowns = health.data?.cooldowns ?? [];
  if (!cooldowns.length) return null;
  return (
    <section className="panel llm-health" aria-label="Nhà cung cấp AI đang nghỉ">
      <h2>Nhà cung cấp AI đang nghỉ</h2>
      <p>Hệ thống tự chuyển sang model dự phòng trong lúc các nhà cung cấp này nghỉ. Khởi động lại máy chủ sẽ xoá danh sách này.</p>
      <ul className="button-row">
        {cooldowns.map((item) => (
          <li key={`${item.provider}:${item.model ?? ""}`}>
            <span className="status-pill">
              {item.provider}{item.model ? ` / ${item.model}` : ""}: đang nghỉ đến {formatRestUntil(item.until)} ({REASON_LABEL[item.reason]})
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
