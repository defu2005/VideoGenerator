import { EmbeddingRow } from "./EmbeddingRow";
import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { ConnectionState, LlmConnectionRow, LlmConnectionUpdate } from "@vg/shared";
import { validatePlatformAppInput } from "@vg/shared";
import { VerifyPlatformApp } from "../accounts/VerifyPlatformApp";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { Badge, type BadgeTone } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";
import { Toggle } from "../../components/ui/Toggle";
import { useToast } from "../../components/ui/Toast";
import {
  addCustomLlm,
  getConnectionsOverview,
  getLlmConnections,
  getSecrets,
  getPlatformApp,
  savePlatformApp,
  importEnv,
  removeCustomLlm,
  removeLlmKey,
  startOpenRouterLogin,
  testLlmConnection,
  updateLlmConnection,
} from "../../services/connectionsApi";
import { KeyRow, SecretKeyRow, checkText } from "./KeyRow";

const STATE_BADGE: Record<ConnectionState, { tone: BadgeTone; label: string }> = {
  ready: { tone: "success", label: "Sẵn sàng" },
  needs_key: { tone: "warning", label: "Thiếu key" },
  error: { tone: "danger", label: "Lỗi" },
  disabled: { tone: "neutral", label: "Đang tắt" },
};

const KIND_LABEL: Record<LlmConnectionRow["kind"], string> = {
  api: "API",
  local: "Chạy trên máy",
  cli: "CLI",
  custom: "Tùy chỉnh",
};

const PRICING_LABEL: Record<LlmConnectionRow["pricing"], string> = {
  free: "Miễn phí",
  freemium: "Có gói miễn phí",
  paid: "Trả phí",
  local: "Cục bộ",
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Không thực hiện được";
}

function useInvalidateConnections() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["connections"] }),
    queryClient.invalidateQueries({ queryKey: ["settings"] }),
  ]);
}

