import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionCheck, SecretRow, SecretStatus } from "@vg/shared";
import { getSecrets, removeSecret, saveSecret, testSecret } from "../../services/connectionsApi";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";

export function sourceBadge(status: SecretStatus | null): { tone: BadgeTone; label: string } {
  if (!status) return { tone: "neutral", label: "Không cần key" };
  if (status.error === "UNREADABLE") return { tone: "danger", label: "Không đọc được" };
  if (status.source === "app") return { tone: "success", label: "Đã lưu trong app" };
  if (status.source === "env") return { tone: "info", label: "Từ file .env" };
  return { tone: "warning", label: "Chưa có key" };
}

export function checkText(check: ConnectionCheck | null): string | null {
  if (!check) return null;
  const when = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(check.checkedAt));
  return `${check.ok ? "Hoạt động" : check.message || "Lỗi"} · kiểm tra lúc ${when}`;
}

/**
 * One secret field: a write-only password input with Lưu / Xoá / Kiểm tra.
 * The saved value never comes back from the server; only a short hint does.
 */
export function KeyRow({
  label,
  status,
  keyPageUrl,
  lastCheck,
  onSave,
  onRemove,
  onTest,
  busy = false,
}: {
  label: string;
  status: SecretStatus | null;
  keyPageUrl?: string | null;
  lastCheck?: ConnectionCheck | null;
  onSave: (value: string) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
  onTest?: () => Promise<unknown>;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | "test" | null>(null);
  const [error, setError] = useState("");
  const badge = sourceBadge(status);
  const inputId = `key-${label.replace(/\W+/g, "-").toLowerCase()}`;

  async function run(kind: "save" | "remove" | "test", action: () => Promise<unknown>) {
    setPending(kind);
    setError("");
    try {
      await action();
      if (kind === "save") setValue("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thực hiện được");
    } finally {
      setPending(null);
    }
  }

  const check = checkText(lastCheck ?? null);

  return (
    <div className="key-row" data-testid="key-row">
      <div className="key-row-head">
        <label htmlFor={inputId}>{label}</label>
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {status?.hint ? <code className="key-row-hint">{status.hint}</code> : null}
        {keyPageUrl ? <a href={keyPageUrl} target="_blank" rel="noopener noreferrer">Lấy key</a> : null}
      </div>
      {status?.error === "UNREADABLE" ? (
        <p role="alert" className="ui-field-error">
          Key đã lưu không giải mã được (có thể file data/secrets/token.key đã đổi). Hãy nhập lại key.
        </p>
      ) : null}
      {status?.source === "env" ? (
        <p className="ui-field-hint">Đang dùng giá trị trong .env. Lưu key ở đây sẽ ưu tiên hơn .env.</p>
      ) : null}
      <div className="key-row-actions">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={status?.configured ? "Nhập key mới để thay" : "Dán key vào đây"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          size="sm"
          disabled={!value.trim() || busy}
          loading={pending === "save"}
          onClick={() => void run("save", () => onSave(value.trim()))}
        >
          Lưu
        </Button>
        {onRemove && status?.source === "app" ? (
          <Button size="sm" variant="ghost" loading={pending === "remove"} disabled={busy} onClick={() => void run("remove", onRemove)}>
            Xoá
          </Button>
        ) : null}
        {onTest ? (
          <Button size="sm" variant="secondary" loading={pending === "test"} disabled={busy} onClick={() => void run("test", onTest)}>
            Kiểm tra
          </Button>
        ) : null}
      </div>
      {check ? <p className={lastCheck?.ok ? "ui-field-hint" : "ui-field-error"} role="status">{check}</p> : null}
      {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** Key rows for one kind of secret (image sources, web search). Used on several settings pages. */
export function SecretKeyRows({ kind, title }: { kind: "image" | "web"; title?: string }) {
  const queryClient = useQueryClient();
  const secrets = useQuery({ queryKey: ["connections", "secrets"], queryFn: getSecrets });
  const rows = Array.isArray(secrets.data?.secrets) ? secrets.data.secrets.filter((row) => row.kind === kind) : [];
  if (rows.length === 0) return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connections"] }).then(() =>
    queryClient.invalidateQueries({ queryKey: ["settings"] }));
  return (
    <section className="panel" aria-label={title ?? "Key"}>
      {title ? <h2>{title}</h2> : null}
      {rows.map((row) => <SecretKeyRow key={row.id} row={row} onChanged={refresh} />)}
    </section>
  );
}

export function SecretKeyRow({ row, onChanged }: { row: SecretRow; onChanged: () => Promise<unknown> }) {
  return (
    <KeyRow
      label={row.label}
      status={row.status}
      keyPageUrl={row.keyPageUrl}
      lastCheck={row.lastCheck}
      onSave={async (value) => { await saveSecret(row.id, value); await onChanged(); }}
      onRemove={async () => { await removeSecret(row.id); await onChanged(); }}
      onTest={async () => { await testSecret(row.id); await onChanged(); }}
    />
  );
}
