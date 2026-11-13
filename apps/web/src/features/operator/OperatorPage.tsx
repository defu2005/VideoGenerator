import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  deleteStandingOrder,
  getOperatorOverview,
  openOperatorFolder,
  resumeOperatorWorkflow,
  saveOperatorSettings,
  saveStandingOrder,
} from "../../services/operatorApi";
import { OperatorChat } from "./OperatorChat";
import { ToolProposals } from "./ToolProposals";
import { SkillVersions } from "./SkillVersions";
import { OperatorEvents } from "./OperatorEvents";
import { ComputerUsePanel } from "./ComputerUsePanel";
import { AutonomySettingsPanel } from "./AutonomySettingsPanel";

export function OperatorPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ["operator", "overview"],
    queryFn: getOperatorOverview,
    refetchInterval: (query) => (query.state.data?.activeRunId || (query.state.data?.queue && query.state.data.queue.length > 0) ? 2000 : false),
    refetchIntervalInBackground: false,
  });
  const [copied, setCopied] = useState("");
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: saveOperatorSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operator", "overview"] });
    },
  });
  const open = useMutation({ mutationFn: openOperatorFolder });
  const resume = useMutation({
    mutationFn: resumeOperatorWorkflow,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operator"] }),
  });
  const toggleOrder = useMutation({
    mutationFn: (order: NonNullable<typeof overview.data>["orders"][number]) =>
      saveStandingOrder({ ...order, enabled: !order.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operator", "overview"] }),
  });
  const deleteOrder = useMutation({
    mutationFn: (id: string) => deleteStandingOrder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["operator", "overview"] }),
  });

  if (overview.isPending) return <Spinner label="Đang tải operator" />;
  if (overview.isError) return <ErrorState message={overview.error.message} onRetry={() => void overview.refetch()} />;
  const data = overview.data;
  const cli = data.cli.found
    ? `Đã thấy CLI ${data.cli.version ?? ""}. ${data.cli.loggedIn === false ? "Chưa đăng nhập." : "Chưa kiểm tra đăng nhập."}`
    : "Chưa thấy Cursor CLI.";

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Đã chép.");
    } catch {
      setCopied(text);
    }
  }

  return (
    <section className="page-section">
      <header className="page-heading">
        <div>
          <p className="eyebrow">TRỢ LÝ</p>
          <h1>Agent operator</h1>
          <p>{cli} Hôm nay {data.usage.today}/{data.usage.cap}, tháng này {data.usage.month}.</p>
        </div>
      </header>
      <AutonomySettingsPanel />
      <section className="panel">
        <h2>Trạng thái</h2>
        <p>{data.killed ? "Operator đang tắt." : "Operator đang bật."}</p>
        {data.runtimeOptions && ([
          ["web", "Agent cho web"],
          ["telegram", "Agent cho Telegram"],
          ["schedule", "Agent cho lịch chạy"],
        ] as const).map(([channel, label]) => {
          const selected = data.settings.runtimeByChannel?.[channel] ?? "cursor";
          const option = data.runtimeOptions?.find((runtime) => runtime.id === selected);
          return (
            <label key={channel} className="form-field">
              <span>{label}</span>
              <select
                value={selected}
                disabled={save.isPending}
                onChange={(event) => save.mutate({ runtimeByChannel: { [channel]: event.target.value } })}
              >
                {!option && (
                  <option value={selected} disabled>{selected} (chưa khả dụng)</option>
                )}
                {data.runtimeOptions?.map((runtime) => (
                  <option key={runtime.id} value={runtime.id} disabled={!runtime.available}>
                    {runtime.label}{runtime.available ? "" : " (chưa khả dụng)"}
                  </option>
                ))}
              </select>
              {option?.reason && <small className="field-hint">{option.reason}</small>}
            </label>
          );
        })}
        {save.isError && <p role="alert">{save.error.message}</p>}
        <label className="field-checkbox">
          <input
            type="checkbox"
            aria-label="Tắt operator"
            checked={data.killed}
            onChange={(event) => save.mutate({ killed: event.target.checked })}
          />
          <span>Tắt operator</span>
        </label>
        <p>Thư mục: {data.workspacePath}</p>
        <button type="button" className="button button-secondary" onClick={() => open.mutate()}>Mở trong Cursor</button>
        {open.data && !open.data.opened && <p>Không mở được. Hãy chép đường dẫn.</p>}
        <p>Lệnh tiếp tục phiên: <code>{data.resumeCommand}</code></p>
        <button type="button" className="button button-secondary" onClick={() => void copy(data.resumeCommand)}>Chép lệnh</button>
        {copied && <p>{copied}</p>}
      </section>
      <section className="panel">
        <h2>Lệnh thường trực</h2>
        <ul>
          {data.orders.map((order) => (
            <li key={order.id} className="operator-order-item">
              <span className="operator-order-info">
                {order.title} — {order.enabled ? "bật" : "tắt"} {order.cron ? `(${order.cron})` : ""}
              </span>
              <div className="operator-order-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={toggleOrder.isPending}
                  onClick={() => toggleOrder.mutate(order)}
                >
                  {order.enabled ? "Tắt" : "Bật"}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={deleteOrder.isPending}
                  onClick={() => setPendingOrderId(order.id)}
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
        <OrderForm onSaved={() => void queryClient.invalidateQueries({ queryKey: ["operator", "overview"] })} />
        <ConfirmDialog
          open={pendingOrderId !== null}
          title="Xoá lệnh thường trực?"
          message="Lệnh này sẽ không còn chạy theo lịch."
          confirmLabel="Xoá lệnh"
          cancelLabel="Giữ lại"
          busy={deleteOrder.isPending}
          onCancel={() => setPendingOrderId(null)}
          onConfirm={() => {
            const id = pendingOrderId;
            setPendingOrderId(null);
            if (id) deleteOrder.mutate(id);
          }}
        />
      </section>
      <OperatorChat />
      <ToolProposals />
      <SkillVersions />
      <OperatorEvents />
      <ComputerUsePanel />
      <section className="panel">
        <h2>Lượt chạy gần đây</h2>
        {resume.isError ? <p role="alert">{resume.error.message}</p> : null}
        {resume.data ? <p role="status">{resume.data.message}</p> : null}
        <ul>
          {data.runs.slice(0, 8).map((run) => (
            <li key={run.id}>
              {run.prompt.slice(0, 80)} — {(run.result || run.status).slice(0, 180)} {run.toolChips.length ? `(${run.toolChips.join(", ")})` : ""}
              {run.canResume && data.runs.find((item) => item.workflowId === run.workflowId)?.id === run.id ? (
                <button type="button" className="button button-secondary" disabled={resume.isPending}
                  onClick={() => resume.mutate(run.id)}>Tiếp tục</button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Nhật ký công cụ</h2>
        <ul>
          {data.audit.slice(0, 8).map((row) => (
            <li key={row.id}>{row.source} {row.tool} {row.decision}: {row.summary}</li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Ghi chú</h2>
        {data.notes.map((note) => (
          <details key={note.name}>
            <summary>{note.name}</summary>
            <pre>{note.text}</pre>
          </details>
        ))}
      </section>
    </section>
  );
}

function OrderForm({ onSaved }: { onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("");
  const createOrder = useMutation({
    mutationFn: saveStandingOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["operator", "overview"] });
      setTitle("");
      setPrompt("");
      setCron("");
      onSaved();
    },
  });

  return (
    <form
      className="assistant-input"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !prompt.trim() || createOrder.isPending) return;
        createOrder.mutate({
          title: title.trim(),
          prompt: prompt.trim(),
          cron: cron.trim() || null,
          enabled: true,
        });
      }}
    >
      <input aria-label="Tên lệnh thường trực" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tên lệnh" />
      <textarea aria-label="Nội dung lệnh thường trực" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} />
      <input aria-label="Lịch cron" value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 8 * * *" />
      <button type="submit" className="button button-primary" disabled={createOrder.isPending}>
        {createOrder.isPending ? "Đang thêm..." : "Thêm lệnh"}
      </button>
    </form>
  );
}
