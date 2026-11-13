import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/ui/Toast";
import { apiRequest } from "../../services/apiClient";

const CLASSES = [
  { id: "cpu", label: "Dựng và xử lý (CPU)" },
  { id: "gpu", label: "GPU" },
  { id: "io", label: "Tải và đăng (mạng, đĩa)" },
  { id: "llm", label: "Gọi AI" },
] as const;
type Range = { min: number; max: number };
type Settings = { enabled: boolean; classes: Record<string, Range> };

/** TASK-129b: on/off and min/max slots per work class. */
export function GovernorSettingsCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["settings", "governor"], queryFn: () => apiRequest<{ settings: Settings }>("/settings/governor") });
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    const settings = query.data?.settings;
    if (settings && Array.isArray(Object.keys(settings.classes ?? {}))) setDraft(settings);
  }, [query.data]);
  const save = useMutation({
    mutationFn: (value: Settings) => apiRequest<{ settings: Settings }>("/settings/governor", { method: "PUT", body: JSON.stringify(value) }),
    onSuccess: async () => {
      toast.success("Đã lưu cài đặt tài nguyên");
      await queryClient.invalidateQueries({ queryKey: ["settings", "governor"] });
      await queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
    onError: (reason) => toast.error(reason instanceof Error ? reason.message : "Không lưu được"),
  });
  if (!draft || !draft.classes) return null;
  const setRange = (id: string, patch: Partial<Range>) =>
    setDraft({ ...draft, classes: { ...draft.classes, [id]: { ...draft.classes[id], ...patch } } });
  return (
    <section className="panel" id="tai-nguyen" aria-label="Tài nguyên máy">
      <h2>Tài nguyên máy</h2>
      <p>Hệ thống đo CPU, RAM, ổ đĩa và GPU mỗi 5 giây, rồi tự tăng hoặc giảm số việc chạy cùng lúc cho từng nhóm việc.</p>
      <label className="form-field">
        <span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          {" "}Tự điều tiết theo tải máy
        </span>
      </label>
      {CLASSES.map(({ id, label }) => draft.classes[id] && (
        <div className="form-field" key={id}>
          <span>{label}</span>
          <label>
            Tối thiểu{" "}
            <input type="number" min={1} max={64} value={draft.classes[id].min} aria-label={`${label}: tối thiểu`}
              onChange={(event) => setRange(id, { min: Number(event.target.value) })} />
          </label>
          {" "}
          <label>
            Tối đa{" "}
            <input type="number" min={1} max={64} value={draft.classes[id].max} aria-label={`${label}: tối đa`}
              onChange={(event) => setRange(id, { max: Number(event.target.value) })} />
          </label>
        </div>
      ))}
      <p className="stat-label">Tổng số việc cùng lúc không vượt WORKER_CONCURRENCY. Số lượt dựng cùng lúc vẫn do RENDER_CONCURRENCY giới hạn.</p>
      <button className="button button-primary" type="button" disabled={save.isPending} onClick={() => save.mutate(draft)}>
        Lưu tài nguyên
      </button>
    </section>
  );
}
