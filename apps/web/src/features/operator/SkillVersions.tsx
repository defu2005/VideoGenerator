import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";

type Scenario = { id: string; prompt: string; expect: "pick" | "skip"; ok: boolean; rank: number | null };
type Version = {
  name: string;
  version: number;
  markdown: string;
  status: "draft" | "active" | "archived";
  score: number;
  activeScore: number | null;
  evaluation: { score: number; scenarios: Scenario[] };
  evidence: { source: "repeated_failure" | "user_review" | "user_edit" | "agent_proposal"; runIds: string[]; caller?: string; reason?: string };
};
type LearningReport = {
  lessons: { operator: string[]; profiles: Array<{ id: string; name: string; notes: string }> };
  skills: { active: Array<{ name: string; version: number; score: number }>; drafts: Array<{ name: string; version: number; score: number }> };
  toolProposals: Array<{ id: string; name: string; operation: string }>;
};

const queryKey = ["operator", "skill-versions"];
const labels = { draft: "Bản nháp", active: "Đang dùng", archived: "Phiên bản trước" };
const sources = { repeated_failure: "Lỗi lặp lại", user_review: "Bạn nạp", user_edit: "Bạn sửa", agent_proposal: "Agent đề xuất" };

function SkillVersionItem({ item }: { item: Version }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.markdown);
  const activate = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/versions/${item.version}/activate`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["operator"] }),
  });
  const save = useMutation({
    mutationFn: () => apiRequest(`/operator/skills/${item.name}/draft`, { method: "PUT", body: JSON.stringify({ markdown: text }) }),
    onSuccess: () => { setEditing(false); void client.invalidateQueries({ queryKey: ["operator"] }); },
  });
  const failed = item.evaluation.scenarios.filter((scenario) => !scenario.ok);
  const error = activate.error ?? save.error;
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
      {error ? <p role="alert">{error.message}</p> : null}
      {editing ? (
        <div>
          <textarea aria-label={`Sửa skill ${item.name}`} rows={14} value={text} onChange={(event) => setText(event.target.value)} />
          <button type="button" className="button" disabled={save.isPending} onClick={() => save.mutate()}>Lưu thành bản nháp</button>
          <button type="button" className="button button-secondary" onClick={() => { setEditing(false); setText(item.markdown); }}>Huỷ</button>
        </div>
      ) : <pre>{item.markdown}</pre>}
      {!editing ? (
        <button type="button" className="button button-secondary" onClick={() => setEditing(true)}>Sửa</button>
      ) : null}
      {item.status !== "active" ? (
        <button type="button" className="button button-secondary" disabled={activate.isPending || item.evaluation.score < 80}
          onClick={() => activate.mutate()}>{item.status === "draft" ? "Duyệt và dùng" : "Khôi phục phiên bản"}</button>
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
        {versions.data?.items.map((item) => <SkillVersionItem key={`${item.name}:${item.version}`} item={item} />)}
      </details>
    </section>
  );
}
