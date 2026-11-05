import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useProfiles } from "../../hooks/useProfiles";
import {
  bulkSpamComments,
  deleteComment,
  hideComment,
  ignoreComment,
  listComments,
  markCommentRead,
  replyToComment,
  spamComment,
  unhideComment,
  type CommentInboxItem,
  type CommentListQuery,
} from "../../services/commentsApi";

const PLATFORMS = [
  { value: "", label: "Mọi nền tảng" },
  { value: "youtube", label: "YouTube" },
  { value: "instagram_reels", label: "Instagram" },
  { value: "facebook_reels", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
];

const STATUSES = [
  { value: "", label: "Mọi trạng thái" },
  { value: "new", label: "Mới" },
  { value: "read", label: "Đã đọc" },
  { value: "replied", label: "Đã trả lời" },
  { value: "hidden", label: "Đã ẩn" },
  { value: "spam", label: "Spam" },
  { value: "ignored", label: "Bỏ qua" },
];

const CLASSES = [
  { value: "", label: "Mọi loại" },
  { value: "question", label: "Câu hỏi" },
  { value: "praise", label: "Khen" },
  { value: "complaint", label: "Phàn nàn" },
  { value: "request", label: "Yêu cầu" },
  { value: "spam", label: "Spam" },
  { value: "toxic", label: "Độc hại" },
  { value: "other", label: "Khác" },
];

const CLASS_LABEL: Record<string, string> = {
  question: "Câu hỏi",
  praise: "Khen",
  complaint: "Phàn nàn",
  request: "Yêu cầu",
  spam: "Spam",
  toxic: "Độc hại",
  other: "Khác",
};

export function CommentsPage() {
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const [profileId, setProfileId] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [classification, setClassification] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<CommentInboxItem | null>(null);
  const [error, setError] = useState("");

  const filters: CommentListQuery = {
    ...(profileId ? { profileId } : {}),
    ...(platform ? { platform } : {}),
    ...(status ? { status } : {}),
    ...(classification ? { classification } : {}),
  };
  const inbox = useQuery({
    queryKey: ["comments", filters],
    queryFn: () => listComments(filters),
  });

  useEffect(() => {
    const items = inbox.data?.items ?? [];
    setDrafts((current) => {
      const next = { ...current };
      for (const item of items) {
        if (next[item.id] === undefined) next[item.id] = item.suggestedReply ?? "";
      }
      return next;
    });
  }, [inbox.data]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["comments"] });
  }

  const reply = useMutation({
    mutationFn: (item: CommentInboxItem) => replyToComment(item.id, (drafts[item.id] ?? item.suggestedReply ?? "").trim()),
    onSuccess: () => {
      setError("");
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });
  const hide = useMutation({
    mutationFn: (id: string) => hideComment(id),
    onSuccess: () => refresh(),
    onError: (err: Error) => setError(err.message),
  });
  const unhide = useMutation({
    mutationFn: (id: string) => unhideComment(id),
    onSuccess: () => refresh(),
    onError: (err: Error) => setError(err.message),
  });
  const spam = useMutation({
    mutationFn: (id: string) => spamComment(id),
    onSuccess: () => refresh(),
    onError: (err: Error) => setError(err.message),
  });
  const ignore = useMutation({
    mutationFn: (id: string) => ignoreComment(id),
    onSuccess: () => refresh(),
    onError: (err: Error) => setError(err.message),
  });
  const read = useMutation({
    mutationFn: (id: string) => markCommentRead(id),
    onSuccess: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: () => {
      setPendingDelete(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });
  const bulk = useMutation({
    mutationFn: (ids: string[]) => bulkSpamComments(ids),
    onSuccess: () => {
      setSelected({});
      setError("");
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const items = inbox.data?.items ?? [];
  const selectedIds = items.filter((item) => selected[item.id]).map((item) => item.id);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Hộp thư</p>
          <h1>Bình luận</h1>
        </div>
      </div>
      <div className="comment-filters">
        <label>
          Hồ sơ
          <select aria-label="Lọc hồ sơ" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">Mọi hồ sơ</option>
            {(profiles.data?.items ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
        <label>
          Nền tảng
          <select aria-label="Lọc nền tảng" value={platform} onChange={(event) => setPlatform(event.target.value)}>
            {PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Trạng thái
          <select aria-label="Lọc trạng thái" value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Phân loại
          <select aria-label="Lọc phân loại" value={classification} onChange={(event) => setClassification(event.target.value)}>
            {CLASSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={selectedIds.length === 0 || bulk.isPending}
          onClick={() => bulk.mutate(selectedIds)}
        >
          Đánh dấu spam
        </button>
      </div>
      {error && <p className="request-error" role="alert">{error}</p>}
      {(inbox.data?.tiktok ?? []).map((account) => (
        <section key={account.accountId} className="state-card comment-tiktok">
          <h2>{account.displayName}</h2>
          <p>{account.note}</p>
          <ul>
            {account.videos.map((video) => (
              <li key={video.url}>
                <a href={video.url} target="_blank" rel="noreferrer">{video.title}</a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {inbox.isPending ? <p>Đang tải bình luận…</p> : null}
      {inbox.isError ? <p className="request-error" role="alert">Không tải được hộp thư.</p> : null}
      {!inbox.isPending && items.length === 0 ? <p>Chưa có bình luận.</p> : null}
      <ul className="comment-list">
        {items.map((item) => (
          <li key={item.id} className="comment-card">
            <label className="comment-select">
              <input
                type="checkbox"
                aria-label={`Chọn bình luận của ${item.authorName}`}
                checked={Boolean(selected[item.id])}
                onChange={(event) => setSelected((current) => ({ ...current, [item.id]: event.target.checked }))}
              />
            </label>
            <div className="comment-video">
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" className="comment-thumb" />
              ) : (
                <span className="comment-thumb comment-thumb-empty" aria-hidden="true" />
              )}
              <strong>{item.videoTitle}</strong>
            </div>
            <div className="comment-body">
              <p>
                <strong>{item.authorName}</strong>
                {item.classification && (
                  <span className={`comment-badge is-${item.classification}`}>
                    {CLASS_LABEL[item.classification] ?? item.classification}
                  </span>
                )}
              </p>
              <p>{item.text}</p>
              <label className="comment-reply">
                Gợi ý trả lời
                <textarea
                  aria-label={`Trả lời ${item.authorName}`}
                  value={drafts[item.id] ?? ""}
                  maxLength={300}
                  onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                />
              </label>
              <div className="comment-actions">
                <button className="button button-primary" type="button" onClick={() => reply.mutate(item)}>Gửi</button>
                {item.status === "hidden" ? (
                  <button className="button button-secondary" type="button" onClick={() => unhide.mutate(item.id)}>Bỏ ẩn</button>
                ) : (
                  <button className="button button-secondary" type="button" onClick={() => hide.mutate(item.id)}>Ẩn</button>
                )}
                {item.platform === "youtube" && (
                  <button className="button button-secondary" type="button" onClick={() => spam.mutate(item.id)}>Spam</button>
                )}
                <button className="button button-secondary" type="button" onClick={() => ignore.mutate(item.id)}>Bỏ qua</button>
                {item.status === "new" && (
                  <button className="button button-secondary" type="button" onClick={() => read.mutate(item.id)}>Đã đọc</button>
                )}
                {item.platform === "instagram_reels" && (
                  <button className="button button-secondary" type="button" onClick={() => setPendingDelete(item)}>Xóa</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {pendingDelete && (
        <div className="comment-dialog" role="dialog" aria-labelledby="delete-comment-title">
          <h2 id="delete-comment-title">Xóa bình luận Instagram?</h2>
          <p>Bình luận của {pendingDelete.authorName} sẽ bị xóa trên Instagram.</p>
          <div className="comment-actions">
            <button className="button button-secondary" type="button" onClick={() => setPendingDelete(null)}>Hủy</button>
            <button className="button button-primary" type="button" onClick={() => remove.mutate(pendingDelete.id)}>Xác nhận xóa</button>
          </div>
        </div>
      )}
    </div>
  );
}
