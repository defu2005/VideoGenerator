import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationSettings, PairingCodeResponse } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { useToast } from "../../components/ui/Toast";
import { Spinner } from "../../components/Spinner";
import { LoadMore } from "../../components/ui/LoadMore";
import {
  createPairingCode,
  deleteTelegramToken,
  getNotificationLog,
  getNotificationSettings,
  saveNotificationSettings,
  saveTelegramToken,
  sendTestNotification,
} from "../../services/notificationsApi";

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ["settings", "notifications"], queryFn: getNotificationSettings });
  const log = useQuery({ queryKey: ["settings", "notifications", "log"], queryFn: getNotificationLog });
  const [form, setForm] = useState<NotificationSettings | null>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [pairing, setPairing] = useState<PairingCodeResponse | null>(null);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietFrom, setQuietFrom] = useState("22:00");
  const [quietTo, setQuietTo] = useState("07:00");
  const [logShown, setLogShown] = useState(20);

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      telegram: {
        enabled: settings.data.telegram.enabled,
        chatId: settings.data.telegram.chatId,
        botUsername: settings.data.telegram.botUsername,
      },
      events: { ...settings.data.events },
      dailySummaryTime: settings.data.dailySummaryTime,
      timezone: settings.data.timezone,
      quietHours: settings.data.quietHours,
    });
    setQuietEnabled(Boolean(settings.data.quietHours));
    if (settings.data.quietHours) {
      setQuietFrom(settings.data.quietHours.from);
      setQuietTo(settings.data.quietHours.to);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Chưa tải cài đặt");
      return saveNotificationSettings({
        ...form,
        quietHours: quietEnabled ? { from: quietFrom, to: quietTo } : null,
      });
    },
    onSuccess: async () => {
      setMessage("Đã lưu.");
      toast.success("Đã lưu thông báo");
      await queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });
    },
    onError: (reason) => {
      const text = reason instanceof Error ? reason.message : "Không lưu được";
      setMessage(text);
      toast.error(text);
    },
  });

  const saveToken = useMutation({
    mutationFn: () => saveTelegramToken(token.trim()),
    onSuccess: async () => {
      setToken("");
      setMessage("Đã lưu token bot.");
      toast.success("Đã lưu token bot");
      await queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });
    },
    onError: (reason) => {
      const text = reason instanceof Error ? reason.message : "Token không hợp lệ";
      setMessage(text);
      toast.error(text);
    },
  });

  const removeToken = useMutation({
    mutationFn: () => deleteTelegramToken(),
    onSuccess: async () => {
      setMessage("Đã xoá token.");
      toast.success("Đã xoá token");
      await queryClient.invalidateQueries({ queryKey: ["settings", "notifications"] });
    },
    onError: (reason) => toast.error(reason instanceof Error ? reason.message : "Không xoá được token"),
  });

  const pair = useMutation({
    mutationFn: () => createPairingCode(),
    onSuccess: (value) => {
      setPairing(value);
      setMessage("Mã ghép nối đã tạo (hết hạn sau 10 phút).");
      toast.success("Đã tạo mã ghép nối");
    },
    onError: (reason) => {
      const text = reason instanceof Error ? reason.message : "Không tạo được mã";
      setMessage(text);
      toast.error(text);
    },
  });

  const test = useMutation({
    mutationFn: () => sendTestNotification(),
    onSuccess: async (result) => {
      const text = result.ok ? "Đã gửi thông báo thử." : (result.error ?? "Gửi thử thất bại");
      setMessage(text);
      if (result.ok) toast.success(text);
      else toast.error(text);
      await queryClient.invalidateQueries({ queryKey: ["settings", "notifications", "log"] });
    },
    onError: (reason) => {
      const text = reason instanceof Error ? reason.message : "Gửi thử thất bại";
      setMessage(text);
      toast.error(text);
    },
  });

  if (settings.isPending) return <Spinner label="Đang tải cài đặt thông báo" />;
  if (settings.isError) {
    return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  }
  if (!form) return <Spinner label="Đang tải cài đặt thông báo" />;

  const status = settings.data;
  const botUsername = status.telegram.botUsername;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    save.mutate();
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Đã sao chép.");
    } catch {
      setMessage("Không sao chép được — hãy chọn và copy thủ công.");
    }
  }

  return (
    <section className="page-section notifications-page">
      <header className="page-heading">
        <div><p className="eyebrow">CÀI ĐẶT</p><h1>Thông báo</h1><p>Nhận cảnh báo pipeline, đăng bài và tóm tắt hằng ngày qua Telegram.</p></div>
      </header>

      <section className="panel">
        <h2>Thiết lập Telegram</h2>
        <ol className="help-steps">
          <li>Mở Telegram, tìm <strong>@BotFather</strong>.</li>
          <li>Gõ <code>/newbot</code>, đặt tên bot, nhận token.</li>
          <li>Dán token bên dưới (không hiện lại sau khi lưu) rồi bấm <strong>Lưu</strong>.</li>
          <li>Bấm <strong>Ghép nối</strong>, gửi lệnh <code>/start …</code> cho bot trong chat riêng.</li>
        </ol>

        <label className="form-field">
          <span>Token bot</span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            placeholder={status.tokenConfigured ? "•••••••• (đã cấu hình)" : "dán token từ BotFather"}
            aria-label="Token bot Telegram"
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <div className="render-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={!token.trim() || saveToken.isPending}
            onClick={() => {
              setMessage("");
              saveToken.mutate();
            }}
          >
            Lưu
          </button>
          {status.tokenConfigured && (
            <button
              className="button"
              type="button"
              disabled={removeToken.isPending}
              onClick={() => removeToken.mutate()}
            >
              Xoá token
            </button>
          )}
        </div>

        {status.conflict && (
          <div className="pairing-box" role="alert" style={{ borderColor: "var(--color-danger, #ef4444)" }}>
            <p><strong>⚠️ Xung đột Telegram (HTTP 409):</strong> Có tiến trình khác đang cùng đọc bot Telegram này. Bot tạm thời lùi thời gian đọc.</p>
          </div>
        )}

        <dl className="status-list">
          <div>
            <dt>Bot</dt>
            <dd>{botUsername ? `@${botUsername}` : "Chưa có"}</dd>
          </div>
          <div>
            <dt>Chat đã ghép</dt>
            <dd>{status.telegram.chatId ? status.telegram.chatId : "Chưa ghép nối"}</dd>
          </div>
        </dl>

        <div className="render-actions">
          <button
            className="button"
            type="button"
            disabled={!status.tokenConfigured || pair.isPending}
            onClick={() => {
              setMessage("");
              pair.mutate();
            }}
          >
            Ghép nối
          </button>
          <button
            className="button"
            type="button"
            disabled={!status.telegram.chatId || test.isPending}
            onClick={() => {
              setMessage("");
              test.mutate();
            }}
          >
            Gửi thử
          </button>
        </div>

        {pairing && (
          <div className="pairing-box" role="status">
            <p>Gửi lệnh này cho bot trong chat riêng:</p>
            <code aria-label="Lệnh ghép nối">{pairing.startCommand}</code>
            <div className="render-actions">
              <button className="button" type="button" onClick={() => void copyText(pairing.startCommand)}>
                Sao chép
              </button>
              {pairing.botUsername && (
                <a
                  className="button"
                  href={`https://t.me/${pairing.botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Mở t.me/{pairing.botUsername}
                </a>
              )}
            </div>
            <small>Hết hạn: {new Date(pairing.expiresAt).toLocaleString("vi-VN")}</small>
          </div>
        )}
      </section>

      <form className="panel" onSubmit={onSubmit}>
        <h2>Sự kiện</h2>
        <div className="notification-toggles">
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={form.telegram.enabled}
            aria-label="Bật thông báo Telegram"
            onChange={(event) =>
              setForm({
                ...form,
                telegram: { ...form.telegram, enabled: event.target.checked },
              })}
          />
          <span>Bật thông báo Telegram</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={form.events.attention}
            aria-label="Lỗi / cần chú ý"
            onChange={(event) =>
              setForm({ ...form, events: { ...form.events, attention: event.target.checked } })}
          />
          <span>Lỗi / cần chú ý</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={form.events.published}
            aria-label="Đăng thành công"
            onChange={(event) =>
              setForm({ ...form, events: { ...form.events, published: event.target.checked } })}
          />
          <span>Đăng thành công</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={form.events.waitingApproval}
            aria-label="Chờ duyệt"
            onChange={(event) =>
              setForm({ ...form, events: { ...form.events, waitingApproval: event.target.checked } })}
          />
          <span>Chờ duyệt (chỉ khi không chạy tự động)</span>
        </label>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={form.events.dailySummary}
            aria-label="Tóm tắt hằng ngày"
            onChange={(event) =>
              setForm({ ...form, events: { ...form.events, dailySummary: event.target.checked } })}
          />
          <span>Tóm tắt hằng ngày</span>
        </label>
        </div>
        <div className="form-row">
        <label className="form-field">
          <span>Giờ tóm tắt (HH:mm)</span>
          <input
            type="time"
            value={form.dailySummaryTime}
            aria-label="Giờ tóm tắt hằng ngày"
            onChange={(event) => setForm({ ...form, dailySummaryTime: event.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Múi giờ</span>
          <input
            type="text"
            value={form.timezone}
            aria-label="Múi giờ thông báo"
            onChange={(event) => setForm({ ...form, timezone: event.target.value })}
          />
        </label>
        </div>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={quietEnabled}
            aria-label="Bật giờ im lặng"
            onChange={(event) => setQuietEnabled(event.target.checked)}
          />
          <span>Giờ im lặng</span>
        </label>
        <p className="field-hint">Trong giờ im lặng: đăng thành công và tóm tắt bị giữ lại; lỗi vẫn gửi.</p>
        {quietEnabled && (
          <div className="form-row">
            <label className="form-field">
              <span>Từ</span>
              <input
                type="time"
                value={quietFrom}
                aria-label="Giờ im lặng từ"
                onChange={(event) => setQuietFrom(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Đến</span>
              <input
                type="time"
                value={quietTo}
                aria-label="Giờ im lặng đến"
                onChange={(event) => setQuietTo(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="render-actions">
          <button className="button button-primary" type="submit" disabled={save.isPending}>
            Lưu cài đặt
          </button>
          {message && <p role="status">{message}</p>}
        </div>
      </form>

      <section className="panel">
        <h2>Nhật ký thông báo</h2>
        {log.isPending && <Spinner label="Đang tải nhật ký" />}
        {log.isError && <ErrorState message={log.error.message} onRetry={() => void log.refetch()} />}
        {log.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Loại</th>
                  <th>Trạng thái</th>
                  <th>Nội dung</th>
                </tr>
              </thead>
              <tbody>
                {log.data.items.length === 0 && (
                  <tr>
                    <td colSpan={4}>Chưa có mục nào.</td>
                  </tr>
                )}
                {log.data.items.slice(0, logShown).map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.at).toLocaleString("vi-VN")}</td>
                    <td>{item.kind}</td>
                    <td>{item.status}</td>
                    <td>{item.message.replace(/<[^>]+>/g, "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore shown={Math.min(logShown, log.data.items.length)} total={log.data.items.length} onMore={() => setLogShown((count) => count + 20)} />
          </div>
        )}
      </section>
      <WebhookCard />
    </section>
  );
}

function WebhookCard() {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [log, setLog] = useState<Array<{ id: string; status: string; last_error: string | null }>>([]);
  async function create(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Agent bên ngoài", url, allowPrivate, eventTypes: [] }),
    });
    if (!response.ok) {
      toast.error("Không tạo được webhook.");
      return;
    }
    const body = await response.json() as { secret?: string; endpoint?: { id: string } };
    setSecret(body.secret ?? "");
    setEndpointId(body.endpoint?.id ?? "");
    toast.success("Đã tạo webhook. Bí mật chỉ hiện một lần.");
  }
  async function testHook() {
    if (!endpointId) return;
    const response = await fetch(`/api/webhooks/${endpointId}/test`, { method: "POST" });
    if (!response.ok) toast.error("Không gửi được sự kiện thử.");
    else toast.success("Đã gửi sự kiện ping.");
  }
  async function rotate() {
    if (!endpointId) return;
    const response = await fetch(`/api/webhooks/${endpointId}/rotate-secret`, { method: "POST" });
    if (!response.ok) {
      toast.error("Không đổi được bí mật.");
      return;
    }
    const body = await response.json() as { secret?: string };
    setSecret(body.secret ?? "");
    toast.success("Bí mật mới chỉ hiện một lần.");
  }
  async function loadLog() {
    if (!endpointId) return;
    const response = await fetch(`/api/webhooks/${endpointId}/deliveries`);
    if (!response.ok) return;
    const body = await response.json() as { deliveries: Array<{ id: string; status: string; last_error: string | null }> };
    setLog(body.deliveries);
  }
  return (
    <section className="panel">
      <h2>Kết nối agent bên ngoài</h2>
      <p>Webhook nhận sự kiện pipeline. Bí mật không được lưu lại trên trang này sau khi rời đi.</p>
      <form onSubmit={create}>
        <input aria-label="Địa chỉ webhook" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/hooks" />
        <label>
          <input type="checkbox" checked={allowPrivate} onChange={(event) => setAllowPrivate(event.target.checked)} />
          Cho phép mạng nội bộ
        </label>
        <button type="submit">Tạo webhook</button>
      </form>
      {endpointId ? (
        <p>
          <button type="button" onClick={() => void testHook()}>Gửi thử</button>
          <button type="button" onClick={() => void rotate()}>Đổi bí mật</button>
          <button type="button" onClick={() => void loadLog()}>Nhật ký gửi</button>
        </p>
      ) : null}
      {secret ? <p>Bí mật: {secret}</p> : null}
      {log.length ? <ul aria-label="Nhật ký webhook">{log.map((row) => <li key={row.id}>{row.status}{row.last_error ? ` · ${row.last_error}` : ""}</li>)}</ul> : null}
    </section>
  );
}