export function ConnectionsPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const invalidate = useInvalidateConnections();
  const overview = useQuery({ queryKey: ["connections", "overview"], queryFn: getConnectionsOverview });
  const providers = useQuery({ queryKey: ["connections", "llm"], queryFn: getLlmConnections });
  const secrets = useQuery({ queryKey: ["connections", "secrets"], queryFn: getSecrets });

  useEffect(() => {
    const connected = params.get("connected");
    const failed = params.get("error");
    if (!connected && !failed) return;
    if (connected === "openrouter") toast.success("Đã đăng nhập OpenRouter và lưu key.");
    if (failed === "openrouter") toast.error("Đăng nhập OpenRouter không thành công. Hãy thử lại hoặc dán key thủ công.");
    const next = new URLSearchParams(params);
    next.delete("connected");
    next.delete("error");
    setParams(next, { replace: true });
    void invalidate();
  }, [params, setParams, toast, invalidate]);

  const doImport = useMutation({
    mutationFn: importEnv,
    onSuccess: async (result) => {
      toast.success(result.copied.length ? `Đã chép ${result.copied.length} key từ .env vào app.` : "Không có key mới để chép.");
      await invalidate();
    },
    onError: (reason) => toast.error(errorMessage(reason)),
  });

  if (overview.isPending || providers.isPending || secrets.isPending) return <Spinner label="Đang tải kết nối" />;
  if (overview.isError) return <ErrorState message={overview.error.message} onRetry={() => void overview.refetch()} />;
  if (providers.isError) return <ErrorState message={providers.error.message} onRetry={() => void providers.refetch()} />;
  if (secrets.isError) return <ErrorState message={secrets.error.message} onRetry={() => void secrets.refetch()} />;

  const imageSecrets = secrets.data.secrets.filter((row) => row.kind === "image");
  const webSecrets = secrets.data.secrets.filter((row) => row.kind === "web");
  const platformSecrets = secrets.data.secrets.filter((row) => row.kind === "platform");

  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="CÀI ĐẶT"
        title="Kết nối"
        description="Nhập key, đăng nhập nhà cung cấp AI và kiểm tra kết nối ngay trong app. Không cần sửa file .env."
      />

      <Card title="Tổng quan">
        <div className="connections-overview-grid">
          {overview.data.sections.map((section) => (
            <div key={section.id} className="connections-section-card">
              <div className="connections-section-head">
                <h3>{section.label}</h3>
                <span className="badge-count">{section.rows.length}</span>
              </div>
              {section.rows.length === 0 ? <p className="ui-field-hint">Chưa có kết nối.</p> : null}
              <div className="connections-section-rows">
                {section.rows.map((row) => (
                  <div key={row.id} className="overview-row">
                    {row.href.startsWith("/") && !row.href.startsWith("/settings/connections")
                      ? <Link to={row.href}>{row.label}</Link>
                      : <a href={row.href.replace("/settings/connections", "")}>{row.label}</a>}
                    <Badge tone={STATE_BADGE[row.state].tone}>{STATE_BADGE[row.state].label}</Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {overview.data.importable.length > 0 ? (
        <Card title="Chép key từ file .env">
          <p>
            Tìm thấy {overview.data.importable.length} key trong .env chưa lưu trong app. Chép vào app để quản lý tại đây
            (file .env không bị sửa).
          </p>
          <Button loading={doImport.isPending} onClick={() => doImport.mutate()}>Chép vào app</Button>
        </Card>
      ) : null}

      <section id="ai">
        <Card title="Nhà cung cấp AI">
          {providers.data.providers.map((row) => <ProviderEditor key={row.id} row={row} onChanged={invalidate} />)}
        </Card>
        <AddCustomProvider onAdded={invalidate} />
        <EmbeddingRow />
      </section>

      <section id="images">
        <Card title="Kho ảnh">
          <p className="ui-field-hint">Bật/tắt từng kho ở <Link to="/settings/image-sources">Nguồn ảnh</Link>.</p>
          {imageSecrets.map((row) => <SecretKeyRow key={row.id} row={row} onChanged={invalidate} />)}
        </Card>
      </section>

      <section id="web">
        <Card title="Tìm ảnh trên web">
          {webSecrets.map((row) => <SecretKeyRow key={row.id} row={row} onChanged={invalidate} />)}
        </Card>
      </section>

      <section id="platforms">
        <Card title="Ứng dụng nhà phát triển (YouTube, TikTok, Meta)" actions={<Link to="/accounts">Tài khoản nền tảng</Link>}>
          <p className="ui-field-hint">Dưới đây là ứng dụng dùng chung cho cả app.</p>
          {platformSecrets.map((row) => <PlatformAppEditor key={row.id} label={row.label}
            platform={row.id === "platform.youtube.app" ? "youtube" : row.id === "platform.tiktok.app" ? "tiktok" : "facebook_reels"} />)}
        </Card>
      </section>

      <Card title="An toàn">
        <p>
          Key được mã hoá bằng file <code>data/secrets/token.key</code>. Hãy sao lưu file này cùng thư mục data: mất file
          này thì phải nhập lại mọi key và đăng nhập lại tài khoản. Key không bao giờ được gửi về trình duyệt; app chỉ hiện
          vài ký tự cuối.
        </p>
      </Card>
    </div>
  );
}

function PlatformAppEditor({ platform, label }: { platform: string; label: string }) {
  const client = useQueryClient();
  const queryKey = ["connections", "platform-app", platform];
  const app = useQuery({ queryKey, queryFn: () => getPlatformApp(platform) });
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const validation = validatePlatformAppInput(platform, { clientId, clientSecret });
  const save = useMutation({
    mutationFn: () => savePlatformApp(platform, { scope: "app", clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: async () => {
      setEditing(false);
      setClientId("");
      setClientSecret("");
      await client.invalidateQueries({ queryKey: ["connections"] });
    },
  });
  return (
    <div className="form-stack">
      <strong>{label}{app.data?.hint ? ` · ${app.data.hint}` : ""}</strong>
      {app.error || save.error ? <p role="alert">{(app.error ?? save.error)?.message}</p> : null}
      {app.data?.problems?.length ? <div role="alert">{app.data.problems.map((problem) => <p key={problem}>{problem}</p>)}</div> : null}
      {app.data?.noteVi ? <p>{app.data.noteVi}</p> : null}
      {editing ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (validation.ok) save.mutate(); }}>
        <Field label="Client ID" error={clientId ? validation.errors.clientId : undefined}>
          {(props) => <input {...props} value={clientId} onChange={(event) => setClientId(event.target.value)} />}
        </Field>
        <Field label="Client Secret" error={clientSecret ? validation.errors.clientSecret : undefined}>
          {(props) => <input {...props} type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} />}
        </Field>
        {clientSecret ? validation.warnings.map((warning) => <p key={warning}>{warning}</p>) : null}
        <Button type="submit" disabled={!validation.ok} loading={save.isPending}>Lưu ứng dụng</Button>
      </form> : <Button variant="secondary" onClick={() => setEditing(true)}>{app.data?.configured ? "Nhập lại" : "Nhập thông tin ứng dụng"}</Button>}
      {platform === "youtube" && app.data?.configured ? <VerifyPlatformApp key={app.dataUpdatedAt} /> : null}
    </div>
  );
}

function ProviderEditor({ row, onChanged }: { row: LlmConnectionRow; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState(row.baseUrl ?? "");
  const [model, setModel] = useState(row.defaultModel ?? "");
  const [cliPath, setCliPath] = useState(row.cliPath ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setBaseUrl(row.baseUrl ?? "");
    setModel(row.defaultModel ?? "");
    setCliPath(row.cliPath ?? "");
  }, [row.baseUrl, row.defaultModel, row.cliPath]);

  async function update(change: LlmConnectionUpdate, success?: string) {
    setSaving(true);
    try {
      await updateLlmConnection(row.id, change);
      if (success) toast.success(success);
      await onChanged();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const check = await testLlmConnection(row.id);
      (check.ok ? toast.success : toast.error)(check.ok ? `${row.label}: hoạt động.` : `${row.label}: ${check.message}`);
      await onChanged();
    } catch (reason) {
      toast.error(errorMessage(reason));
    } finally {
      setTesting(false);
    }
  }

  async function login() {
    try {
      const { url } = await startOpenRouterLogin();
      window.location.assign(url);
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  }

  async function removeCustom() {
    if (!window.confirm(`Xoá nhà cung cấp ${row.label}? Key đã lưu cũng bị xoá.`)) return;
    try {
      await removeCustomLlm(row.id.replace(/^custom-/, ""));
      toast.success(`Đã xoá ${row.label}.`);
      await onChanged();
    } catch (reason) {
      toast.error(errorMessage(reason));
    }
  }

  const dirty = baseUrl !== (row.baseUrl ?? "") || model !== (row.defaultModel ?? "") || cliPath !== (row.cliPath ?? "");
  const status = row.ready ? { tone: "success" as const, label: "Sẵn sàng" }
    : row.enabled ? { tone: "warning" as const, label: "Chưa sẵn sàng" }
    : { tone: "neutral" as const, label: "Đang tắt" };
  const check = checkText(row.lastCheck);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const change: LlmConnectionUpdate = {};
    if (row.kind === "cli") change.cliPath = cliPath.trim();
    else {
      change.baseUrl = baseUrl.trim();
      change.defaultModel = model.trim();
    }
    void update(change, "Đã lưu.");
  }

  return (
    <div className="connection-provider" data-testid={`provider-${row.id}`}>
      <div className="connection-provider-head">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <strong>{row.label}</strong>
          <Badge tone="neutral">{KIND_LABEL[row.kind]}</Badge>
          <Badge tone="info">{PRICING_LABEL[row.pricing]}</Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <Toggle label="Bật" checked={row.enabled} onChange={(enabled) => void update({ enabled })} />
      </div>
      {row.howToVi.length > 0 ? (
        <ol className="connection-howto">{row.howToVi.map((line) => <li key={line}>{line}</li>)}</ol>
      ) : null}
      {row.secret ? (
        <KeyRow
          label={`Key ${row.label}`}
          status={row.secret}
          keyPageUrl={row.keyPageUrl}
          onSave={async (apiKey) => { await updateLlmConnection(row.id, { apiKey }); await onChanged(); }}
          onRemove={async () => { await removeLlmKey(row.id); await onChanged(); }}
        />
      ) : null}
      <form className="connection-provider-form" onSubmit={onSubmit}>
        <div className="connection-provider-fields">
          {row.kind === "cli" ? (
            <Field label="Đường dẫn CLI" hint="Để trống để dùng lệnh mặc định trong PATH.">
              {(props) => <input {...props} type="text" value={cliPath} onChange={(event) => setCliPath(event.target.value)} />}
            </Field>
          ) : (
            <>
              <Field label="Địa chỉ API" hint="Để trống để dùng địa chỉ mặc định.">
                {(props) => <input {...props} type="url" value={baseUrl} placeholder="https://…/v1" onChange={(event) => setBaseUrl(event.target.value)} />}
              </Field>
              <Field label="Model mặc định" hint="Để trống để dùng model mặc định của nhà cung cấp.">
                {(props) => <input {...props} type="text" value={model} onChange={(event) => setModel(event.target.value)} />}
              </Field>
            </>
          )}
        </div>
        <div className="connection-provider-actions">
          <Button size="sm" type="submit" disabled={!dirty} loading={saving}>Lưu</Button>
          <Button size="sm" variant="secondary" loading={testing} onClick={() => void test()}>Kiểm tra</Button>
          {row.supportsLogin ? <Button size="sm" variant="secondary" onClick={() => void login()}>Đăng nhập {row.label}</Button> : null}
          {row.kind === "custom" ? <Button size="sm" variant="danger" onClick={() => void removeCustom()}>Xoá</Button> : null}
        </div>
      </form>
      {row.kind !== "cli" ? (
        <Toggle
          label="Model đọc được ảnh"
          checked={row.vision === true}
          onChange={(vision) => void update({ vision })}
        />
      ) : null}
      {check ? <p className={row.lastCheck?.ok ? "ui-field-hint" : "ui-field-error"} role="status">{check}</p> : null}
    </div>
  );
}

function AddCustomProvider({ onAdded }: { onAdded: () => Promise<unknown> }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const add = useMutation({
    mutationFn: () => {
      const slug = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31);
      if (!slug) throw new Error("Tên cần có chữ hoặc số.");
      return addCustomLlm({
        slug,
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        ...(model.trim() ? { defaultModel: model.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
    },
    onSuccess: async (row) => {
      toast.success(`Đã thêm ${row.label}.`);
      setLabel("");
      setBaseUrl("");
      setModel("");
      setApiKey("");
      await onAdded();
    },
    onError: (reason) => setError(errorMessage(reason)),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    add.mutate();
  }

  return (
    <Card title="Thêm nhà cung cấp tương thích OpenAI">
      <form className="connection-provider-form" onSubmit={onSubmit}>
        <div className="connection-provider-fields">
          <Field label="Tên">
            {(props) => <input {...props} type="text" required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} />}
          </Field>
          <Field label="Địa chỉ API" hint="Ví dụ https://api.example.com/v1">
            {(props) => <input {...props} type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />}
          </Field>
          <Field label="Model mặc định">
            {(props) => <input {...props} type="text" value={model} onChange={(event) => setModel(event.target.value)} />}
          </Field>
          <Field label="Key (không bắt buộc)">
            {(props) => <input {...props} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />}
          </Field>
        </div>
        <div className="connection-provider-actions" style={{ marginTop: 8 }}>
          <Button type="submit" loading={add.isPending}>Thêm</Button>
        </div>
      </form>
      {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
    </Card>
  );
}
