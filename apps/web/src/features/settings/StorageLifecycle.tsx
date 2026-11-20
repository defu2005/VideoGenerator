import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState } from "../../components/ErrorState";
import { apiRequest } from "../../services/apiClient";

type Settings = { graceDays: number; postPublishDays: number };
type Report = {
  settings: Settings;
  classes: Record<"global" | "shared" | "project" | "ephemeral", number>;
  projects: Array<{ projectId: string; bytes: number; orphanedBytes: number; dueBytes: number }>;
  orphanedBytes: number; dueBytes: number; dueCount: number; orphanedCount: number;
  orphaned: Array<{ projectId: string; path: string; bytes: number; purgeAfter: string }>;
  remote?: { bytes: number; orphanedBytes: number; dueBytes: number; dueCount: number; orphanedCount: number;
    orphaned: Array<{ sha256: string; bytes: number; purgeAfter: string }> };
};
type Run = { eligible: number; eligibleBytes: number; marked: number; purged: number; bytes: number; errors: number };
type Runs = { local: Run; remote: Run };
const key = ["settings", "storage", "files"] as const;
const size = (bytes: number) => `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(bytes / 1024 ** 2)} MiB`;
const date = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function StorageLifecycle() {
  const report = useQuery({ queryKey: key, queryFn: () => apiRequest<Report>("/settings/storage/files") });
  if (report.isError) return <ErrorState message={report.error.message} onRetry={() => void report.refetch()} />;
  if (!report.data) return <p role="status">Đang thống kê tệp…</p>;
  return <LifecycleForm report={report.data} />;
}

