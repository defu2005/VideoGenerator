import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";

type Scenario = { id: string; prompt: string; expect: "pick" | "skip"; ok: boolean; rank: number | null };
/** Stored behaviour eval result (TASK-074b-2). Null until the eval has been run for this version. */
type Behaviour = { baseline: "active" | "builtin" | "none"; activeVersion: number | null; passed: boolean; judgeStatus: "ok" | "unavailable" | "insufficient"; score: number | null; activeScore: number | null; ranAt: string };
/** Shadow progress (TASK-074b-3b). Null for versions that are not in shadow. */
type ShadowInfo = { runs: number; firstAt: string | null; status: "dang_thu" | "du_mau" | "chua_du_mau"; shadowTools: string[]; baselineTools: string[] | null };
const shadowStatusLabels = { dang_thu: "Đang thử", du_mau: "Đủ mẫu", chua_du_mau: "Chưa đủ mẫu (đã quá 7 ngày)" };
/** Mirrors SHADOW_MIN_RUNS in apps/server/src/operator/shadow.ts. Keep in sync. */
const SHADOW_MIN_RUNS_HINT = 5;
const baselineLabels = { active: "bản đang dùng", builtin: "skill có sẵn", none: "không có" };
/** Behaviour scores are stored 0..1 (skillBehaviourEval.ts); show them on the same 0..100 scale as the eval panel. */
const pct = (value: number | null) => (value === null ? "—" : Math.round(value * 100));
const judgeLabels = { ok: "", unavailable: "Judge không sẵn sàng, chưa đánh giá được", insufficient: "Ít hơn 3 tình huống, không đủ để đánh giá" };
type Version = {
  name: string;
  version: number;
  markdown: string;
  status: "draft" | "active" | "archived" | "needs_merge" | "shadow";
  score: number;
  activeScore: number | null;
  evaluation: { score: number; scenarios: Scenario[] };
  behaviour: Behaviour | null;
  shadow: ShadowInfo | null;
  /** TASK-074b-4: whether the server lets this version be activated now, and why not. Missing counts as allowed. */
  activation?: { allowed: boolean; reasons: string[] } | null;
  evidence: { source: "repeated_failure" | "user_review" | "user_edit" | "agent_proposal" | "pattern" | "research" | "change_event" | "outcome" | "improvement"; runIds: string[]; caller?: string; reason?: string };
};
type LearningReport = {
  lessons: { operator: string[]; profiles: Array<{ id: string; name: string; notes: string }> };
  skills: { active: Array<{ name: string; version: number; score: number }>; drafts: Array<{ name: string; version: number; score: number }> };
  toolProposals: Array<{ id: string; name: string; operation: string }>;
};

const queryKey = ["operator", "skill-versions"];
const labels = { draft: "Bản nháp", active: "Đang dùng", archived: "Phiên bản trước", needs_merge: "Cần gộp thay đổi", shadow: "Shadow (chỉ ghi nhận, không chạy)" };
const sources = {
  repeated_failure: "Lỗi lặp lại", user_review: "Bạn nạp", user_edit: "Bạn sửa", agent_proposal: "Agent đề xuất",
  pattern: "Mẫu lặp lại", research: "Nghiên cứu", change_event: "Thay đổi", outcome: "Kết quả", improvement: "Cải tiến",
};

