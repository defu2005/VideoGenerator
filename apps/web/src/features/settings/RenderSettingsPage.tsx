import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "../../components/ErrorState";
import { useToast } from "../../components/ui/Toast";
import { Spinner } from "../../components/Spinner";
import { getRenderSettings, saveRenderSettings } from "../../services/renderApi";
import { apiRequest } from "../../services/apiClient";
import { WorkerNodesCard } from "./WorkerNodesCard";
import { GovernorSettingsCard } from "./GovernorSettingsCard";

export function RenderSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings", "render"], queryFn: getRenderSettings });
  const motion = useQuery({
    queryKey: ["motion", "status"],
    queryFn: () => apiRequest<{ version?: string; ok?: boolean; doctor?: string }>("/motion/status"),
  });
  const [keepVersions, setKeepVersions] = useState(5);
  const [message, setMessage] = useState("");
  const [trial, setTrial] = useState("");

  useEffect(() => {
    if (settings.data) setKeepVersions(settings.data.keepVersions);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => saveRenderSettings({ keepVersions }),
    onSuccess: async (value) => {
      setKeepVersions(value.keepVersions);
      setMessage("Đã lưu.");
      toast.success("Đã lưu cài đặt render");
      await queryClient.invalidateQueries({ queryKey: ["settings", "render"] });
    },
    onError: (reason) => {
      const text = reason instanceof Error ? reason.message : "Không lưu được";
      setMessage(text);
      toast.error(text);
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
      <section className="panel" aria-label="Đồ họa động">
        <h2>Đồ họa động</h2>
        <p>HyperFrames {motion.data?.version ?? "0.9.14"}. Chrome: {motion.data?.ok ? "có" : "chưa thấy"}.</p>
        <p>Lần render thử gần nhất: {trial || "chưa chạy"}.</p>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void apiRequest("/motion/browser", { method: "POST", body: "{}" })}
        >
          Cài trình render đồ họa
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void apiRequest<{ seconds: number; warning: string | null }>("/motion/trial", { method: "POST", body: "{}" }).then((result) => {
            setTrial(result.warning ? result.warning : `${result.seconds} giây`);
          }).catch((reason: unknown) => {
            setTrial(reason instanceof Error ? reason.message : "Không render thử được");
          })}
        >
          Render thử
        </button>
      </section>
      <GovernorSettingsCard />
      <WorkerNodesCard />
    </div>
  );
}
