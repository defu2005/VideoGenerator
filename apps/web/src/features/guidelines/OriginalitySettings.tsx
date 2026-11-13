import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OriginalitySettingsSchema, type OriginalitySettings as Settings } from "@vg/shared";
import { getProfile, getProfiles, updateProfile } from "../../services/profilesApi";

export function OriginalitySettings() {
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => getProfiles() });
  const [id, setId] = useState("");
  return <section className="panel" aria-labelledby="originality-settings-title">
    <h2 id="originality-settings-title">Tính nguyên bản theo hồ sơ</h2>
    <p className="field-hint">Đây là ngưỡng an toàn nội bộ của app, không phải quy định hay bảo đảm kiếm tiền của nền tảng.</p>
    {profiles.isError && <p role="alert">Không tải được hồ sơ. <button type="button" onClick={() => void profiles.refetch()}>Thử lại</button></p>}
    <label className="form-field"><span>Hồ sơ áp dụng</span>
      <select value={id} onChange={(e) => setId(e.target.value)} disabled={profiles.isPending}>
        <option value="">Chọn hồ sơ</option>
        {profiles.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    {id && <ProfileSettings key={id} id={id} />}
  </section>;
}
function ProfileSettings({ id }: { id: string }) {
  const profile = useQuery({ queryKey: ["profile", id], queryFn: () => getProfile(id) });
  if (profile.isPending) return <p role="status">Đang tải ngưỡng…</p>;
  if (profile.isError) return <p role="alert">Không tải được ngưỡng. <button type="button" onClick={() => void profile.refetch()}>Thử lại</button></p>;
  return <SettingsForm id={id} initial={OriginalitySettingsSchema.parse(profile.data.guidelines.originality ?? {})} />;
}
function SettingsForm({ id, initial }: { id: string; initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState("");
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => updateProfile(id, { guidelines: { originality: OriginalitySettingsSchema.parse(settings) } }),
    onSuccess: (profile) => {
      client.setQueryData(["profile", id], profile);
      void client.invalidateQueries({ queryKey: ["originality"] });
    },
  });
  const fields = [
    ["maxScriptSimilarity", "Độ giống kịch bản tối đa (0–1)", 0, 1, 0.05],
    ["maxReusedImages", "Số ảnh tái sử dụng tối đa", 0, 10000, 1],
    ["minOwnContributionShare", "Đóng góp riêng tối thiểu (0–1)", 0, 1, 0.05],
    ["previousVideoLimit", "Số video trước để so sánh", 1, 100, 1],
  ] as const;
  return <form onSubmit={(e) => {
    e.preventDefault(); setError("");
    if (!OriginalitySettingsSchema.safeParse(settings).success) { setError("Kiểm tra các ngưỡng: tỷ lệ 0–1, số ảnh nguyên không âm, số video 1–100."); return; }
    save.mutate();
  }}>
    {(error || save.isError) && <p role="alert" className="request-error">{error || save.error?.message}</p>}
    <div className="guideline-params">{fields.map(([key, label, min, max, step]) => <label className="form-field" key={key}>
      <span>{label}</span><input type="number" required min={min} max={max} step={step} value={settings[key]}
        onChange={(e) => { setSettings({ ...settings, [key]: e.target.valueAsNumber }); save.reset(); }} />
    </label>)}</div>
    <label className="form-field"><span><input type="checkbox" checked={settings.requireNarration}
      onChange={(e) => { setSettings({ ...settings, requireNarration: e.target.checked }); save.reset(); }} /> Yêu cầu lời dẫn có giọng đọc</span></label>
    <button type="submit" className="secondary-button" disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu ngưỡng hồ sơ"}</button>
    {save.isSuccess && <p role="status">Đã lưu. Kiểm tra lại dự án để áp dụng ngưỡng mới.</p>}
  </form>;
}