function SkillVersionItem({ item, active }: { item: Version; active?: Version }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.markdown);
  const activate = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/versions/${item.version}/activate`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator"] }),
  });
  const save = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/draft`, { method: "PUT", body: JSON.stringify({ markdown: text, baseVersion: item.version }) }),
    onSuccess: () => { setEditing(false); void client.invalidateQueries({ queryKey: ["operator"] }); },
  });
  // The eval runs a model judge and can take minutes; the button shows a pending state while it runs.
  const evaluate = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/versions/${item.version}/behaviour-eval`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator"] }),
  });
  const shadowOn = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/versions/${item.version}/shadow`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator"] }),
  });
  const shadowOff = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/shadow`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator"] }),
  });
  const failed = item.evaluation.scenarios.filter((scenario) => !scenario.ok);
  const error = activate.error ?? save.error ?? evaluate.error ?? shadowOn.error ?? shadowOff.error;
  const canShadow = item.status === "draft" && item.behaviour?.passed === true && item.behaviour.judgeStatus === "ok";
  const addedTools = item.shadow ? item.shadow.shadowTools.filter((tool) => !(item.shadow?.baselineTools ?? []).includes(tool)) : [];
  const removedTools = item.shadow?.baselineTools ? item.shadow.baselineTools.filter((tool) => !item.shadow?.shadowTools.includes(tool)) : [];
  return (
    <details>
      <summary>{item.name} v{item.version} · {labels[item.status]} · {sources[item.evidence.source]}</summary>
      <p>
        Bộ tình huống: {item.evaluation.score}/100 (cần 80 để dùng)
        {item.status === "draft" && item.activeScore !== null ? ` · Bản đang dùng: ${item.activeScore}/100` : ""}
      </p>
      {failed.length ? (
        <ul>{failed.map((scenario) => (
          <li key={scenario.id}>
            {scenario.expect === "pick" ? "Không chọn được khi hỏi" : "Bị chọn nhầm khi hỏi"}: “{scenario.prompt}”
          </li>
        ))}</ul>
      ) : null}
      {item.evidence.source === "agent_proposal" ? (
        <p>Nguồn: agent_proposal · {item.evidence.caller ?? "không rõ"} · {item.evidence.reason ?? "không có lý do"}</p>
      ) : null}
      {item.evidence.runIds.length ? <p>Lượt làm bằng chứng: {item.evidence.runIds.join(", ")}</p> : null}
      {item.behaviour ? (
        <p>
          Đánh giá hành vi: {item.behaviour.passed ? "đạt" : "chưa đạt"} · {pct(item.behaviour.score)}/100
          {" "}(bản nền: {baselineLabels[item.behaviour.baseline]}{item.behaviour.activeScore !== null ? `, ${pct(item.behaviour.activeScore)}/100` : ""})
          {judgeLabels[item.behaviour.judgeStatus] ? ` · ${judgeLabels[item.behaviour.judgeStatus]}` : ""}
        </p>
      ) : <p>Chưa chạy đánh giá hành vi.</p>}
      {item.shadow ? (
        <div>
          <p>
            Shadow: {shadowStatusLabels[item.shadow.status]} · ghi nhận {item.shadow.runs}/{SHADOW_MIN_RUNS_HINT} lượt
            {item.shadow.firstAt ? ` · bắt đầu ${new Date(item.shadow.firstAt).toLocaleString("vi-VN")}` : ""}
          </p>
          <p>Shadow chỉ ghi nhận lệnh sẽ dùng, không chạy công cụ nào.</p>
          <p>Công cụ shadow: {item.shadow.shadowTools.length ? item.shadow.shadowTools.join(", ") : "không khai báo"}</p>
          <p>Công cụ bản nền: {item.shadow.baselineTools === null ? "không có bản nền" : item.shadow.baselineTools.length ? item.shadow.baselineTools.join(", ") : "không khai báo"}</p>
          {item.shadow.baselineTools !== null ? <p>Thêm: {addedTools.length ? addedTools.join(", ") : "không"} · Bỏ: {removedTools.length ? removedTools.join(", ") : "không"}</p> : null}
        </div>
      ) : null}
      {error ? <p role="alert">{error.message}</p> : null}
      {editing ? (
        <div>
          <textarea aria-label={`Sửa skill ${item.name}`} rows={14} value={text} onChange={(event) => setText(event.target.value)} />
          <button type="button" className="button" disabled={save.isPending} onClick={() => save.mutate()}>Lưu thành bản nháp</button>
          <button type="button" className="button button-secondary" onClick={() => { setEditing(false); setText(item.markdown); }}>Huỷ</button>
        </div>
      ) : item.status === "needs_merge" ? <div className="form-grid">
        <div><h4>Bản đang dùng</h4><pre style={{ whiteSpace: "pre-wrap" }}>{active?.markdown ?? "Chưa có bản đang dùng"}</pre></div>
        <div><h4>Bản nháp cần gộp</h4><pre style={{ whiteSpace: "pre-wrap" }}>{item.markdown}</pre></div>
        <p>Chọn Sửa, gộp thay đổi rồi lưu thành bản nháp mới trước khi duyệt.</p>
      </div> : <pre>{item.markdown}</pre>}
      {!editing ? (
        <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>Sửa</button>
      ) : null}
      {item.status !== "active" && item.status !== "needs_merge" && item.status !== "shadow" ? (
        <button type="button" className="button button-secondary" disabled={activate.isPending || item.evaluation.score < 80 || item.activation?.allowed === false}
          title={item.activation && !item.activation.allowed ? item.activation.reasons.join("; ") : undefined}
          onClick={() => activate.mutate()}>{item.status === "draft" ? "Duyệt và dùng" : "Khôi phục phiên bản"}</button>
      ) : null}
      {item.status === "draft" && item.activation && !item.activation.allowed ? <p>Chưa dùng được: {item.activation.reasons.join("; ")}</p> : null}
      {item.status !== "active" && item.status !== "needs_merge" ? (
        <button type="button" className="button button-secondary" disabled={evaluate.isPending}
          onClick={() => evaluate.mutate()}>{evaluate.isPending ? "Đang đánh giá… (có thể mất vài phút)" : "Đánh giá hành vi"}</button>
      ) : null}
      {item.status === "draft" ? (
        <button type="button" className="button button-secondary" disabled={!canShadow || shadowOn.isPending}
          title={canShadow ? undefined : "Cần đánh giá hành vi đạt trước"} onClick={() => shadowOn.mutate()}>Đặt làm shadow</button>
      ) : null}
      {item.status === "shadow" ? (
        <button type="button" className="button button-secondary" disabled={shadowOff.isPending} onClick={() => shadowOff.mutate()}>Bỏ shadow</button>
      ) : null}
    </details>
  );
}

function LearningSummary({ enabled }: { enabled: boolean }) {
  const report = useQuery({
    queryKey: ["operator", "learning-report"], enabled,
    queryFn: () => apiRequest<LearningReport>("/operator/learning-report"),
  });
  if (!report.data) return report.error ? <p role="alert">{report.error.message}</p> : null;
  const { lessons, skills, toolProposals } = report.data;
  return (
    <div>
      <h3>Tổng hợp tự học</h3>
      <p>
        Bài học: {lessons.operator.length + lessons.profiles.length} · Skill đang dùng: {skills.active.length}
        {" "}· Bản nháp chờ duyệt: {skills.drafts.length} · Đề xuất công cụ chờ xử lý: {toolProposals.length}
      </p>
      {lessons.profiles.length ? (
        <details>
          <summary>Bài học theo hồ sơ</summary>
          <ul>{lessons.profiles.map((row) => <li key={row.id}><strong>{row.name}</strong>: {row.notes}</li>)}</ul>
        </details>
      ) : null}
      {lessons.operator.length ? (
        <details>
          <summary>Bài học của agent</summary>
          <ul>{lessons.operator.map((line, index) => <li key={index}>{line.slice(2)}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

type RepoSkill = { name: string; area: string; risk: string; tools: string[]; description: string };
type RepoRejected = { path: string; errors: string[] };

function RepoSkills() {
  const [openName, setOpenName] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["operator", "repo-skills"],
    queryFn: () => apiRequest<{ repo?: RepoSkill[]; repoRejected?: RepoRejected[] }>("/operator/skills"),
  });
  const detail = useQuery({
    queryKey: ["operator", "repo-skill", openName],
    enabled: Boolean(openName),
    queryFn: () => apiRequest<{ markdown: string }>(`/operator/skills/repo/${openName}`),
  });
  const repo = list.data?.repo ?? [];
  const rejected = list.data?.repoRejected ?? [];
  return (
    <div>
      <h3>Kỹ năng trong repo</h3>
      {list.error ? <p role="alert">{list.error.message}</p> : null}
      {repo.length === 0 ? <p>Chưa nạp kỹ năng từ repo.</p> : null}
      <ul>
        {repo.map((skill) => (
          <li key={skill.name}>
            <button type="button" onClick={() => setOpenName(skill.name)}>
              {skill.name}
            </button>
            {" "}· {skill.area} · {skill.risk} · {skill.tools.length} công cụ
            <p>{skill.description}</p>
          </li>
        ))}
      </ul>
      {openName && detail.data ? <pre aria-label={`Nội dung ${openName}`}>{detail.data.markdown}</pre> : null}
      {rejected.length ? (
        <div role="alert">
          {rejected.map((item) => (
            <p key={item.path}>{item.path}: {item.errors.join("; ")}</p>
          ))}
          <p>Sửa file trong .agents/skills rồi chạy lại operator</p>
        </div>
      ) : null}
    </div>
  );
}

export function SkillVersions() {
  const [open, setOpen] = useState(false);
  const versions = useQuery({
    queryKey, enabled: open,
    queryFn: () => apiRequest<{ items: Version[] }>("/operator/skills"),
  });
  return (
    <section className="panel">
      <h2>Phiên bản skill</h2>
      <RepoSkills />
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Xem bản nháp và các phiên bản</summary>
        <LearningSummary enabled={open} />
        {open && versions.isPending ? <p>Đang tải skill…</p> : null}
        {versions.error ? <p role="alert">{versions.error.message}</p> : null}
        {versions.data?.items.length === 0 ? <p>Chưa có phiên bản skill.</p> : null}
        {versions.data?.items.map((item) => <SkillVersionItem key={`${item.name}:${item.version}`} item={item} active={versions.data.items.find((other) => other.name === item.name && other.status === "active")} />)}
      </details>
    </section>
  );
}
