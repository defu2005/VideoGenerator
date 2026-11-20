import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { apiRequest } from "../../services/apiClient";

type ToolProposal = {
  id: string;
  kind: "internal" | "external_mcp";
  name: string;
  operation: string;
  reproduction: string;
  impact: string;
  inputSchema: object;
  outputSchema: object;
  permissions: string[];
  dataSent: string;
  requiresConfirmation: boolean;
  acceptance: string[];
  sourceUrl?: string;
};

// TASK-074c-4b-2 / 074c-3c-2: accepted rows add impNumber and draftedAt (ISO string or null) to the open-row shape.
// impNumber is assigned at first draft (assignImpNumber), so a freshly accepted row has it null.
type AcceptedProposal = ToolProposal & { impNumber: number | null; draftedAt: string | null };
// TASK-074c-6h: the done list adds taskRef, which is null when no check ever recorded a task.
type DoneProposal = AcceptedProposal & { taskRef: string | null };

type RefusedReason = "bad_name" | "bad_root" | "unsafe_target" | "exists" | "bad_content";
type SkipReason = "not_accepted" | "already_drafted" | "state_changed" | "in_flight";
type DraftOutcome =
  | { status: "drafted"; impNumber: number }
  | { status: "pending"; reason: "budget_limit"; impNumber: number }
  | { status: "refused"; reason: RefusedReason; impNumber: number }
  | { status: "skipped"; reason: SkipReason };

const DRAFT_MARKER = "Bản nháp guide — cần Claude xem lại trước khi giao Codex/Cursor";
const FALLBACK_DRAFT_MESSAGE = "Không soạn được bản nháp.";
// Exhaustive: a reason added on the server without a message here fails the typecheck.
const draftMessages: Record<RefusedReason | SkipReason | "budget_limit", string> = {
  budget_limit: "Hết ngân sách soạn bản nháp. Thử lại sau kỳ ngân sách mới.",
  bad_name: "Tên đề xuất không hợp lệ để đặt tên file.",
  bad_root: "Thư mục docs/proposals không hợp lệ hoặc chưa tồn tại.",
  unsafe_target: "Đường dẫn file đích không an toàn, không ghi.",
  exists: "File bản nháp cho đề xuất này đã tồn tại.",
  bad_content: "Nội dung bản nháp không hợp lệ, không ghi file.",
  not_accepted: "Đề xuất chưa được chấp nhận nên không soạn được.",
  already_drafted: "Đề xuất này đã có bản nháp.",
  state_changed: "Trạng thái đề xuất đã đổi. Tải lại danh sách rồi thử.",
  in_flight: "Đang soạn bản nháp cho đề xuất này. Thử lại sau.",
};

function draftOutcomeText(outcome: DraftOutcome): string {
  if (outcome.status === "drafted") return `Đã soạn bản nháp IMP-${outcome.impNumber}.`;
  // A reason the page does not know gets the generic text, never an inherited object key.
  return Object.prototype.hasOwnProperty.call(draftMessages, outcome.reason)
    ? draftMessages[outcome.reason as keyof typeof draftMessages]
    : FALLBACK_DRAFT_MESSAGE;
}

const queryKey = ["operator", "tool-proposals"];
const acceptedKey = [...queryKey, "accepted"];
const inProgressKey = [...queryKey, "in-progress"];
const doneKey = [...queryKey, "done"];
const path = "/operator/tool-proposals";

