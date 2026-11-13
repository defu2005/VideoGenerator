import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";
import { getProfiles } from "../../services/profilesApi";

const KINDS = [
  { id: "job_failed", label: "Job lỗi" },
  { id: "render_completed", label: "Render hoàn tất" },
  { id: "quota_wait", label: "Chờ quota" },
  { id: "approval_wait", label: "Chờ duyệt" },
  { id: "job_overdue", label: "Bước chạy quá giờ" },
] as const;

type Rule = { profileId: string; kind: string; wake: boolean; telegram: boolean };

export function OperatorEventRules() {
  const client = useQueryClient();
  const [profileId, setProfileId] = useState("");
  const profiles = useQuery({ queryKey: ["profiles", "active"], queryFn: () => getProfiles() });
  const rules = useQuery({
    queryKey: ["operator", "event-rules"],
    queryFn: () => apiRequest<{ items: Rule[] }>("/operator/event-rules"),
  });
  const save = useMutation({
    mutationFn: (rule: Rule) => apiRequest("/operator/event-rules", { method: "PUT", body: JSON.stringify(rule) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator", "event-rules"] }),
  });
  const items = profiles.data?.items ?? [];
  const current = profileId || items[0]?.id || "";
  const ruleFor = (kind: string): Rule => rules.data?.items.find((rule) => rule.profileId === current && rule.kind === kind)
    ?? { profileId: current, kind, wake: false, telegram: false };
  const error = profiles.error ?? rules.error ?? save.error;

  return (
    <div>
      <h3>Quy tắc theo hồ sơ</h3>
      <p>Đánh thức agent chỉ đọc trạng thái dự án và tóm tắt cách xử lý. Lượt này không thay đổi dữ liệu, tôn trọng tạm dừng tự động và giới hạn lượt trong ngày.</p>
      {error ? <p role="alert">{error.message}</p> : null}
      {items.length === 0 && profiles.isSuccess ? <p>Chưa có hồ sơ.</p> : null}
      {items.length > 0 ? (
        <label>
          Hồ sơ{" "}
          <select value={current} onChange={(event) => setProfileId(event.target.value)}>
            {items.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
      ) : null}
      {current ? (
        <table>
          <thead><tr><th>Sự kiện</th><th>Đánh thức agent</th><th>Báo Telegram</th></tr></thead>
          <tbody>{KINDS.map((kind) => {
            const rule = ruleFor(kind.id);
            return (
              <tr key={kind.id}>
                <td>{kind.label}</td>
                <td>
                  <input
                    type="checkbox" aria-label={`Đánh thức agent khi ${kind.label}`}
                    checked={rule.wake} disabled={kind.id === "approval_wait" || save.isPending}
                    title={kind.id === "approval_wait" ? "Sự kiện chờ duyệt chỉ dùng thông báo." : undefined}
                    onChange={(event) => save.mutate({ ...rule, wake: event.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox" aria-label={`Báo Telegram khi ${kind.label}`}
                    checked={rule.telegram} disabled={save.isPending}
                    onChange={(event) => save.mutate({ ...rule, telegram: event.target.checked })}
                  />
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      ) : null}
    </div>
  );
}
