import type { AssistantMessage, AssistantPendingAction } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { OperatorChat } from "../operator/OperatorChat";
import {
  confirmAllAssistantActions,
  confirmAssistantAction,
  createAssistantConversation,
  getAssistantMessages,
  getAssistantSettings,
  listAssistantConversations,
  rejectAssistantAction,
  sendAssistantMessage,
  updateAssistantSettings,
} from "../../services/assistantApi";

const assistantKeys = {
  conversations: ["assistant", "conversations"] as const,
  messages: (id: string) => ["assistant", "messages", id] as const,
  settings: ["assistant", "settings"] as const,
};

function ToolActivityLine({ summary }: { summary: string }) {
  return (
    <details className="assistant-tool-line">
      <summary>{summary}</summary>
    </details>
  );
}

function MessageBubble({
  message,
  onQuickReply,
  sending,
}: {
  message: AssistantMessage;
  onQuickReply: (text: string) => void;
  sending: boolean;
}) {
  const isUser = message.role === "user";
  const content = message.content ?? { text: "" };
  const clarify = !isUser ? content.clarify : undefined;

  return (
    <article className={`assistant-message assistant-message-${message.role}`}>
      <header>{isUser ? "Bạn" : "Trợ lý"}</header>
      {content.text && <p>{content.text}</p>}
      {!isUser && clarify?.question && (
        <p className="assistant-clarify-question">{clarify.question}</p>
      )}
      {!isUser && clarify?.options && clarify.options.length > 0 && (
        <div className="assistant-quick-replies">
          {clarify.options.map((option) => (
            <button
              key={option}
              type="button"
              className="assistant-chip"
              disabled={sending}
              onClick={() => onQuickReply(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {!isUser && content.toolActivity?.map((item, index) => (
        <ToolActivityLine key={`${item.tool}-${index}`} summary={item.summary} />
      ))}
    </article>
  );
}

function PendingActionCard({
  action,
  busy,
  onConfirm,
  onReject,
}: {
  action: AssistantPendingAction;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <div className="assistant-pending-card" data-action-id={action.id}>
      <p>{action.summary}</p>
      <div className="assistant-pending-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>
          Xác nhận
        </button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onReject}>
          Bỏ qua
        </button>
      </div>
    </div>
  );
}

export function AssistantPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<"assistant" | "operator">("assistant");

  const conversations = useQuery({
    queryKey: assistantKeys.conversations,
    queryFn: () => listAssistantConversations("web"),
  });

  const settings = useQuery({
    queryKey: assistantKeys.settings,
    queryFn: getAssistantSettings,
  });

  const messages = useQuery({
    queryKey: assistantKeys.messages(selectedId ?? ""),
    queryFn: () => getAssistantMessages(selectedId!),
    enabled: Boolean(selectedId),
  });

  const conversationItems = conversations.data?.items ?? [];

  useEffect(() => {
    if (selectedId || conversationItems.length === 0) return;
    setSelectedId(conversationItems[0].id);
  }, [conversationItems, selectedId]);

  const pendingActions = useMemo(
    () => (messages.data?.pendingActions ?? []).filter((item) => item.status === "pending"),
    [messages.data?.pendingActions],
  );

  const refreshThread = async (conversationId: string) => {
    await queryClient.invalidateQueries({ queryKey: assistantKeys.messages(conversationId) });
    await queryClient.invalidateQueries({ queryKey: assistantKeys.conversations });
  };

  const createConversation = useMutation({
    mutationFn: () => createAssistantConversation({ channel: "web" }),
    onSuccess: async (conversation) => {
      setSelectedId(conversation.id);
      setDraft("");
      setError("");
      await queryClient.invalidateQueries({ queryKey: assistantKeys.conversations });
    },
    onError: (reason) => {
      setError(reason instanceof Error ? reason.message : "Không tạo được cuộc trò chuyện");
    },
  });

  const saveSettings = useMutation({
    mutationFn: (confirmMode: "risky" | "auto") => updateAssistantSettings({ confirmMode }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: assistantKeys.settings });
    },
    onError: (reason) => {
      setError(reason instanceof Error ? reason.message : "Không lưu được cài đặt");
    },
  });

  const send = useMutation({
    mutationFn: (text: string) => {
      if (!selectedId) throw new Error("Chưa chọn cuộc trò chuyện");
      return sendAssistantMessage(selectedId, text);
    },
    onSuccess: async () => {
      setDraft("");
      setError("");
      if (selectedId) await refreshThread(selectedId);
    },
    onError: (reason) => {
      const message = reason instanceof Error ? reason.message : "Không gửi được tin nhắn";
      if (/409|đang xử lý|busy/i.test(message)) {
        setError("Đang xử lý tin nhắn trước, thử lại sau.");
        return;
      }
      setError(message);
    },
  });

  const confirmOne = useMutation({
    mutationFn: (actionId: string) => confirmAssistantAction(actionId),
    onSuccess: async () => {
      if (selectedId) await refreshThread(selectedId);
    },
    onError: (reason) => {
      setError(reason instanceof Error ? reason.message : "Không xác nhận được");
    },
  });

  const rejectOne = useMutation({
    mutationFn: (actionId: string) => rejectAssistantAction(actionId),
    onSuccess: async () => {
      if (selectedId) await refreshThread(selectedId);
    },
    onError: (reason) => {
      setError(reason instanceof Error ? reason.message : "Không bỏ qua được");
    },
  });

  const confirmAll = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error("Chưa chọn cuộc trò chuyện");
      return confirmAllAssistantActions(selectedId);
    },
    onSuccess: async () => {
      if (selectedId) await refreshThread(selectedId);
    },
    onError: (reason) => {
      setError(reason instanceof Error ? reason.message : "Không xác nhận tất cả được");
    },
  });

  const actionBusy = confirmOne.isPending || rejectOne.isPending || confirmAll.isPending;

  function submitText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || send.isPending || !selectedId) return;
    setError("");
    send.mutate(trimmed);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submitText(draft);
  }

  if (conversations.isPending || settings.isPending) {
    return <Spinner label="Đang tải trợ lý AI" />;
  }
  if (conversations.isError) {
    return (
      <ErrorState message={conversations.error.message} onRetry={() => void conversations.refetch()} />
    );
  }
  if (settings.isError) {
    return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;
  }

  const threadItems = messages.data?.items ?? [];
  const autoConfirm = settings.data?.confirmMode === "auto";

  return (
    <section className="page-section assistant-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">TRỢ LÝ</p>
          <h1>Trợ lý AI</h1>
          <p>Chat để xem số liệu, chỉnh cài đặt và chạy thao tác trong app (có xác nhận khi cần).</p>
        </div>
        <div className="operator-engine-switch" role="group" aria-label="Chọn người trả lời">
          <button type="button" className="button button-secondary" aria-pressed={engine === "assistant"} onClick={() => setEngine("assistant")}>Trợ lý tích hợp</button>
          <button type="button" className="button button-secondary" aria-pressed={engine === "operator"} onClick={() => setEngine("operator")}>Agent operator</button>
        </div>
        <button
          type="button"
          className="button button-primary"
          disabled={createConversation.isPending || engine === "operator"}
          onClick={() => createConversation.mutate()}
        >
          Cuộc trò chuyện mới
        </button>
      </header>
      {engine === "operator" ? <OperatorChat /> : null}

      {engine === "assistant" && <section className="panel assistant-settings">
        <h2>Cài đặt</h2>
        <label className="field-checkbox">
          <input
            type="checkbox"
            checked={autoConfirm}
            disabled={saveSettings.isPending}
            aria-label="Tự động hết (không hỏi lại, trừ thao tác xóa)"
            onChange={(event) => {
              saveSettings.mutate(event.target.checked ? "auto" : "risky");
            }}
          />
          <span>Tự động hết (không hỏi lại, trừ thao tác xóa)</span>
        </label>
      </section>}

      {engine === "assistant" && <div className="assistant-layout">
        <aside className="panel assistant-conversations" aria-label="Danh sách cuộc trò chuyện">
          <h2>Cuộc trò chuyện</h2>
          {conversationItems.length === 0 && (
            <p className="assistant-empty">Chưa có cuộc trò chuyện. Bấm «Cuộc trò chuyện mới».</p>
          )}
          <ul className="assistant-conversation-list">
            {conversationItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedId ? "assistant-conv-active" : undefined}
                  onClick={() => {
                    setSelectedId(item.id);
                    setDraft("");
                    setError("");
                  }}
                >
                  <span className="assistant-conv-title">{item.title}</span>
                  <span className="assistant-conv-time">
                    {new Date(item.updatedAt).toLocaleString("vi-VN")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel assistant-chat" aria-label="Khung chat">
          {!selectedId && (
            <p className="assistant-empty">Chọn hoặc tạo một cuộc trò chuyện để bắt đầu.</p>
          )}
          {selectedId && messages.isPending && <Spinner label="Đang tải tin nhắn" />}
          {selectedId && messages.isError && (
            <ErrorState message={messages.error.message} onRetry={() => void messages.refetch()} />
          )}
          {selectedId && !messages.isPending && !messages.isError && (
            <>
              {error && <p className="request-error" role="alert">{error}</p>}
              <div className="assistant-messages" aria-live="polite">
                {threadItems.length === 0 && (
                  <p className="assistant-empty">Chưa có tin nhắn. Hãy hỏi trợ lý.</p>
                )}
                {threadItems.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    sending={send.isPending}
                    onQuickReply={submitText}
                  />
                ))}
                {send.isPending && <Spinner label="Đang trả lời" />}
              </div>

              {pendingActions.length > 0 && (
                <div className="assistant-pending-list">
                  <h3>Chờ xác nhận</h3>
                  {pendingActions.map((action) => (
                    <PendingActionCard
                      key={action.id}
                      action={action}
                      busy={actionBusy}
                      onConfirm={() => {
                        setError("");
                        confirmOne.mutate(action.id);
                      }}
                      onReject={() => {
                        setError("");
                        rejectOne.mutate(action.id);
                      }}
                    />
                  ))}
                  {pendingActions.length > 1 && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={actionBusy}
                      onClick={() => {
                        setError("");
                        confirmAll.mutate();
                      }}
                    >
                      Xác nhận tất cả
                    </button>
                  )}
                </div>
              )}

              <form className="assistant-input" onSubmit={onSubmit}>
                <label>
                  Tin nhắn
                  <textarea
                    value={draft}
                    rows={3}
                    maxLength={8000}
                    disabled={send.isPending}
                    placeholder="Ví dụ: Lịch đăng tuần này thế nào?"
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </label>
                <div className="assistant-input-actions">
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={send.isPending || !draft.trim()}
                  >
                    Gửi
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>}
    </section>
  );
}
