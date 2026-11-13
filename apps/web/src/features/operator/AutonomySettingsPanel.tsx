import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AUTONOMY_PRESETS, AutonomyGrantsSchema, AutonomyLevelSchema, GoalSpecSchema, PIPELINE_STAGES,
  goalCapacityWarning, type AutonomyGrants, type AutonomyLevel, type AutonomySettings, type RepairSettings } from "@vg/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { apiRequest } from "../../services/apiClient";
import { AutonomyBudgetPanel } from "./AutonomyBudgetPanel";
import { SupervisorStatusPanel } from "./SupervisorStatusPanel";

const LEVELS: Record<AutonomyLevel, string> = {
  off: "Tắt · Không cấp quyền tự chủ",
  assist: "Trợ giúp · Hỏi trước thao tác rủi ro",
  supervised: "Có giám sát · Cấp quyền giới hạn",
  autonomous: "Toàn quyền · Trong giới hạn bạn đặt",
};
const FLAGS = {
  enableAutomation: "Bật tự động hóa",
  providers: "Chọn nhà cung cấp",
  topics: "Quản lý chủ đề",
  strategy: "Điều chỉnh chiến lược",
  retries: "Thử lại công việc",
  computerUse: "Điều khiển màn hình",
} satisfies Partial<Record<keyof AutonomyGrants, string>>;
const CHOICES = {
  publish: { never: "Không đăng", private: "Riêng tư", unlisted: "Không công khai", public: "Công khai" },
  omniroute: { off: "Tắt", read: "Đọc", write: "Ghi" },
  comments: { off: "Tắt", reply: "Trả lời", reply_and_hide: "Trả lời và ẩn" },
};
type AutonomyResponse = { settings: AutonomySettings; effective: AutonomySettings; repair?: RepairSettings };

function GoalDraft({ profileId }: { profileId: string }) {
  const [text, setText] = useState("1 video mỗi ngày lúc 20h");
  const videos = Number(text.match(/(\d+)/)?.[1] ?? 1);
  const spec = GoalSpecSchema.parse({
    videosPerDay: Number.isFinite(videos) ? videos : 1,
    platforms: ["youtube"], formats: ["long"], topicFocus: [text], avoid: [], publishTime: "20:00",
  });
  const warning = goalCapacityWarning(spec);
  const save = useMutation({
    mutationFn: () => apiRequest(`/autonomy/${profileId}/goals`, { method: "POST", body: JSON.stringify({ text, spec }) }),
  });
  return <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
    <h3>Mục tiêu</h3>
    <label>Lời của bạn <input aria-label="Mục tiêu" value={text} onChange={(event) => setText(event.target.value)} /></label>
    {warning ? <p role="alert">{warning}</p> : <p>Kế hoạch giữ trong hạn mức đăng an toàn.</p>}
    <button type="submit" className="button">Lưu mục tiêu</button>
  </form>;
}

function grantSummary(grants: AutonomyGrants): string {
  const flags = (Object.keys(FLAGS) as (keyof typeof FLAGS)[]).filter((key) => grants[key]).map((key) => FLAGS[key]);
  return [...flags, `Đăng: ${CHOICES.publish[grants.publish]}`, `OmniRoute: ${CHOICES.omniroute[grants.omniroute]}`,
    `Bình luận: ${CHOICES.comments[grants.comments]}`, `Cổng: ${grants.approveGates.join(", ") || "không có"}`].join(" · ");
}

