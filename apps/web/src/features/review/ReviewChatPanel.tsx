import {
  REVIEW_FULL_CRITIQUE_PROMPT,
  REVIEW_SUGGESTED_CHIPS,
  type PipelineStage,
  type Project,
  type ReviewMessage,
  type ReviewProposal,
} from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { pipelineKeys } from "../../hooks/usePipeline";
import { runPipeline } from "../../services/pipelineApi";
import {
  applyReviewProposal,
  getProjectReview,
  resetProjectReview,
  sendReviewMessage,
} from "../../services/reviewApi";

const reviewKeys = { project: (projectId: string) => ["review", projectId] as const };

function proposalLabel(proposal: ReviewProposal): string {
  switch (proposal.type) {
    case "EDIT_NARRATION": return `Sửa lời kể · ${proposal.sceneId.slice(0, 8)}…`;
    case "EDIT_DURATION": return `Đổi thời lượng · ${proposal.durationSec ?? "tự động"}s`;
    case "EDIT_VISUAL_QUERY": return `Đổi từ khóa ảnh · ${proposal.query}`;
    case "SET_MOTION": return `Đổi chuyển động · ${proposal.motion.type}`;
    case "MUSIC_MIX": return "Chỉnh mix nhạc";
    case "MUSIC_QUERY": return `Đổi tìm nhạc · ${proposal.query}`;
    case "REORDER_SCENES": return "Đổi thứ tự cảnh";
    case "EDIT_METADATA": return "Sửa metadata đăng tải";
    case "NOTE": return "Ghi chú";
    default: return "Đề xuất";
  }
}

function proposalDetail(proposal: ReviewProposal): string {
  switch (proposal.type) {
    case "EDIT_NARRATION": return proposal.text;
    case "EDIT_DURATION": return proposal.durationSec == null ? "Bỏ ghi đè thời lượng" : `${proposal.durationSec} giây`;
    case "EDIT_VISUAL_QUERY": return proposal.query;
    case "SET_MOTION": return JSON.stringify(proposal.motion);
    case "MUSIC_MIX": return [
      proposal.volume === undefined ? null : `volume ${proposal.volume}`,
      proposal.duckingDb === undefined ? null : `ducking ${proposal.duckingDb} dB`,
      proposal.fadeInSec === undefined ? null : `fade in ${proposal.fadeInSec}s`,
      proposal.fadeOutSec === undefined ? null : `fade out ${proposal.fadeOutSec}s`,
    ].filter(Boolean).join(" · ") || "Giữ nguyên";
    case "MUSIC_QUERY": return proposal.query;
    case "REORDER_SCENES": return `${proposal.sceneIds.length} cảnh`;
    case "EDIT_METADATA": return [proposal.title, proposal.description, proposal.tags?.join(", ")].filter(Boolean).join(" · ");
    case "NOTE": return proposal.text;
    default: return "";
  }
}

