import { useEffect, useState } from "react";
import type { ScriptDraftPayload, ScriptCriterion } from "@vg/shared";
import { SCRIPT_CRITERION_WEIGHTS } from "@vg/shared";
import type { OutlineEditInput } from "../../services/scriptApi";

// Matches the server limit for centralQuestion and concreteMoment (TASK-146).
const OUTLINE_TEXT_MAX = 4000;

function fitsOutlineText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= OUTLINE_TEXT_MAX;
}

const CRITERION_LABELS: Record<ScriptCriterion, string> = {
  structure: "Cấu trúc (20%)",
  hook: "Mở đầu (20%)",
  accuracy: "Chính xác (20%)",
  ttsNatural: "Giọng đọc (15%)",
  visualizable: "Hình ảnh (15%)",
  originality: "Độc đáo (10%)",
};

export function ScriptDraftPanel({
  draft,
  onSwitchHook,
  onRescore,
  onApproveOutline,
  outlineAwaiting = false,
  isSwitchingHook = false,
  isRescoring = false,
  isApprovingOutline = false,
  onEditOutline,
  isEditingOutline = false,
}: {
  draft: ScriptDraftPayload;
  onSwitchHook: (hookId: string) => Promise<void>;
  onRescore: () => Promise<void>;
  onApproveOutline?: () => Promise<void>;
  // True only when the SCRIPT stage is WAITING_USER and the draft phase is outline_ready (TASK-146).
  outlineAwaiting?: boolean;
  isSwitchingHook?: boolean;
  isRescoring?: boolean;
  isApprovingOutline?: boolean;
  onEditOutline?: (edit: OutlineEditInput) => Promise<void>;
  isEditingOutline?: boolean;
}) {
  const [actionError, setActionError] = useState("");
  const critique = draft.critique;
  const outline = draft.outline;
  // TASK-146: while parked, the central question and each beat's concrete moment can be edited and saved before approval.
  const editable = outlineAwaiting && Boolean(onEditOutline) && Boolean(outline);
  const outlineKey = outline ? JSON.stringify(outline) : "";
  const [centralDraft, setCentralDraft] = useState(outline?.centralQuestion ?? "");
  const [momentDrafts, setMomentDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries((outline?.beats ?? []).map((beat) => [beat.id, beat.concreteMoment])));
  // A saved or refetched outline replaces the drafts, so the form shows what the server holds.
  useEffect(() => {
    setCentralDraft(outline?.centralQuestion ?? "");
    setMomentDrafts(Object.fromEntries((outline?.beats ?? []).map((beat) => [beat.id, beat.concreteMoment])));
  }, [outlineKey]);
  const centralChanged = centralDraft.trim() !== (outline?.centralQuestion ?? "").trim();
  const changedBeats = (outline?.beats ?? []).filter((beat) =>
    (momentDrafts[beat.id] ?? beat.concreteMoment).trim() !== beat.concreteMoment.trim());
  const outlineDirty = centralChanged || changedBeats.length > 0;
  const outlineInvalid = (centralChanged && !fitsOutlineText(centralDraft))
    || changedBeats.some((beat) => !fitsOutlineText(momentDrafts[beat.id] ?? ""));
  // Hook switch and rescore are blocked while an outline is parked or being written; the server answers 409 OUTLINE_PENDING.
  const outlinePending = draft.phase === "outline_ready" || draft.phase === "outline_approved";

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(`section-${sectionId}`) || document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-flash");
      setTimeout(() => el.classList.remove("highlight-flash"), 2000);
    }
  };

  const handleHookSwitch = async (hookId: string) => {
    setActionError("");
    try {
      await onSwitchHook(hookId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Đổi hook thất bại");
    }
  };

  const handleRescore = async () => {
    setActionError("");
    try {
      await onRescore();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Chấm điểm lại thất bại");
    }
  };

  const handleApproveOutline = async () => {
    if (!onApproveOutline) return;
    setActionError("");
    try {
      await onApproveOutline();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Duyệt dàn ý thất bại");
    }
  };

  const handleDiscardOutline = () => {
    setCentralDraft(outline?.centralQuestion ?? "");
    setMomentDrafts(Object.fromEntries((outline?.beats ?? []).map((beat) => [beat.id, beat.concreteMoment])));
    setActionError("");
  };

  const handleSaveOutline = async () => {
    if (!onEditOutline || !outlineDirty || outlineInvalid) return;
    const edit: OutlineEditInput = {};
    if (centralChanged) edit.centralQuestion = centralDraft.trim();
    if (changedBeats.length > 0) {
      edit.beats = changedBeats.map((beat) => ({ id: beat.id, concreteMoment: (momentDrafts[beat.id] ?? "").trim() }));
    }
    setActionError("");
    try {
      await onEditOutline(edit);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lưu dàn ý thất bại");
    }
  };

  return (
    <section className="panel script-draft-panel" aria-label="Dàn ý & chấm điểm">
      {outline && (
        <div className="script-draft-header">
          <div>
            <p className="eyebrow">DÀN Ý & CHẤM ĐIỂM (STORY ENGINE)</p>
            <h2>{outline.centralQuestion}</h2>
            <p className="story-promise"><em>Lời hứa:</em> {outline.promise}</p>
          </div>
          <div className="framework-badge">
            Khung: <strong>{outline.framework}</strong> ({draft.engineMode})
          </div>
        </div>
      )}

      {outlineAwaiting && (
        <div className="outline-approval-panel" role="status">
          <p>
            <strong>Dàn ý đang chờ bạn duyệt.</strong> Kịch bản chỉ được viết sau khi bạn duyệt dàn ý.
            Trong lúc chờ, không đổi hook và không chấm lại.
          </p>
          {editable && (
            <div className="outline-edit-form">
              <textarea
                className="outline-edit-input"
                aria-label="Câu hỏi trung tâm"
                rows={2}
                value={centralDraft}
                disabled={isEditingOutline || isApprovingOutline}
                onChange={(event) => setCentralDraft(event.target.value)}
              />
              <button
                className="button button-secondary"
                type="button"
                disabled={!outlineDirty || outlineInvalid || isEditingOutline || isApprovingOutline}
                onClick={() => void handleSaveOutline()}
              >
                {isEditingOutline ? "Đang lưu..." : "Lưu sửa dàn ý"}
              </button>
              {outlineDirty && (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isEditingOutline || isApprovingOutline}
                  onClick={handleDiscardOutline}
                >
                  Hoàn tác
                </button>
              )}
              {outlineInvalid && <small role="status">Nội dung không được trống và tối đa {OUTLINE_TEXT_MAX} ký tự.</small>}
              {!outlineInvalid && outlineDirty && <small role="status">Có thay đổi chưa lưu. Lưu trước khi duyệt.</small>}
            </div>
          )}
          {onApproveOutline && (
            <button
              className="button button-primary"
              type="button"
              disabled={isApprovingOutline || isEditingOutline || outlineDirty}
              onClick={() => void handleApproveOutline()}
            >
              {isApprovingOutline ? "Đang duyệt..." : "Duyệt dàn ý"}
            </button>
          )}
        </div>
      )}

      {!outlineAwaiting && draft.phase === "outline_approved" && (
        <p className="pipeline-mode-hint" role="status">Dàn ý đã được duyệt. Đang viết kịch bản; đổi hook và chấm lại sẽ bật lại sau khi xong.</p>
      )}

      {actionError && <p className="request-error" role="alert">{actionError}</p>}

      {/* Critique & Rubric Section */}
      {critique && (
        <div className="draft-critique-section">
          <div className="critique-score-row">
            <div className="total-score-badge">
              <span className="total-score-val">{critique.total}</span>
              <span className="total-score-max">/ 100</span>
              <span className="total-score-label">Điểm chất lượng</span>
            </div>
            <div className="critique-actions">
              {draft.critiqueStale && (
                <span className="stale-badge" title="Kịch bản đã sửa sau lần chấm trước">
                  Điểm chấm cũ
                </span>
              )}
              <button
                className="button button-secondary"
                type="button"
                disabled={isRescoring || outlinePending}
                onClick={() => void handleRescore()}
              >
                {isRescoring ? "Đang chấm..." : "Chấm lại"}
              </button>
            </div>
          </div>

          <div className="rubric-bars">
            {(Object.keys(SCRIPT_CRITERION_WEIGHTS) as ScriptCriterion[]).map((crit) => {
              const rawScore = critique.scores[crit] ?? 0;
              const pct = (rawScore / 5) * 100;
              return (
                <div key={crit} className="rubric-bar-item">
                  <div className="rubric-bar-label">
                    <span>{CRITERION_LABELS[crit] || crit}</span>
                    <span>{rawScore} / 5</span>
                  </div>
                  <div className="rubric-bar-track">
                    <div
                      className="rubric-bar-fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: pct >= 80 ? "var(--color-success, #22c55e)" : pct >= 60 ? "var(--color-primary, #3b82f6)" : "var(--color-warning, #f59e0b)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="critique-details">
            <div className="hook-status">
              <strong>Giải quyết hook:</strong>{" "}
              {critique.hookPaidOff ? "✓ Đã trả lời ở kết bài" : "⚠ Chưa được giải quyết trọn vẹn"}
            </div>
            {critique.unclosedLoops.length > 0 && (
              <div className="unclosed-loops">
                <strong>Loop chưa đóng:</strong> {critique.unclosedLoops.join(", ")}
              </div>
            )}
            {critique.sectionIssues.length > 0 && (
              <div className="section-issues-list">
                <h4>Vấn đề từng phần ({critique.sectionIssues.length}):</h4>
                <ul>
                  {critique.sectionIssues.map((issue, idx) => (
                    <li key={idx} className="issue-item">
                      <button
                        type="button"
                        className="text-button section-scroll-link"
                        onClick={() => scrollToSection(issue.sectionId)}
                      >
                        [{issue.criterion}] {issue.sectionId}
                      </button>
                      : {issue.problem} &rarr; <em>{issue.fix}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hook Candidates */}
      {draft.hookCandidates && draft.hookCandidates.length > 0 && (
        <div className="draft-hooks-section">
          <h3>Móc câu ứng viên (3 Hooks)</h3>
          <div className="hook-candidates-grid">
            {draft.hookCandidates.map((candidate) => {
              const isChosen = draft.chosenHookId === candidate.id;
              const assessment = draft.hookAssessments?.find((a) => a.hookId === candidate.id);
              return (
                <div key={candidate.id} className={`hook-card ${isChosen ? "hook-chosen" : ""}`}>
                  <div className="hook-card-header">
                    <span className="hook-tactic-tag">{candidate.tactic}</span>
                    {isChosen ? (
                      <span className="badge badge-active">Đang dùng</span>
                    ) : (
                      <button
                        className="button button-sm button-secondary"
                        type="button"
                        disabled={isSwitchingHook || outlinePending}
                        onClick={() => void handleHookSwitch(candidate.id)}
                      >
                        {isSwitchingHook ? "Đang đổi..." : "Dùng hook này"}
                      </button>
                    )}
                  </div>
                  <p className="hook-text">&ldquo;{candidate.text}&rdquo;</p>
                  {assessment && (
                    <div className="hook-score-chips">
                      <span>Tò mò: {assessment.scores.curiosity}/5</span>
                      <span>Rõ ràng: {assessment.scores.clarity}/5</span>
                      <span>Khớp khán giả: {assessment.scores.audienceFit}/5</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Story Beats */}
      {outline && (
        <div className="draft-beats-section">
          <h3>Nhịp kể (Beats)</h3>
          <ol className="beats-list">
            {outline.beats.map((beat, index) => (
              <li key={beat.id} className="beat-item">
                <div className="beat-title">
                  <strong>{beat.sectionKey}</strong> ({beat.targetSec}s) &mdash; {beat.purpose}
                </div>
                <div className="beat-details">
                  <span className="beat-emotion">Cảm xúc: {beat.emotion}</span>
                  {editable ? (
                    <div className="beat-moment">
                      <em>Khoảnh khắc:</em>
                      <textarea
                        className="outline-edit-input"
                        aria-label={`Khoảnh khắc nhịp ${index + 1}`}
                        rows={2}
                        value={momentDrafts[beat.id] ?? beat.concreteMoment}
                        disabled={isEditingOutline || isApprovingOutline}
                        onChange={(event) => setMomentDrafts((prev) => ({ ...prev, [beat.id]: event.target.value }))}
                      />
                    </div>
                  ) : (
                    <p className="beat-moment"><em>Khoảnh khắc:</em> {beat.concreteMoment}</p>
                  )}
                  {beat.opensLoops.length > 0 && (
                    <span className="loop-tag open-loop">Mở loop: {beat.opensLoops.join(", ")}</span>
                  )}
                  {beat.closesLoops.length > 0 && (
                    <span className="loop-tag close-loop">Đóng loop: {beat.closesLoops.join(", ")}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
