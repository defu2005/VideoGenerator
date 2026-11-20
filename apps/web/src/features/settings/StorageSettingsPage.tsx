import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { apiRequest } from "../../services/apiClient";
import { StorageLifecycle } from "./StorageLifecycle";

type StorageSettings = {
  provider: "local" | "s3";
  endpoint: string;
  bucket: string;
  region: string;
  checksumSha256: boolean;
};

type StorageStatus = StorageSettings & {
  credentialsConfigured: boolean;
  mirroredBytesToday: number;
  health: {
    lastOk: string | null;
    lastError: string | null;
    suspendedUntil: string | null;
    direct: number;
    control: number;
    fallback: number;
  };
};

const queryKey = ["settings", "storage"] as const;
const count = new Intl.NumberFormat("vi-VN");
const size = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function StorageSettingsPage() {
  const settings = useQuery({ queryKey, queryFn: () => apiRequest<StorageStatus>("/settings/storage") });
  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>Lưu trữ</h1>
        <p>Chọn đường truyền tệp giữa máy chủ và các máy worker.</p>
      </header>
      {settings.isPending && <Spinner label="Đang tải cài đặt lưu trữ" />}
      {settings.isError && <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />}
      {settings.data && <StorageForm status={settings.data} />}
      {settings.data && <StorageLifecycle />}
    </div>
  );
}

function StorageForm({ status }: { status: StorageStatus }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StorageSettings>({
    provider: status.provider, endpoint: status.endpoint, bucket: status.bucket, region: status.region,
    checksumSha256: status.checksumSha256,
  });
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();

  const save = useMutation({
    gcTime: 0,
    mutationFn: (body: string) => apiRequest<StorageStatus>("/settings/storage", { method: "PUT", body }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      setAccessKeyId("");
      setSecretAccessKey("");
      setFeedback({ error: false, text: "Đã lưu cấu hình lưu trữ." });
      save.reset();
    },
    onError: (error) => {
      setFeedback({ error: true, text: error.message });
      save.reset();
    },
  });
  const probe = useMutation({
    mutationFn: () => apiRequest<{ ok: boolean; latencyMs: number; error?: string }>("/settings/storage/test", { method: "POST" }),
    onSuccess: (result) => {
      setFeedback(result.ok ? { error: false, text: `Kiểm tra thành công (${count.format(result.latencyMs)} ms).` }
        : { error: true, text: result.error ?? "Kiểm tra thất bại." });
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => setFeedback({ error: true, text: error.message }),
  });

  const busy = save.isPending || probe.isPending;
  const s3 = draft.provider === "s3";
  const replacing = s3 && (!!accessKeyId || !!secretAccessKey);
  const changed = replacing || Object.keys(draft).some((key) => draft[key as keyof StorageSettings] !== status[key as keyof StorageSettings]);
  const { health } = status;
  const transfers = health.direct + health.control;

  function submit(event: FormEvent) {
    event.preventDefault();
    setFeedback(undefined);
    save.mutate(JSON.stringify({ settings: draft, ...(replacing ? { credentials: { accessKeyId, secretAccessKey } } : {}) }));
  }

  return (
    <>
      <section className="panel" aria-labelledby="storage-health-heading">
        <h2 id="storage-health-heading">Trạng thái truyền tệp</h2>
        {health.suspendedUntil && <p role="status">Đang chuyển tệp qua máy chủ đến {date.format(new Date(health.suspendedUntil))}.</p>}
        <dl>
          <dt>Đã sao lưu hôm nay (UTC)</dt>
          <dd>{size.format(status.mirroredBytesToday / 1024 ** 2)} MiB</dd>
          <dt>Lượt truyền trong 30 phút</dt>
          <dd>
            {count.format(health.direct)} trực tiếp{transfers > 0 ? ` (${percent.format(health.direct / transfers)})` : ""},{" "}
            {count.format(health.control)} qua máy chủ ({count.format(health.fallback)} lượt chuyển tuyến)
          </dd>
          <dt>Lần thành công gần nhất</dt>
          <dd>{health.lastOk ? date.format(new Date(health.lastOk)) : "Chưa có"}</dd>
          {health.lastError && <><dt>Lỗi gần nhất</dt><dd>{date.format(new Date(health.lastError))}</dd></>}
        </dl>
      </section>
      <form className="panel" aria-label="Cấu hình lưu trữ" onSubmit={submit}>
        <h2>Kho tệp</h2>
        <label className="form-field">
          <span>Nhà cung cấp</span>
          <select disabled={busy} value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value === "s3" ? "s3" : "local" })}>
            <option value="local">Đĩa máy chủ</option>
            <option value="s3">Kho tương thích S3</option>
          </select>
        </label>
        {s3 && <>
          <label className="form-field"><span>Endpoint</span>
            <input disabled={busy} type="url" required value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} />
          </label>
          <label className="form-field"><span>Bucket</span>
            <input disabled={busy} required value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value })} />
          </label>
          <label className="form-field"><span>Vùng</span>
            <input disabled={busy} required value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} />
          </label>
          <p>{status.credentialsConfigured ? "Đã lưu khóa. Chỉ nhập cả hai ô khi đổi khóa." : "Nhập thông tin truy cập của bucket."}</p>
          <label className="form-field"><span>Access key ID</span>
            <input disabled={busy} autoComplete="off" required={replacing || !status.credentialsConfigured} value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value)} />
          </label>
          <label className="form-field"><span>Secret access key</span>
            <input disabled={busy} type="password" autoComplete="new-password" required={replacing || !status.credentialsConfigured} value={secretAccessKey}
              onChange={(event) => setSecretAccessKey(event.target.value)} />
          </label>
          <label className="field-checkbox">
            <input disabled={busy} type="checkbox" checked={draft.checksumSha256}
              onChange={(event) => setDraft({ ...draft, checksumSha256: event.target.checked })} /> Kho hỗ trợ checksum SHA-256
          </label>
        </>}
        <div className="render-actions">
          <button className="button button-primary" type="submit" disabled={busy || !changed}>Lưu cấu hình</button>
          <button className="button button-secondary" type="button" disabled={busy || changed || status.provider !== "s3"}
            onClick={() => { setFeedback(undefined); probe.mutate(); }}>
            {probe.isPending ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
          </button>
        </div>
        {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
      </form>
    </>
  );
}
