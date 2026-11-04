import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImageSourcesSettings, StockImageProvider } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { getImageSourcesSettings, saveImageSourcesSettings } from "../../services/imageSourcesApi";

export function ImageSourcesSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings", "image-sources"], queryFn: getImageSourcesSettings });
  const [form, setForm] = useState<ImageSourcesSettings | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setForm({ enabled: { ...settings.data.enabled } });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Chưa tải cài đặt");
      return saveImageSourcesSettings(form);
    },
    onSuccess: async (value) => {
      setForm({ enabled: { ...value.enabled } });
      setMessage("Đã lưu.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "image-sources"] });
    },
    onError: (reason) => {
      setMessage(reason instanceof Error ? reason.message : "Không lưu được");
    },
  });

  if (settings.isPending) return <Spinner label="Đang tải cài đặt nguồn ảnh" />;
  if (settings.isError) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  if (!form) return <Spinner label="Đang tải cài đặt nguồn ảnh" />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    save.mutate();
  }

  function toggle(id: StockImageProvider, enabled: boolean) {
    setForm({
      enabled: {
        ...form!.enabled,
        [id]: enabled,
      },
    });
  }

  const status = settings.data;

  return (
    <div className="settings-page">
      <header className="page-header">
        <p className="eyebrow">CÀI ĐẶT</p>
        <h1>Nguồn ảnh</h1>
        <p>Bật/tắt từng kho ảnh. Trạng thái key chỉ hiện “đã cấu hình” hoặc “thiếu key” — không hiện giá trị key.</p>
      </header>
      <form className="panel" onSubmit={onSubmit}>
        <ul className="settings-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {status.sources.map((source) => (
            <li key={source.id} className="form-field" style={{ display: "grid", gap: "0.35rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <input
                  type="checkbox"
                  checked={form.enabled[source.id] !== false}
                  aria-label={`Bật ${source.label}`}
                  onChange={(event) => toggle(source.id, event.target.checked)}
                />
                <span>{source.label}</span>
              </label>
              <small>
                Key:{" "}
                {source.keyRequired
                  ? (source.keyConfigured ? "đã cấu hình" : "thiếu key")
                  : "không cần key"}
                {" · "}
                {source.requestsPerMinute} lượt/phút
                {source.lastBlockedAt ? (
                  <>
                    {" · "}
                    Bị chặn lần gần nhất:{" "}
                    {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" })
                      .format(new Date(source.lastBlockedAt))}
                  </>
                ) : null}
              </small>
            </li>
          ))}
        </ul>
        <div className="render-actions">
          <button className="button button-primary" type="submit" disabled={save.isPending}>Lưu</button>
          {message && <p role="status">{message}</p>}
        </div>
      </form>
    </div>
  );
}
