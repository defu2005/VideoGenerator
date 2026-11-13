import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ON_OVERDUE_LABELS_VI,
  PLANNED_TIMEOUT_STAGES,
  STAGE_TIMEOUT_LABELS_VI,
  type OnOverdue,
  type PlannedTimeoutStage,
  type Project,
} from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

const SOURCE_VI = { llm: "AI", baseline: "Ước lượng", mixed: "Trộn" } as const;

const BASIS_VI = {
  history: "từ lịch sử",
  agent: "agent ước lượng",
  rough: "ước lượng thô",
  baseline: "ước lượng thô",
  user: "bạn đặt",
} as const;

export function StageTimeoutPanel({ project }: { project: Project }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Project | null>(null);
  useEffect(() => { setSaved(null); }, [project]);
  const shown = saved ?? project;
  const plan = shown.settings.stageTimeouts;

  const refresh = async (path: string, options?: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      const next = await apiRequest<Project>(path, options);
      setSaved(next);
      client.setQueryData(["project", project.id], next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không lưu được thời gian.");
    } finally {
      setBusy(false);
    }
  };

  if (!plan) {
    return (
      <section className="panel overview-card stage-timeout-card" aria-label="Thời gian tối đa mỗi bước">
        <h2>Thời gian tối đa mỗi bước</h2>
        <p>Sẽ tính khi dự án chạy.</p>
      </section>
    );
  }

  return (
    <section className="panel overview-card stage-timeout-card" aria-label="Thời gian tối đa mỗi bước">
      <div className="stage-timeout-header">
        <div>
          <h2>Thời gian tối đa mỗi bước</h2>
          <p className="stage-timeout-subtitle"><span className="status-badge">{SOURCE_VI[plan.source]}</span> {plan.summary}</p>
        </div>
        <button
          type="button"
          className="button button-secondary button-sm"
          disabled={busy}
          onClick={() => void refresh(`/projects/${project.id}/stage-timeouts/recompute`, { method: "POST" })}
        >
          Tính lại
        </button>
      </div>
      <ul className="stage-timeout-grid">
        {PLANNED_TIMEOUT_STAGES.map((stage) => {
          const row = plan.stages[stage];
          if (!row) return null;
          return (
            <li key={stage} className="stage-timeout-item">
              <div className="stage-timeout-item-header">
                <strong>{STAGE_TIMEOUT_LABELS_VI[stage]} · {(row.timeoutMs / 60_000).toFixed(1)} phút</strong>
                {row.expectedMs ? <span className="stage-timeout-expected">dự kiến ~{Math.max(1, Math.round(row.expectedMs / 60_000))} phút</span> : null}
                {row.source === "user" && <span className="status-badge">Bạn chọn</span>}
                {row.basis && row.source !== "user" && <span className="status-badge">{BASIS_VI[row.basis]}</span>}
              </div>
              <p className="stage-timeout-item-reason">{row.reason}</p>
              <div className="stage-timeout-item-actions">
                <label>
                  {" "}phút
                  <input
                    aria-label={`phút ${STAGE_TIMEOUT_LABELS_VI[stage]}`}
                    type="number"
                    min={1}
                    step={0.1}
                    defaultValue={(row.timeoutMs / 60_000).toFixed(1)}
                    disabled={busy}
                    onBlur={(event) => {
                      const minutes = Number(event.target.value);
                      if (!Number.isFinite(minutes) || minutes <= 0) return;
                      void refresh(`/projects/${project.id}/stage-timeouts`, {
                        method: "PATCH",
                        body: JSON.stringify({ stage, timeoutSec: Math.round(minutes * 60) }),
                      });
                    }}
                  />
                </label>
                {row.source === "user" && (
                  <button
                    type="button"
                    className="button button-secondary button-sm"
                    disabled={busy}
                    onClick={() => void refresh(`/projects/${project.id}/stage-timeouts`, {
                      method: "PATCH",
                      body: JSON.stringify({ stage, timeoutSec: null }),
                    })}
                  >
                    Xoá lựa chọn của tôi
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <label className="stage-timeout-on-overdue">
        Khi quá thời gian{" "}
        <select
          aria-label="Khi quá thời gian"
          value={shown.settings.onOverdue ?? "check"}
          disabled={busy}
          onChange={(event) => void refresh(`/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({ settings: { onOverdue: event.target.value as OnOverdue } }),
          })}
        >
          {(Object.keys(ON_OVERDUE_LABELS_VI) as OnOverdue[]).map((value) => (
            <option key={value} value={value}>{ON_OVERDUE_LABELS_VI[value]}</option>
          ))}
        </select>
      </label>
      {error && <p role="alert" className="stage-error">{error}</p>}
    </section>
  );
}

export type { PlannedTimeoutStage };
