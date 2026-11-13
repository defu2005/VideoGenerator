import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WebImageSettings } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { getWebImageSettings, saveWebImageSettings } from "../../services/webImageApi";
import { SecretKeyRows } from "./KeyRow";

export function WebImageSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings", "web-image"], queryFn: getWebImageSettings });
  const [form, setForm] = useState<WebImageSettings | null>(null);
  const [denylistText, setDenylistText] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      braveEnabled: settings.data.braveEnabled,
      geminiGroundingEnabled: settings.data.geminiGroundingEnabled,
      geminiModel: settings.data.geminiModel,
      domainDenylist: settings.data.domainDenylist,
    });
    setDenylistText(settings.data.domainDenylist.join(", "));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Chưa tải cài đặt");
      const denylist = denylistText.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
      return saveWebImageSettings({ ...form, domainDenylist: denylist });
    },
    onSuccess: async (value) => {
      setForm({
        braveEnabled: value.braveEnabled,
        geminiGroundingEnabled: value.geminiGroundingEnabled,
        geminiModel: value.geminiModel,
        domainDenylist: value.domainDenylist,
      });
      setDenylistText(value.domainDenylist.join(", "));
      setMessage("Đã lưu.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "web-image"] });
    },
    onError: (reason) => {
      setMessage(reason instanceof Error ? reason.message : "Không lưu được");
    },
  });

  if (settings.isPending) return <Spinner label="Đang tải cài đặt nguồn ảnh web" />;
  if (settings.isError) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  if (!form) return <Spinner label="Đang tải cài đặt nguồn ảnh web" />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    save.mutate();
  }

  const status = settings.data;

  return (
    <div className="settings-page">
      <header className="page-header">
        <p className="eyebrow">CÀI ĐẶT</p>
        <h1>Nguồn ảnh web</h1>
        <p>Brave Image Search và Gemini grounding (miễn phí) khi kho ảnh không đủ. Không dùng agent LLM tốn kém.</p>
      </header>
      <form className="panel" onSubmit={onSubmit}>
        <label className="form-field">
          <span>Brave Image Search</span>
          <input
            type="checkbox"
            checked={form.braveEnabled}
            aria-label="Bật Brave Image Search"
            onChange={(event) => setForm({ ...form, braveEnabled: event.target.checked })}
          />
          <small>
            Key: {status.keyConfigured.brave ? "đã cấu hình" : "thiếu key (nhập bên dưới)"}
            {" · "}
            Lượt tháng này: {status.braveRequestsThisMonth}
          </small>
        </label>
        <label className="form-field">
          <span>Gemini grounding</span>
          <input
            type="checkbox"
            checked={form.geminiGroundingEnabled}
            aria-label="Bật Gemini grounding"
            onChange={(event) => setForm({ ...form, geminiGroundingEnabled: event.target.checked })}
          />
          <small>Key: {status.keyConfigured.gemini ? "đã cấu hình" : "thiếu key (nhập trong Kết nối)"}</small>
        </label>
        <label className="form-field">
          <span>Model Gemini grounding</span>
          <input
            type="text"
            value={form.geminiModel}
            aria-label="Model Gemini grounding"
            onChange={(event) => setForm({ ...form, geminiModel: event.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Domain denylist (phẩy ngăn cách)</span>
          <textarea
            value={denylistText}
            aria-label="Domain denylist"
            rows={3}
            onChange={(event) => setDenylistText(event.target.value)}
          />
          <small>Pinterest luôn bị chặn. Thêm domain spoiler/repost nếu cần.</small>
        </label>
        {!status.keyConfigured.brave && !status.keyConfigured.gemini && (
          <p role="status">Tính năng tắt vì thiếu key. Nhập key Brave bên dưới, hoặc key Gemini trong trang Kết nối.</p>
        )}
        <div className="render-actions">
          <button className="button button-primary" type="submit" disabled={save.isPending}>Lưu</button>
          {message && <p role="status">{message}</p>}
        </div>
      </form>
      <SecretKeyRows kind="web" title="Key Brave Search" />
    </div>
  );
}
