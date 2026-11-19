import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FleetSettingsSchema, type FleetSettings } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { copyText } from "../team/InviteModal";

export type FleetOverview = {
  settings: FleetSettings; bundleVersion: number; hash: string; toolHash: string;
  instances: Array<{ instance: string; environment: string; host: string | null; hermesVersion: string | null; bundleVersion: number; lastSyncAt: string | null; lastError: string | null; pendingCron: string[]; issues: Array<{ kind: string; detail: string }> }>;
};
const key = ["operator", "fleet"];
function FleetSettingsForm({ initial }: { initial: FleetSettings }) {
  const [settings, setSettings] = useState(initial);
  const toast = useToast(), client = useQueryClient();
  const save = useMutation({ mutationFn: (input: FleetSettings) => apiRequest("/settings/hermes-fleet", { method: "PUT", body: JSON.stringify(input) }), onSuccess: () => { toast.success("Đã lưu cấu hình đội Hermes."); void client.invalidateQueries({ queryKey: key }); } });
  function submit(event: FormEvent) { event.preventDefault(); const parsed = FleetSettingsSchema.safeParse(settings); if (!parsed.success) { toast.error("Kiểm tra tên provider, URL, phiên bản và nhịp giám sát."); return; } save.mutate(parsed.data); }
  return <Card title="Cấu hình đội Hermes">
    <p>Chủ app chọn cấu hình dùng chung. Mỗi máy tự giữ khóa đăng nhập và khóa model của mình.</p>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Tên provider">{(field) => <input {...field} required value={settings.provider} onChange={(e) => setSettings({ ...settings, provider: e.target.value })} />}</Field>
      <Field label="Model">{(field) => <input {...field} required value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })} />}</Field>
      <Field label="URL tương thích OpenAI" hint="Địa chỉ mà máy Hermes truy cập được, không kèm khóa hay mật khẩu.">{(field) => <input {...field} type="url" required value={settings.baseUrl} onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })} />}</Field>
      <Field label="Phiên bản Hermes cố định" hint="Ví dụ 0.23.1; cập nhật cả image trên từng máy.">{(field) => <input {...field} required value={settings.hermesVersion} onChange={(e) => setSettings({ ...settings, hermesVersion: e.target.value })} />}</Field>
      <Field label="Giám sát mỗi bao nhiêu phút">{(field) => <input {...field} type="number" min={1} max={60} value={settings.supervisionMinutes} onChange={(e) => setSettings({ ...settings, supervisionMinutes: Number(e.target.value) })} />}</Field>
      <label className="checkbox-field"><input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => setSettings({ ...settings, memoryEnabled: e.target.checked })} /> Cho Hermes dùng ghi nhớ cục bộ</label>
      <label className="checkbox-field"><input type="checkbox" checked={settings.autoActivateReadOnlySkills} onChange={(e) => setSettings({ ...settings, autoActivateReadOnlySkills: e.target.checked })} /> Tự kích hoạt skill chỉ đọc khi qua đánh giá</label>
      <p className="muted">Skill có thao tác ghi hoặc bản nháp cần gộp vẫn chờ bạn duyệt trong Phiên bản skill.</p>
      {save.error ? <p role="alert">{save.error.message}</p> : null}
      <div><Button type="submit" loading={save.isPending}>Lưu đội Hermes</Button></div>
    </form>
  </Card>;
}
export function FleetTab() {
  const toast = useToast();
  const query = useQuery({ queryKey: key, queryFn: () => apiRequest<FleetOverview>("/operator/fleet"), refetchInterval: 15_000, refetchIntervalInBackground: false });
  if (query.isPending) return <Spinner label="Đang tải đội Hermes" />;
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  const data = query.data;
  const snippet = `VG_API_URL="${window.location.origin}" VG_MCP_URL="${window.location.origin}/mcp" HERMES_VERSION="${data.settings.hermesVersion}" node /duong-dan/videoGenerator/apps/mcp/dist/sync.js --once`;
  const copy = async (text: string) => { if (await copyText(text)) toast.success("Đã chép lệnh."); else toast.error("Không chép được; hãy chọn và chép nội dung lệnh."); };
  return <div className="form-stack">
    <Card title="Đội Hermes (Fleet)">
      <p>Gói chung phiên bản {data.bundleVersion}. Mỗi máy có thư mục riêng; chỉ một Hermes được trực ca.</p>
      {data.instances.length === 0 ? <p>Chưa có máy Hermes đồng bộ. Tạo khóa máy riêng trong Tài khoản của tôi, gắn loại Hermes rồi chạy bộ đồng bộ.</p> : <ul className="plain-list">{data.instances.map((item) => <li key={item.instance}>
        <h3>{item.instance}</h3>
        <p>{item.environment}{item.host ? ` · ${item.host}` : ""} · Hermes {item.hermesVersion ?? "chưa rõ"} · gói {item.bundleVersion}/{data.bundleVersion}</p>
        <p>Đồng bộ gần nhất: {item.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString("vi-VN") : "chưa đồng bộ"}</p>
        {item.issues.length ? <ul>{item.issues.map((issue, i) => <li key={`${issue.kind}:${i}`}>{issue.detail}</li>)}</ul> : <p>Đã đồng bộ.</p>}
        {item.lastError ? <p role="alert">{item.lastError}</p> : null}
        {item.pendingCron.map((command) => <div key={command}><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{command}</pre><Button variant="secondary" onClick={() => void copy(command)}>Chép lệnh cron</Button></div>)}
      </li>)}</ul>}
    </Card>
    <Card title="Thêm máy hoặc đồng bộ từ WSL">
      <p>Đặt VG_API_KEY và VG_HERMES_MODEL_KEY trên máy Hermes bằng khóa riêng của máy đó. Sửa đường dẫn trong lệnh bên dưới. Sau lần đồng bộ đầu, chạy /reload-mcp hoặc khởi động lại gateway.</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{snippet}</pre>
      <Button variant="secondary" onClick={() => void copy(snippet)}>Chép lệnh cài bộ đồng bộ</Button>
    </Card>
    <FleetSettingsForm key={JSON.stringify(data.settings)} initial={data.settings} />
  </div>;
}
