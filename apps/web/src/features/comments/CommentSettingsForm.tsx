import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentSettings } from "@vg/shared";
import { getCommentSettings, saveCommentSettings } from "../../services/commentsApi";

const EMPTY: CommentSettings = {
  mode: "off",
  repliesPerVideoPerDay: 10,
  repliesPerAccountPerDay: 30,
  tone: "thân thiện",
  emoji: false,
  signature: "",
  spamPhrases: [],
};

export function CommentSettingsForm({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["comment-settings", profileId],
    queryFn: () => getCommentSettings(profileId),
  });
  const [form, setForm] = useState<CommentSettings>(EMPTY);
  const [phrases, setPhrases] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!settings.data) return;
    setForm(settings.data);
    setPhrases(settings.data.spamPhrases.join("\n"));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => saveCommentSettings(profileId, {
      ...form,
      spamPhrases: phrases.split("\n").map((line) => line.trim()).filter(Boolean),
    }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["comment-settings", profileId], saved);
      setMessage("Đã lưu cài đặt bình luận.");
    },
    onError: (error: Error) => setMessage(error.message),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  if (settings.isPending) return <p>Đang tải cài đặt bình luận…</p>;
  if (settings.isError) return <p className="request-error" role="alert">Không tải được cài đặt bình luận.</p>;

  return (
    <form className="page-stack" onSubmit={onSubmit}>
      <h2>Bình luận</h2>
      <label>
        Chế độ
        <select
          aria-label="Chế độ bình luận"
          value={form.mode}
          onChange={(event) => setForm({ ...form, mode: event.target.value as CommentSettings["mode"] })}
        >
          <option value="off">Tắt</option>
          <option value="hide_spam">Tự ẩn spam và bình luận độc hại</option>
          <option value="auto_reply">Tự ẩn và trả lời khen / câu hỏi đơn giản</option>
        </select>
      </label>
      <label>
        Số trả lời tối đa mỗi video mỗi ngày
        <input
          aria-label="Giới hạn mỗi video"
          type="number"
          min={0}
          max={100}
          value={form.repliesPerVideoPerDay}
          onChange={(event) => setForm({ ...form, repliesPerVideoPerDay: Number(event.target.value) })}
        />
      </label>
      <label>
        Số trả lời tối đa mỗi tài khoản mỗi ngày
        <input
          aria-label="Giới hạn mỗi tài khoản"
          type="number"
          min={0}
          max={500}
          value={form.repliesPerAccountPerDay}
          onChange={(event) => setForm({ ...form, repliesPerAccountPerDay: Number(event.target.value) })}
        />
      </label>
      <label>
        Giọng
        <select
          aria-label="Giọng trả lời"
          value={form.tone}
          onChange={(event) => setForm({ ...form, tone: event.target.value as CommentSettings["tone"] })}
        >
          <option value="thân thiện">Thân thiện</option>
          <option value="chuyên nghiệp">Chuyên nghiệp</option>
          <option value="hài hước">Hài hước</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.emoji}
          onChange={(event) => setForm({ ...form, emoji: event.target.checked })}
        />
        {" "}Dùng emoji
      </label>
      <label>
        Chữ ký
        <input
          aria-label="Chữ ký bình luận"
          value={form.signature}
          maxLength={80}
          onChange={(event) => setForm({ ...form, signature: event.target.value })}
        />
      </label>
      <label>
        Cụm spam (mỗi dòng một cụm)
        <textarea
          aria-label="Danh sách cụm spam"
          value={phrases}
          onChange={(event) => setPhrases(event.target.value)}
        />
      </label>
      <button className="button button-primary" type="submit" disabled={save.isPending}>Lưu</button>
      {message && <p>{message}</p>}
    </form>
  );
}
