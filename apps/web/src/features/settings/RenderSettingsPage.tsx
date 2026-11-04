import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { getRenderSettings, saveRenderSettings } from "../../services/renderApi";

export function RenderSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings", "render"], queryFn: getRenderSettings });
  const [keepVersions, setKeepVersions] = useState(5);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (settings.data) setKeepVersions(settings.data.keepVersions);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => saveRenderSettings({ keepVersions }),
    onSuccess: async (value) => {
      setKeepVersions(value.keepVersions);
      setMessage("Đã lưu.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "render"] });
    },
    onError: (reason) => {
      setMessage(reason instanceof Error ? reason.message : "Không lưu được");
    },
  });

  if (settings.isPending) return <Spinner label="Đang tải cài đặt render" />;
  if (settings.isError) return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    save.mutate();
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <p className="eyebrow">CÀI ĐẶT</p>
        <h1>Render</h1>
        <p>Giữ bao nhiêu bản render gần nhất trên đĩa (bản đã ghim không bị xoá tự động).</p>
      </header>
      <form className="panel" onSubmit={onSubmit}>
        <label className="form-field">
          <span>Số bản giữ lại (1–50)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={keepVersions}
            aria-label="Số bản render giữ lại"
            onChange={(event) => setKeepVersions(Number(event.target.value))}
          />
        </label>
        <div className="render-actions">
          <button className="button button-primary" type="submit" disabled={save.isPending}>Lưu</button>
          {message && <p role="status">{message}</p>}
        </div>
      </form>
    </div>
  );
}