function LifecycleForm({ report }: { report: Report }) {
  const client = useQueryClient();
  const [settings, setSettings] = useState(report.settings);
  const [confirmation, setConfirmation] = useState<Runs>();
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => apiRequest<Settings>("/settings/storage/gc-settings", { method: "PUT", body: JSON.stringify(settings) }),
    onSuccess: () => { setFeedback("Đã lưu thời gian giữ tệp."); void client.invalidateQueries({ queryKey: key }); },
    onError: (reason) => setError(reason.message),
  });
  const preview = useMutation({
    mutationFn: () => apiRequest<Runs>("/settings/storage/dry-run", { method: "POST" }),
    onError: (reason) => setError(reason.message),
  });
  const purge = useMutation({
    mutationFn: () => apiRequest<Runs>("/settings/storage/purge", { method: "POST", body: JSON.stringify({ confirm: true }) }),
    onSuccess: (result) => {
      setConfirmation(undefined);
      setFeedback(`Đã dọn ${result.local.purged} tệp cục bộ và ${result.remote.purged} object S3, giải phóng ${size(result.local.bytes + result.remote.bytes)}. ${result.local.errors + result.remote.errors} lỗi.`);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (reason) => { setConfirmation(undefined); setError(reason.message); },
  });
  const busy = save.isPending || preview.isPending || purge.isPending;
  function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setFeedback(""); save.mutate();
  }
  function dryRun(confirm: boolean) {
    setError(""); setFeedback("");
    preview.mutate(undefined, { onSuccess: (result) => {
      if (confirm) setConfirmation(result);
      else setFeedback(`Chạy thử tìm thấy ${result.local.eligible} tệp và ${result.remote.eligible} object S3 đã hết thời gian giữ, tổng ${size(result.local.eligibleBytes + result.remote.eligibleBytes)}. ${result.local.marked + result.remote.marked} mục mới cần đánh dấu để bắt đầu thời gian chờ.`);
    } });
  }
  return (
    <section className="panel" aria-labelledby="storage-lifecycle-title">
      <h2 id="storage-lifecycle-title">Vòng đời tệp</h2>
      <dl>
        <dt>Thư viện dùng chung</dt><dd>{size(report.classes.global)}</dd>
        <dt>Tệp của hồ sơ và kênh</dt><dd>{size(report.classes.shared)}</dd>
        <dt>Tệp dự án</dt><dd>{size(report.classes.project)}</dd>
        <dt>Tệp tạm và xem trước</dt><dd>{size(report.classes.ephemeral)}</dd>
        <dt>Đang chờ dọn</dt><dd>{size(report.orphanedBytes)} trong {report.orphanedCount} tệp</dd>
        <dt>Đã hết thời gian giữ</dt><dd>{size(report.dueBytes)} trong {report.dueCount} tệp</dd>
        {report.remote && <>
          <dt>Đã lưu trên S3</dt><dd>{size(report.remote.bytes)}</dd>
          <dt>S3 đang chờ dọn</dt><dd>{size(report.remote.orphanedBytes)} trong {report.remote.orphanedCount} object</dd>
          <dt>S3 đã hết thời gian giữ</dt><dd>{size(report.remote.dueBytes)} trong {report.remote.dueCount} object</dd>
        </>}
      </dl>
      <form onSubmit={submit}>
        <label className="form-field"><span>Giữ tệp không còn sử dụng (7–60 ngày)</span>
          <input type="number" min={7} max={60} required disabled={busy} value={settings.graceDays}
            onChange={(event) => setSettings({ ...settings, graceDays: Number(event.target.value) })} />
        </label>
        <label className="form-field"><span>Dọn tệp trung gian sau đăng (0–60 ngày)</span>
          <input type="number" min={0} max={60} required disabled={busy} value={settings.postPublishDays}
            onChange={(event) => setSettings({ ...settings, postPublishDays: Number(event.target.value) })} />
        </label>
        <p>Tệp xem trước và tệp tạm chờ ít nhất một ngày sau khi được đánh dấu.</p>
        <div className="render-actions">
          <button className="button button-secondary" disabled={busy} type="submit">Lưu thời gian giữ</button>
          <button className="button button-secondary" disabled={busy} type="button" onClick={() => dryRun(false)}>Chạy thử (không xoá)</button>
          <button className="button button-danger" disabled={busy} type="button" onClick={() => dryRun(true)}>Dọn ngay</button>
        </div>
      </form>
      {feedback && <p role="status">{feedback}</p>}
      {error && <p role="alert">{error}</p>}
      {report.projects.length > 0 && <details><summary>Dung lượng từng dự án</summary>
        <ul>{report.projects.map((project) => <li key={project.projectId}>{project.projectId} — {size(project.bytes)}, chờ dọn {size(project.orphanedBytes)}</li>)}</ul>
      </details>}
      {report.orphaned.length > 0 && <details><summary>Tệp đang chờ dọn ({report.orphanedCount})</summary>
        <ul>{report.orphaned.map((file) => <li key={`${file.projectId}/${file.path}`}>
          <span style={{ overflowWrap: "anywhere" }}>{file.projectId}/{file.path}</span> — {size(file.bytes)}, từ {date.format(new Date(file.purgeAfter))}
        </li>)}</ul>
      </details>}
      {!!report.remote?.orphaned.length && <details><summary>Object S3 đang chờ dọn ({report.remote.orphanedCount})</summary>
        <ul>{report.remote.orphaned.map((file) => <li key={file.sha256}>
          <span style={{ overflowWrap: "anywhere" }}>{file.sha256}</span> — {size(file.bytes)}, từ {date.format(new Date(file.purgeAfter))}
        </li>)}</ul>
      </details>}
      <ConfirmDialog open={!!confirmation} title="Dọn các tệp đã hết thời gian giữ?"
        message={confirmation ? `${confirmation.local.eligible} tệp cục bộ và ${confirmation.remote.eligible} object S3, tổng ${size(confirmation.local.eligibleBytes + confirmation.remote.eligibleBytes)}. App kiểm tra lại tham chiếu trước khi dọn.` : ""}
        confirmLabel="Dọn tệp" cancelLabel="Giữ lại" busy={purge.isPending}
        onCancel={() => setConfirmation(undefined)} onConfirm={() => purge.mutate()} />
    </section>
  );
}
