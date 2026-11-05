import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { confirmAssistantAction, rejectAssistantAction } from "../../services/assistantApi";
import {
  getOperatorMessages,
  getOperatorOverview,
  newOperatorSession,
  sendOperatorMessage,
  stopOperator,
} from "../../services/operatorApi";

const keys = {
  overview: ["operator", "overview"] as const,
  messages: (id: string) => ["operator", "messages", id] as const,
};

export function OperatorChat() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const overview = useQuery({
    queryKey: keys.overview,
    queryFn: getOperatorOverview,
    refetchInterval: (query) => (query.state.data?.activeRunId || (query.state.data?.queue.length ?? 0) > 0 ? 1000 : false),
  });
  const conversationId = overview.data?.conversationId ?? "";
  const messages = useQuery({
    queryKey: keys.messages(conversationId),
    queryFn: () => getOperatorMessages(conversationId),
    enabled: Boolean(conversationId),
    refetchInterval: overview.data?.activeRunId ? 1000 : false,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: keys.overview });
    if (conversationId) await queryClient.invalidateQueries({ queryKey: keys.messages(conversationId) });
  }

  const send = useMutation({
    mutationFn: (text: string) => sendOperatorMessage(conversationId, text),
    onSuccess: async () => {
      setDraft("");
      await refresh();
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Không gửi được"),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId) return;
    setError("");
    send.mutate(text);
  }

  const active = overview.data?.runs.find((run) => run.id === overview.data?.activeRunId);

  return (
    <section className="panel operator-chat" aria-label="Chat Cursor operator">
      <div className="operator-chat-toolbar">
        <button type="button" className="button button-secondary" onClick={() => void stopOperator(conversationId).then(refresh)} disabled={!conversationId}>
          Dừng
        </button>
        <button type="button" className="button button-secondary" onClick={() => void newOperatorSession(conversationId).then(refresh)} disabled={!conversationId}>
          Phiên mới
        </button>
      </div>
      {error && <p className="request-error" role="alert">{error}</p>}
      {overview.data?.queue.length ? (
        <p className="assistant-empty">Đang chờ: {overview.data.queue.map((item) => `vị trí ${item.position}`).join(", ")}</p>
      ) : null}
      <div className="assistant-messages" aria-live="polite">
        {(messages.data?.messages ?? []).map((message) => (
          <article key={message.id} className={`assistant-message assistant-message-${message.role}`}>
            <header>{message.role === "user" ? "Bạn" : "Operator"}</header>
            <p>{message.text}</p>
          </article>
        ))}
        {active?.partialText && <p className="assistant-empty">{active.partialText}</p>}
        {active?.toolChips.map((chip) => (
          <p key={chip} className="operator-chip">đang gọi: {chip}</p>
        ))}
      </div>
      <div className="assistant-pending-list">
        {(overview.data?.pending ?? []).map((action) => (
          <article key={action.id} className="assistant-pending-card">
            <p>{action.summary}</p>
            <div className="assistant-pending-actions">
              <button type="button" className="button button-primary" onClick={() => void confirmAssistantAction(action.id).then(refresh)}>Duyệt</button>
              <button type="button" className="button button-secondary" onClick={() => void rejectAssistantAction(action.id).then(refresh)}>Từ chối</button>
            </div>
          </article>
        ))}
      </div>
      <form className="assistant-input" onSubmit={onSubmit}>
        <textarea aria-label="Nhắn Cursor operator" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} />
        <div className="assistant-input-actions">
          <button type="submit" className="button button-primary" disabled={send.isPending || !conversationId}>Gửi</button>
        </div>
      </form>
    </section>
  );
}
