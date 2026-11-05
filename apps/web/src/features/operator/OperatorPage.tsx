import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import {
  deleteStandingOrder,
  getOperatorOverview,
  openOperatorFolder,
  saveOperatorSettings,
  saveStandingOrder,
} from "../../services/operatorApi";
import { OperatorChat } from "./OperatorChat";

export function OperatorPage() {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: ["operator", "overview"], queryFn: getOperatorOverview });
  const [copied, setCopied] = useState("");
  const save = useMutation({
    mutationFn: saveOperatorSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["operator", "overview"] });
    },
  });
  const open = useMutation({ mutationFn: openOperatorFolder });

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
          <h1>Cursor operator</h1>
          <p>{cli} Hôm nay {data.usage.today}/{data.usage.cap}, tháng này {data.usage.month}.</p>
        </div>
      </header>
      <section className="panel">
        <h2>Trạng thái</h2>
        <p>{data.killed ? "Operator đang tắt." : "Operator đang bật."} Model: {data.cli.model || "mặc định của Cursor"}.</p>
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
            <li key={order.id}>
              {order.title} — {order.enabled ? "bật" : "tắt"} {order.cron ? `(${order.cron})` : ""}
              <button type="button" className="button button-secondary" onClick={() => void saveStandingOrder({ ...order, enabled: !order.enabled }).then(() => overview.refetch())}>
                {order.enabled ? "Tắt" : "Bật"}
              </button>
              <button type="button" className="button button-secondary" onClick={() => void deleteStandingOrder(order.id).then(() => overview.refetch())}>Xoá</button>
            </li>
          ))}
        </ul>
        <OrderForm onSaved={() => void overview.refetch()} />
      </section>
      <OperatorChat />
      <section className="panel">
        <h2>Lượt chạy gần đây</h2>
        <ul>
          {data.runs.slice(0, 8).map((run) => (
            <li key={run.id}>{run.status}: {run.prompt.slice(0, 80)} {run.toolChips.length ? `(${run.toolChips.join(", ")})` : ""} {run.outcome ?? ""}</li>
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
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("");
  return (
    <form
      className="assistant-input"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !prompt.trim()) return;
        void saveStandingOrder({
          title: title.trim(),
          prompt: prompt.trim(),
          cron: cron.trim() || null,
          enabled: true,
        }).then(() => {
          setTitle("");
          setPrompt("");
          setCron("");
          onSaved();
        });
      }}
    >
      <input aria-label="Tên lệnh thường trực" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tên lệnh" />
      <textarea aria-label="Nội dung lệnh thường trực" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} />
      <input aria-label="Lịch cron" value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 8 * * *" />
      <button type="submit" className="button button-primary">Thêm lệnh</button>
    </form>
  );
}
