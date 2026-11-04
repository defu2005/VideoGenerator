import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GuidelineSeverity, Project } from "@vg/shared";
import { dismissGuidelineFinding, getGuidelineFindings, recheckGuidelines } from "../../services/guidelinesApi";

const ORDER: GuidelineSeverity[] = ["MUST", "SHOULD", "TIP"];

export function GuidelineFindings({ project, stage }: { project: Project; stage: "SCRIPT" | "TIMELINE" }) {
  const queryClient = useQueryClient();
  const findings = useQuery({
    queryKey: ["guideline-findings", project.id],
    queryFn: () => getGuidelineFindings(project.id),
  });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const dismiss = useMutation({
    mutationFn: (findingId: string) => dismissGuidelineFinding(project.id, findingId, reasons[findingId]),
    onSuccess: (data) => queryClient.setQueryData(["guideline-findings", project.id], data),
  });
  const recheck = useMutation({
    mutationFn: () => recheckGuidelines(project.id),
    onSuccess: (data) => queryClient.setQueryData(["guideline-findings", project.id], data),
  });
  const open = (findings.data?.findings ?? []).filter((finding) => finding.status === "OPEN" && finding.stage === stage);
  const paused = project.mode === "AUTO" && (findings.data?.findings ?? []).some((finding) => finding.status === "OPEN" && finding.severity === "MUST");
  const attention = new Set(findings.data?.needsAttentionSceneIds ?? []);

  return (
    <section className="panel guideline-findings" aria-label="Định hướng nội dung">
      <header className="guideline-findings-head">
        <h2>Định hướng nội dung</h2>
        <button className="button button-secondary" type="button" disabled={recheck.isPending} onClick={() => recheck.mutate()}>
          {recheck.isPending ? "Đang kiểm tra…" : "Kiểm tra lại"}
        </button>
      </header>
      {paused && <p className="request-error" role="status">AUTO đang tạm dừng vì còn phát hiện mức MUST. Bạn có thể sửa nội dung hoặc bỏ qua.</p>}
      {findings.isError && <p className="field-error">Không tải được danh sách phát hiện.</p>}
      {open.length === 0 && !findings.isPending && <p className="field-hint">Không có phát hiện đang mở.</p>}
      {ORDER.map((severity) => {
        const group = open.filter((finding) => finding.severity === severity);
        if (!group.length) return null;
        return (
          <div key={severity}>
            <h3><span className={`severity-badge severity-${severity}`}>{severity}</span></h3>
            <ul>
              {group.map((finding) => (
                <li key={finding.id}>
                  <p><code>{finding.ruleId}</code>{finding.sceneId ? ` · ${attention.has(finding.sceneId) ? "Cần chú ý · " : ""}${finding.sceneId}` : ""}</p>
                  <p>{finding.text}</p>
                  {finding.quote && <blockquote>{finding.quote}</blockquote>}
                  {finding.suggestion && <p className="field-hint">{finding.suggestion}</p>}
                  <label className="form-field">
                    <span>Lý do bỏ qua (tuỳ chọn)</span>
                    <input
                      aria-label={`Lý do bỏ qua ${finding.ruleId}`}
                      value={reasons[finding.id] ?? ""}
                      onChange={(event) => setReasons((current) => ({ ...current, [finding.id]: event.target.value }))}
                    />
                  </label>
                  <button className="text-button" type="button" disabled={dismiss.isPending} onClick={() => dismiss.mutate(finding.id)}>Bỏ qua</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
