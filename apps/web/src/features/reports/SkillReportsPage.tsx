import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";

type Report = {
  id: string;
  skill: string;
  profile_name: string | null;
  status: string;
  hypothesis: string | null;
  verdict: string | null;
  check_at: string | null;
  agent_kind: string;
  agent_name: string;
  agent_environment: string;
  created_at: string;
};
type Summary = { skill: string; skillHash: string; runs: number; dung: number; sai: number; chuaRo: number; lessons: string[]; review: boolean };
type Agent = { kind: string; name: string; environment: string; model: string | null; last_seen_at: string; calls: number; reports: number };
type Claim = { id: string; skill: string; agent_name: string; agent_environment: string; expires_at: string };

const tabs = [
  ["all", "Tất cả"],
  ["due", "Cần kiểm chứng"],
  ["skill", "Theo skill"],
  ["agents", "Agent"],
] as const;

export function SkillReportsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("all");
  const client = useQueryClient();
  const reports = useQuery({
    queryKey: ["skill-reports", tab],
    queryFn: () => apiRequest<{ items: Report[]; overlap: Array<{ profileName: string; environment: string }> }>(
      tab === "due" ? "/skill-reports?due=1" : "/skill-reports",
    ),
  });
  const summary = useQuery({
    queryKey: ["skill-report-summary"],
    enabled: tab === "skill",
    queryFn: () => apiRequest<{ items: Summary[] }>("/skill-reports/summary"),
  });
  const agents = useQuery({
    queryKey: ["agents"],
    enabled: tab === "agents",
    queryFn: () => apiRequest<{ items: Agent[]; claims: Claim[] }>("/agents"),
  });
  const verdict = useMutation({
    mutationFn: (id: string) => apiRequest(`/skill-reports/${id}/verdict`, {
      method: "POST",
      body: JSON.stringify({ metrics: [], verdict: "chua_ro", lesson: "Chưa đủ số để kết luận." }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["skill-reports"] }),
  });
  const release = useMutation({
    mutationFn: (id: string) => apiRequest(`/skill-reports/claims/${id}/release`, { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agents"] }),
  });
  const overlap = reports.data?.overlap ?? [];
  return (
    <section className="panel">
      <h1>Báo cáo thử nghiệm</h1>
      <div role="tablist" className="tab-bar" style={{ marginBottom: 16 }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {overlap.map((item) => (
        <p key={`${item.profileName}:${item.environment}`} role="alert" className="field-warning">
          Môi trường khác ({item.environment}) cũng đang vận hành hồ sơ này: {item.profileName}
        </p>
      ))}
      {tab === "all" || tab === "due" ? (
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr><th>Ngày</th><th>Skill</th><th>Hồ sơ</th><th>Agent</th><th>Môi trường</th><th>Trạng thái</th><th>Giả thuyết</th><th>Kết luận</th><th>Ngày kiểm</th></tr>
            </thead>
            <tbody>
              {(reports.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.created_at.slice(0, 10)}</td>
                  <td>{item.skill}</td>
                  <td>{item.profile_name}</td>
                  <td>{item.agent_kind} {item.agent_name}</td>
                  <td>{item.agent_environment}</td>
                  <td>{item.status}</td>
                  <td>{item.hypothesis}</td>
                  <td>{item.verdict ?? "chưa có"}</td>
                  <td>{item.check_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "due" ? (reports.data?.items ?? []).map((item) => (
        <button key={item.id} type="button" onClick={() => verdict.mutate(item.id)}>Lưu kết luận chưa rõ cho {item.skill}</button>
      )) : null}
      {verdict.error ? <p role="alert">{verdict.error.message}</p> : null}
      {tab === "skill" ? (
        <ul>
          {(summary.data?.items ?? []).map((item) => (
            <li key={`${item.skill}:${item.skillHash}`}>
              {item.skill} · {item.runs} lượt · đúng {item.dung} · sai {item.sai} · chưa rõ {item.chuaRo}
              {item.review ? <strong> Nên xem lại skill</strong> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {tab === "agents" ? (
        <div>
          <ul>
            {(agents.data?.items ?? []).map((item) => (
              <li key={`${item.kind}:${item.name}:${item.environment}`}>{item.kind} {item.name} · {item.environment} · {item.calls} lần gọi · {item.reports} báo cáo</li>
            ))}
          </ul>
          {(agents.data?.claims ?? []).map((claim) => (
            <p key={claim.id}>
              {claim.agent_name} đang giữ {claim.skill} đến {claim.expires_at}
              <button type="button" onClick={() => release.mutate(claim.id)}>Giải phóng</button>
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
