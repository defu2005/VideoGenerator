import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiRequest } from "../../services/apiClient";

const ACTIONS = [
  { id: "observe", label: "Đọc màn hình" },
  { id: "navigate", label: "Chuyển trang (không đổi dữ liệu)" },
  { id: "click", label: "Bấm (luôn chờ bạn duyệt)" },
  { id: "type", label: "Nhập chữ (luôn chờ bạn duyệt)" },
] as const;

type Settings = {
  enabled: boolean;
  adapter: "none" | "simulator";
  allowedApps: string[];
  allowedActions: string[];
  maxSteps: number;
  timeoutSec: number;
};
type Status = {
  settings: Settings;
  available: boolean;
  reason: string | null;
  stoppedAt: string | null;
  adapter: { label: string; apps: string[] } | null;
};

const queryKey = ["operator", "computer-use"];

export function ComputerUsePanel() {
  const client = useQueryClient();
  const status = useQuery({ queryKey, queryFn: () => apiRequest<Status>("/operator/computer-use") });
  const [draft, setDraft] = useState<Settings | null>(null);
  const currentSettings = draft ?? status.data?.settings ?? null;
  const save = useMutation({
    mutationFn: (settings: Settings) => apiRequest<Status>("/operator/computer-use", { method: "PUT", body: JSON.stringify(settings) }),
    onSuccess: (data) => { client.setQueryData(queryKey, data); setDraft(data.settings); },
  });
  const stop = useMutation({
    mutationFn: () => apiRequest<Status>("/operator/computer-use/stop", { method: "POST" }),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  const error = status.error ?? save.error ?? stop.error;
  const data = status.data?.settings ? status.data : undefined;
  const toggleAction = (id: string, on: boolean) => currentSettings && setDraft({
    ...currentSettings, allowedActions: on ? [...currentSettings.allowedActions, id] : currentSettings.allowedActions.filter((item) => item !== id),
  });

  return (
    <section className="panel">
      <h2>Computer Use</h2>
      <p>
        Cho agent đọc và thao tác trên giao diện khi không có công cụ API hoặc MCP tương đương. Mặc định tắt.
        Agent dừng khi màn hình ra ngoài phạm vi, gặp bước đăng nhập hoặc dự án được bảo vệ. Bấm và nhập luôn chờ bạn duyệt.
      </p>
      {error ? <p role="alert">{error.message}</p> : null}
      {data ? (
        <p role="status">
          {data.available ? `Sẵn sàng · ${data.adapter?.label ?? ""}` : data.reason}
        </p>
      ) : <p>Đang tải…</p>}
      {currentSettings ? (
        <details>
          <summary>Cài đặt và quyền</summary>
          <label>
            <input type="checkbox" checked={currentSettings.enabled} onChange={(event) => setDraft({ ...currentSettings, enabled: event.target.checked })} />
            {" "}Bật Computer Use
          </label>
          <label>
            Môi trường{" "}
            <select value={currentSettings.adapter} onChange={(event) => setDraft({ ...currentSettings, adapter: event.target.value as Settings["adapter"] })}>
              <option value="none">Chưa có adapter</option>
              <option value="simulator">Ứng dụng thử (giả lập)</option>
            </select>
          </label>
          <label>
            Ứng dụng hoặc tên miền được phép (mỗi dòng một mục)
            <textarea rows={3} value={currentSettings.allowedApps.join("\n")}
              placeholder={data?.adapter?.apps.join("\n") ?? "ung-dung-thu"}
              onChange={(event) => setDraft({ ...currentSettings, allowedApps: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} />
          </label>
          <fieldset>
            <legend>Thao tác được phép</legend>
            {ACTIONS.map((action) => (
              <label key={action.id}>
                <input type="checkbox" checked={currentSettings.allowedActions.includes(action.id)}
                  onChange={(event) => toggleAction(action.id, event.target.checked)} />
                {" "}{action.label}
              </label>
            ))}
          </fieldset>
          <label>
            Số bước tối đa mỗi lượt{" "}
            <input type="number" min={1} max={50} value={currentSettings.maxSteps}
              onChange={(event) => setDraft({ ...currentSettings, maxSteps: Number(event.target.value) })} />
          </label>
          <label>
            Thời gian tối đa (giây){" "}
            <input type="number" min={10} max={600} value={currentSettings.timeoutSec}
              onChange={(event) => setDraft({ ...currentSettings, timeoutSec: Number(event.target.value) })} />
          </label>
          <button type="button" className="button" disabled={save.isPending} onClick={() => save.mutate(currentSettings)}>Lưu cài đặt</button>
        </details>
      ) : null}
      <button type="button" className="button button-secondary" disabled={stop.isPending || !data?.settings.enabled}
        onClick={() => stop.mutate()}>Dừng Computer Use</button>
    </section>
  );
}