export function AutonomySettingsPanel({ profileId }: { profileId?: string }) {
  const client = useQueryClient();
  const scope = profileId ?? "app";
  const path = `/autonomy/${scope}`;
  const query = useQuery({ queryKey: ["autonomy", scope], queryFn: () => apiRequest<AutonomyResponse>(path) });
  const [draft, setDraft] = useState<AutonomySettings>();
  const [confirm, setConfirm] = useState(false);
  const save = useMutation({
    mutationFn: (settings: AutonomySettings) => apiRequest<AutonomyResponse>(path, { method: "POST", body: JSON.stringify(settings) }),
    onSuccess: (result) => {
      client.setQueryData(["autonomy", scope], result);
      setDraft(undefined);
      setConfirm(false);
      void client.invalidateQueries({ queryKey: ["autonomy"] });
    },
  });
  const settings = draft ?? query.data?.settings;
  const title = profileId ? "Tự vận hành" : "Tự vận hành toàn app";
  if (!settings) return <section className="panel"><h2>{title}</h2><p role={query.isError ? "alert" : "status"}>
    {query.isError ? query.error.message : "Đang tải quyền…"}
  </p></section>;

  function changeGrant<K extends keyof AutonomyGrants>(key: K, value: AutonomyGrants[K]) {
    if (settings) setDraft({ ...settings, grants: { ...settings.grants, [key]: value } });
  }

  const repair = settings.repair ?? query.data?.repair;
  function changeRepair(patch: Partial<RepairSettings>) {
    if (settings && repair) setDraft({ ...settings, repair: { ...repair, ...patch } });
  }
  const repairNumber = (value: string, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || 0)));

  return <section className="panel">
    <h2>{title}</h2>
    <p>Quyền của hồ sơ nằm trong giới hạn toàn app.</p>
    <label>Mức tự chủ <select value={settings.level} onChange={(event) => {
      const level = AutonomyLevelSchema.parse(event.target.value);
      setDraft({ level, grants: AUTONOMY_PRESETS[level] });
    }}>
      {AutonomyLevelSchema.options.map((level) => <option key={level} value={level}>{LEVELS[level]}</option>)}
    </select></label>
    <fieldset disabled={save.isPending}>
      <legend>Quyền cho agent</legend>
      {(Object.keys(FLAGS) as (keyof typeof FLAGS)[]).map((key) => <label key={key}>
        <input type="checkbox" checked={settings.grants[key]} onChange={(event) => changeGrant(key, event.target.checked)} /> {FLAGS[key]}
      </label>)}
      <label>Đăng video <select value={settings.grants.publish} onChange={(event) => changeGrant("publish", AutonomyGrantsSchema.shape.publish.parse(event.target.value))}>
        {Object.entries(CHOICES.publish).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>OmniRoute <select value={settings.grants.omniroute} onChange={(event) => changeGrant("omniroute", AutonomyGrantsSchema.shape.omniroute.parse(event.target.value))}>
        {Object.entries(CHOICES.omniroute).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Bình luận <select value={settings.grants.comments} onChange={(event) => changeGrant("comments", AutonomyGrantsSchema.shape.comments.parse(event.target.value))}>
        {Object.entries(CHOICES.comments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <details><summary>Cổng pipeline</summary>
        {PIPELINE_STAGES.map((stage) => <label key={stage}>
          <input type="checkbox" checked={settings.grants.approveGates.includes(stage)} onChange={(event) =>
            changeGrant("approveGates", event.target.checked ? [...settings.grants.approveGates, stage] : settings.grants.approveGates.filter((item) => item !== stage))} /> {stage}
        </label>)}
      </details>
    </fieldset>
    {repair && settings.grants.retries ? <fieldset disabled={save.isPending}>
      <legend>Tự sửa chất lượng</legend>
      <p>Khi kịch bản, ảnh cảnh hoặc video không đạt cổng, agent tự chọn cách sửa trong giới hạn dưới đây.</p>
      <label>Số lượt sửa tối đa mỗi video (0–12) <input type="number" min={0} max={12} value={repair.maxAttemptsPerProject}
        onChange={(event) => changeRepair({ maxAttemptsPerProject: repairNumber(event.target.value, 12) })} /></label>
      <label>Số lần render thêm tối đa (0–4) <input type="number" min={0} max={4} value={repair.maxRendersPerProject}
        onChange={(event) => changeRepair({ maxRendersPerProject: repairNumber(event.target.value, 4) })} /></label>
      <label>Chi phí sửa tối đa mỗi video (USD, để trống = theo ngân sách ngày/tháng) <input type="number" min={0} step="0.01"
        value={repair.maxUsdPerProject ?? ""} onChange={(event) => changeRepair({ maxUsdPerProject: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) })} /></label>
      <label>Khi hết lượt <select value={repair.onExhausted} onChange={(event) => changeRepair({ onExhausted: event.target.value === "ask" ? "ask" : "shelve" })}>
        <option value="shelve">Gác video lại và làm chủ đề khác</option>
        <option value="ask">Hỏi tôi</option>
      </select></label>
    </fieldset> : null}
    {query.data && <p>Quyền hiệu lực đã lưu · {LEVELS[query.data.effective.level]} · {grantSummary(query.data.effective.grants)}</p>}
    <p>Agent không lấy khoá, không đăng nhập thay bạn, không nâng ngân sách, không tự tăng quyền và không đụng dự án được bảo vệ.</p>
    {profileId ? <GoalDraft profileId={profileId} /> : null}
    {save.isError && <p role="alert">{save.error.message}</p>}
    <button type="button" className="button" disabled={!draft || save.isPending} onClick={() => {
      if (settings.level === "autonomous") setConfirm(true);
      else save.mutate(settings);
    }}>Lưu quyền</button>
    <AutonomyBudgetPanel profileId={profileId} />
    <SupervisorStatusPanel profileId={profileId} />
    <ConfirmDialog open={confirm} title="Xác nhận Toàn quyền" message={grantSummary(settings.grants)}
      confirmLabel="Lưu quyền" cancelLabel="Huỷ" busy={save.isPending}
      onCancel={() => setConfirm(false)} onConfirm={() => save.mutate(settings)} />
  </section>;
}