export function ToolProposals() {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const proposals = useQuery({
    queryKey,
    enabled: open,
    queryFn: () => apiRequest<{ items: ToolProposal[] }>(path),
  });
  const accepted = useQuery({
    queryKey: acceptedKey,
    enabled: open,
    queryFn: () => apiRequest<{ items: AcceptedProposal[] }>(`${path}/accepted`),
  });
  // TASK-074c-6c: read-only list of rows the user marked in progress. Refreshed by the same prefix as the others.
  const inProgress = useQuery({
    queryKey: inProgressKey,
    enabled: open,
    queryFn: () => apiRequest<{ items: AcceptedProposal[] }>(`${path}/in-progress`),
  });
  // TASK-074c-6h: read-only list of done rows. It shares the queryKey prefix, so check-done's refresh also updates it.
  const done = useQuery({
    queryKey: doneKey,
    enabled: open,
    queryFn: () => apiRequest<{ items: DoneProposal[] }>(`${path}/done`),
  });
  // One prefix covers the open and accepted lists. Every draft settles into a refresh, success or error, since a
  // failed run can already have assigned a number or spent the budget.
  const refresh = () => client.invalidateQueries({ queryKey });
  // TASK-074c-6f: the latest action error. Every action clears it when it starts and sets it when it fails, so an older
  // error never hides a newer one. A live list error still outranks it.
  const [actionError, setActionError] = useState<Error | null>(null);
  const actionFailure = { onMutate: () => setActionError(null), onError: (error: Error) => setActionError(error) };
  const dismiss = useMutation({
    mutationFn: (id: string) => apiRequest(`${path}/${id}/dismiss`, { method: "POST" }),
    onSuccess: refresh,
    ...actionFailure,
  });
  const accept = useMutation({
    mutationFn: (id: string) => apiRequest(`${path}/${id}/accept`, { method: "POST" }),
    onSuccess: refresh,
    ...actionFailure,
  });
  const draft = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) =>
      apiRequest<DraftOutcome>(`${path}/${id}/draft`, { method: "POST" }),
    onSettled: refresh,
    ...actionFailure,
  });
  // The server answers {ok:true} even when nothing changed, so every settle refetches rather than trusting the response.
  const start = useMutation({
    mutationFn: (id: string) => apiRequest(`${path}/${id}/start`, { method: "POST" }),
    onSettled: refresh,
    ...actionFailure,
  });
  // TASK-074c-6f: the task name typed for each in-progress row. A row's entry is cleared only when its own check succeeds.
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  // One mutation for every row. While it is pending every check-done button is disabled, so a second request cannot
  // replace the tracked state before the first one settles.
  const checkDone = useMutation({
    mutationFn: ({ id, task }: { id: string; name: string; task: string }) =>
      apiRequest(`${path}/${id}/check-done`, { method: "POST", body: JSON.stringify({ task }) }),
    onSettled: refresh,
    onSuccess: (_data, variables) => {
      setTaskInputs((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
    },
    ...actionFailure,
  });
  // A single alert slot, so two errors never show at once. The done-list error comes last so it never hides another.
  const alertText = (proposals.error ?? accepted.error ?? actionError ?? inProgress.error ?? done.error)?.message;
  return (
    <section className="panel">
      <h2>Đề xuất công cụ</h2>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>Xem đề xuất chờ xử lý</summary>
        {open && proposals.isPending ? <p>Đang tải đề xuất…</p> : null}
        {alertText ? <p role="alert">{alertText}</p> : null}
        {proposals.data?.items.length === 0 ? <p>Chưa có đề xuất.</p> : null}
        {proposals.data?.items.map((item) => (
          <ProposalRow key={item.id} item={item}>
            <button type="button" className="button" disabled={accept.isPending}
              onClick={() => accept.mutate(item.id)}>Chấp nhận đề xuất</button>
            <button type="button" className="button button-secondary" disabled={dismiss.isPending}
              onClick={() => dismiss.mutate(item.id)}>Bỏ qua đề xuất</button>
          </ProposalRow>
        ))}
        <h3>Đã chấp nhận</h3>
        {open && accepted.isPending ? <p>Đang tải đề xuất đã chấp nhận…</p> : null}
        {accepted.data?.items.length === 0 ? <p>Chưa có đề xuất đã chấp nhận.</p> : null}
        {accepted.data?.items.map((item) => (
          <ProposalRow key={item.id} item={item} label={item.impNumber !== null ? `IMP-${item.impNumber}` : null}>
            {item.draftedAt ? (
              <>
                <p>{DRAFT_MARKER}</p>
                <button type="button" className="button button-secondary" disabled={start.isPending}
                  onClick={() => start.mutate(item.id)}>Đánh dấu đang làm</button>
              </>
            ) : (
              <button type="button" className="button button-secondary" disabled={draft.isPending}
                onClick={() => draft.mutate({ id: item.id, name: item.name })}>Soạn bản nháp</button>
            )}
          </ProposalRow>
        ))}
        <h3>Đang làm</h3>
        {open && inProgress.isPending ? <p>Đang tải đề xuất đang làm…</p> : null}
        {inProgress.data?.items.length === 0 ? <p>Chưa có đề xuất đang làm.</p> : null}
        {inProgress.data?.items.map((item) => {
          const task = (taskInputs[item.id] ?? "").trim();
          return (
            <ProposalRow key={item.id} item={item} label={item.impNumber !== null ? `IMP-${item.impNumber}` : null}>
              <p>{DRAFT_MARKER}</p>
              <input type="text" aria-label={`Tên task cho ${item.name}`} placeholder="Ví dụ: TASK-074c-6e" value={taskInputs[item.id] ?? ""}
                onChange={(event) => setTaskInputs((current) => ({ ...current, [item.id]: event.target.value }))} />
              <button type="button" className="button button-secondary" disabled={checkDone.isPending || task === ""}
                onClick={() => checkDone.mutate({ id: item.id, name: item.name, task })}>Kiểm tra đã xong</button>
            </ProposalRow>
          );
        })}
        {/* TASK-074c-6h: read-only. Rows carry no controls, so nothing here can mutate a proposal. */}
        <section aria-labelledby="done-heading">
          <h3 id="done-heading">Đã xong</h3>
          {open && done.isPending ? <p>Đang tải đề xuất đã xong…</p> : null}
          {done.data?.items.length === 0 ? <p>Chưa có đề xuất đã xong.</p> : null}
          {done.data?.items.map((item) => (
            <ProposalRow key={item.id} item={item} label={doneLabel(item)} />
          ))}
        </section>
        {/* Kept outside the row branch above, so the refetch that hides a draft button does not hide its outcome. */}
        {draft.isPending && draft.variables ? <p><strong>{draft.variables.name}</strong> Đang soạn bản nháp…</p> : null}
        {draft.data && draft.variables ? (
          <p role="status"><strong>{draft.variables.name}</strong> {draftOutcomeText(draft.data)}</p>
        ) : null}
        {/* One text node on purpose, so the whole line matches as a single string. */}
        {checkDone.isSuccess && checkDone.variables ? (
          <p role="status">{`Đã đánh dấu xong: ${checkDone.variables.name} (task ${checkDone.variables.task})`}</p>
        ) : null}
      </details>
    </section>
  );
}

// IMP and task are joined from the parts that exist only, so a row with no task never shows "null".
function doneLabel(item: DoneProposal): string | null {
  const parts = [item.impNumber !== null ? `IMP-${item.impNumber}` : null, item.taskRef].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ProposalRow({ item, label, children }: { item: ToolProposal; label?: string | null; children?: ReactNode }) {
  return (
    <details>
      <summary>{item.name} · {item.kind === "internal" ? "Tool nội bộ" : "MCP bên ngoài"}{label ? ` · ${label}` : ""}</summary>
      <p>{item.operation}</p>
      <dl>
        <dt>Ca tái hiện</dt><dd>{item.reproduction}</dd>
        <dt>Tác động</dt><dd>{item.impact}</dd>
        <dt>Quyền</dt><dd>{item.permissions.join(", ")}</dd>
        <dt>Dữ liệu gửi đi</dt><dd>{item.dataSent}</dd>
        <dt>Xác nhận</dt><dd>{item.requiresConfirmation ? "Cần xác nhận" : "Đề xuất không yêu cầu"}</dd>
        {item.sourceUrl ? <><dt>Nguồn</dt><dd>{item.sourceUrl}</dd></> : null}
        <dt>Schema vào</dt><dd><pre>{JSON.stringify(item.inputSchema, null, 2)}</pre></dd>
        <dt>Schema ra</dt><dd><pre>{JSON.stringify(item.outputSchema, null, 2)}</pre></dd>
        <dt>Tiêu chí kiểm thử</dt><dd><ul>{item.acceptance.map((test, index) => <li key={index}>{test}</li>)}</ul></dd>
      </dl>
      {children}
    </details>
  );
}
