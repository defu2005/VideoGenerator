import { useCan } from "../../hooks/useCan";
import type { StageRecord } from "@vg/shared";
import { GATES } from "@vg/shared";

type Props = {
  record: StageRecord;
  canRun: boolean;
  busy: boolean;
  onRun(): void;
  onRetry(): void;
  onApprove(): void;
  onCancel?: () => void;
  /** Where the active job runs: a worker name, or null for the main machine. Undefined hides the line. */
  machine?: string | null;
};

export function StageRow({ record, canRun, busy, onRun, onRetry, onApprove, onCancel, machine }: Props) {
  const mayApprove = useCan("gate.approve");
  const mayRun = useCan("stage.run");
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
      {machine !== undefined && <p className="stage-machine">{machine ? `Máy: ${machine}` : "Máy chính"}</p>}
      {record.message && <p className="stage-message">{record.message}</p>}
      {record.error && <p className="stage-error" role="alert">{record.error.message}</p>}
      <div className="stage-actions">
        {mayApprove && record.state === "WAITING_USER" && (
          <button type="button" className="button button-primary" disabled={busy} onClick={onApprove}>
            {record.stage === "FINAL_APPROVAL" ? "Approve All" : "Approve"}
          </button>
        )}
        {mayRun && record.state === "FAILED" && (
          <button type="button" className="button button-secondary" disabled={busy} onClick={onRetry}>Retry</button>
        )}
        {mayRun && canRun && record.state !== "FAILED" && (
          <button type="button" className="button button-secondary" disabled={busy} onClick={onRun}>
            {record.state === "DONE" ? "Run again" : "Run"}
          </button>
        )}
        {(record.state === "QUEUED" || record.state === "RUNNING") && onCancel && (
          <button type="button" className="button button-danger-outline" disabled={busy} onClick={onCancel}>Hủy làn</button>
        )}
      </div>
    </li>
  );
}