export function ReviewChatPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [staleStages, setStaleStages] = useState<PipelineStage[]>([]);
  const [applyingKey, setApplyingKey] = useState<string | null>(null);

  const review = useQuery({
    queryKey: reviewKeys.project(project.id),
    queryFn: () => getProjectReview(project.id, draft),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: reviewKeys.project(project.id) });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [draft, open, project.id, queryClient]);

  const onError = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : "Không thực hiện được yêu cầu";
    if (/tiến trình chạy|INVALID_PIPELINE_STATE|job is already active/i.test(message)) {
      setError("Đang có tiến trình chạy, thử lại sau");
      return;
    }
    setError(message);
  };

  const send = useMutation({
    mutationFn: (text: string) => sendReviewMessage(project.id, { text }),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: reviewKeys.project(project.id) });
    },
    onError,
  });

  const applyOne = useMutation({
    mutationFn: ({ messageId, index }: { messageId: string; index: number }) =>
      applyReviewProposal(project.id, messageId, index),
    onSuccess: async (result) => {
      setStaleStages((current) => [...new Set([...current, ...result.staleStages])]);
      await queryClient.invalidateQueries({ queryKey: reviewKeys.project(project.id) });
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    },
    onError,
    onSettled: () => setApplyingKey(null),
  });

  const reset = useMutation({
    mutationFn: () => resetProjectReview(project.id),
    onSuccess: async () => {
      setStaleStages([]);
      await queryClient.invalidateQueries({ queryKey: reviewKeys.project(project.id) });
    },
    onError,
  });

  const rerun = useMutation({
    mutationFn: async () => {
      const stages = staleStages;
      if (stages.includes("VOICE") || stages.includes("SUBTITLE") || stages.includes("TIMELINE")
        || stages.includes("MUSIC_SEARCH") || stages.includes("VISUAL_SEARCH") || stages.includes("VISUAL_REVIEW")) {
        await runPipeline(project.id);
      } else if (stages.length > 0) {
        await runPipeline(project.id, stages[0]);
      }
    },
    onSuccess: async () => {
      setStaleStages([]);
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
    },
    onError,
  });

  const messages: ReviewMessage[] = review.data?.thread?.messages ?? [];
  const estimate = review.data?.estimate;
  const pendingApply = messages.flatMap((message) =>
    (message.proposals ?? [])
      .map((proposal, index) => ({ message, proposal, index }))
      .filter(({ message: item, index, proposal }) =>
        proposal.type !== "NOTE" && !item.appliedIndexes.includes(index)),
  );

  async function applyAll() {
    setError("");
    for (const item of pendingApply) {
      setApplyingKey(`${item.message.id}:${item.index}`);
      try {
        const result = await applyReviewProposal(project.id, item.message.id, item.index);
        setStaleStages((current) => [...new Set([...current, ...result.staleStages])]);
      } catch (reason) {
        onError(reason);
        break;
      }
    }
    setApplyingKey(null);
    await queryClient.invalidateQueries({ queryKey: reviewKeys.project(project.id) });
    await queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(project.id) });
  }

  return (
    <section className="panel review-chat-panel" aria-label="Góp ý với AI">
      <button
        type="button"
        className="review-chat-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <div>
          <p className="eyebrow">GÓP Ý VỚI AI</p>
          <h3>Tùy chọn trước khi render</h3>
          <p>Chat với AI để chỉnh lời kể, nhạc, metadata… Không bắt buộc.</p>
        </div>
        <span>{open ? "Thu gọn" : "Mở"}</span>
      </button>

      {open && (
        <div className="review-chat-body">
          {error && <p className="request-error" role="alert">{error}</p>}
          {review.isPending && <Spinner label="Đang tải góp ý" />}
          {review.isError && <ErrorState message={review.error.message} onRetry={() => void review.refetch()} />}

          {!review.isPending && !review.isError && (
            <>
              <div className="review-chat-quick">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={send.isPending}
                  onClick={() => { setError(""); send.mutate(REVIEW_FULL_CRITIQUE_PROMPT); }}
                >
                  AI xem lại toàn bộ
                </button>
                <div className="review-chat-chips">
                  {REVIEW_SUGGESTED_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="review-chip"
                      disabled={send.isPending}
                      onClick={() => { setError(""); send.mutate(chip); }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="review-chat-messages" aria-live="polite">
                {messages.length === 0 && <p className="review-chat-empty">Chưa có tin nhắn. Hãy hỏi AI hoặc bấm «AI xem lại toàn bộ».</p>}
                {messages.map((message) => (
                  <article key={message.id} className={`review-message review-message-${message.role}`}>
                    <header>{message.role === "user" ? "Bạn" : "AI"}</header>
                    <p>{message.content}</p>
                    {message.proposals && message.proposals.length > 0 && (
                      <ul className="review-proposals">
                        {message.proposals.map((proposal, index) => {
                          const applied = message.appliedIndexes.includes(index);
                          const key = `${message.id}:${index}`;
                          return (
                            <li key={key} className="review-proposal-card">
                              <strong>{proposalLabel(proposal)}</strong>
                              <p>{proposalDetail(proposal)}</p>
                              {proposal.type !== "NOTE" && (
                                <button
                                  type="button"
                                  className="button button-secondary"
                                  disabled={applied || applyingKey === key || applyOne.isPending}
                                  onClick={() => {
                                    setError("");
                                    setApplyingKey(key);
                                    applyOne.mutate({ messageId: message.id, index });
                                  }}
                                >
                                  {applied ? "Đã áp dụng" : "Áp dụng"}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </article>
                ))}
                {send.isPending && <p className="review-chat-pending">Đang trả lời…</p>}
              </div>

              {pendingApply.length > 1 && (
                <button type="button" className="button button-secondary" disabled={Boolean(applyingKey)} onClick={() => void applyAll()}>
                  Áp dụng tất cả
                </button>
              )}

              {staleStages.length > 0 && (
                <div className="review-rerun-banner" role="status">
                  <p>Chạy lại các bước bị ảnh hưởng: {staleStages.join(", ")}</p>
                  <button type="button" className="button button-primary" disabled={rerun.isPending} onClick={() => rerun.mutate()}>
                    Chạy lại
                  </button>
                </div>
              )}

              <form
                className="review-chat-input"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (!text || send.isPending) return;
                  setError("");
                  send.mutate(text);
                }}
              >
                <label>
                  Tin nhắn
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Ví dụ: Mở đầu cuốn hơn…"
                  />
                </label>
                <div className="review-chat-input-actions">
                  <span className="review-token-estimate">
                    Ước tính ≈ {estimate?.inputTokens ?? "…"} vào / {estimate?.outputTokens ?? "…"} ra
                  </span>
                  <button type="button" className="button button-secondary" disabled={reset.isPending || !review.data?.thread} onClick={() => reset.mutate()}>
                    Bắt đầu cuộc trò chuyện mới
                  </button>
                  <button type="submit" className="button button-primary" disabled={send.isPending || !draft.trim()}>
                    Gửi
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}
