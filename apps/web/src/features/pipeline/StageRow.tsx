import type { StageRecord } from "@vg/shared";
import { GATES } from "@vg/shared";

type Props = {
  record: StageRecord;
  canRun: boolean;
  busy: boolean;
  onRun(): void;
  onRetry(): void;
  onApprove(): void;
};

export function StageRow({ record, canRun, busy, onRun, onRetry, onApprove }: Props) {
  const isGate = GATES.includes(record.stage);
  const label = record.stage.replaceAll("_", " ");
  return (
    <li className={`pipeline-stage-row ${isGate ? "pipeline-gate" : ""}`} data-state={record.state}>
      <div className="pipeline-stage-heading">
        <div>
          <strong>{label}</strong>
          {isGate && <span className="gate-label">Review gate</span>}
        </div>
        <span className={`stage-state-badge stage-state-${record.state.toLowerCase()}`}>{record.state.replaceAll("_", " ")}</span>
      </div>
      {record.state === "RUNNING" && (
        <div className="stage-progress" role="progressbar" aria-label={`${label} progress`} aria-valuenow={record.progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${record.progress}%` }} />
        </div>
      )}
      {record.message && <p className="stage-message">{record.message}</p>}
      {record.error && <p className="stage-error" role="alert">{record.error.message}</p>}
      <div className="stage-actions">
        {record.state === "WAITING_USER" && (
          <button type="button" className="button button-primary" disabled={busy} onClick={onApprove}>
            {record.stage === "FINAL_APPROVAL" ? "Approve All" : "Approve"}
          </button>
        )}
        {record.state === "FAILED" && (
          <button type="button" className="button button-secondary" disabled={busy} onClick={onRetry}>Retry</button>
        )}
        {canRun && record.state !== "FAILED" && (
          <button type="button" className="button button-secondary" disabled={busy} onClick={onRun}>
            {record.state === "DONE" ? "Run again" : "Run"}
          </button>
        )}
      </div>
    </li>
  );
}
