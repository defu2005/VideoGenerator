import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";
import { Spinner } from "../../components/Spinner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useToast } from "../../components/ui/Toast";

// TASK-129a step 6 (UI): the user reads every agent thread of the workspace and posts into one.
// Bodies render as plain text nodes only (pre-wrap), never as markup.
const MAX_BYTES = 8192;
const threadsKey = ["operator", "fleet", "threads"] as const;

type ThreadSummary = { threadId: string; messages: number; lastAt: string; lastFrom: string; lastKind: string; projectId: string | null };
type ThreadMessage = { id: string; fromInstance: string; toKind: string; toValue: string; kind: string; body: string; createdAt: string; ackedAt: string | null };

const KIND_LABEL: Record<string, string> = { directive: "chỉ thị", report: "báo cáo", question: "câu hỏi", answer: "trả lời", handoff: "bàn giao" };
const when = (iso: string) => new Date(iso).toLocaleString("vi-VN");

/** Recipient choices for a reply: instances that spoke in the thread or were addressed in it, then the duty holder. */
function recipientOptions(messages: ThreadMessage[]): string[] {
  const set = new Set<string>();
  for (const m of messages) {
    if (m.fromInstance !== "user") set.add(m.fromInstance);
    if (m.toKind === "instance") set.add(m.toValue);
  }
  set.delete("user");
  set.add("duty");
  return [...set];
}

/** Default recipient: the latest agent that spoke in the thread, else duty. */
function defaultRecipient(messages: ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].fromInstance !== "user") return messages[i].fromInstance;
  return "duty";
}

function ThreadView({ threadId }: { threadId: string }) {
  const toast = useToast();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: [...threadsKey, threadId],
    queryFn: () => apiRequest<{ messages: ThreadMessage[] }>(`/operator/fleet/threads/${encodeURIComponent(threadId)}`),
    refetchInterval: 15_000, refetchIntervalInBackground: false,
  });
  const messages = detail.data?.messages ?? [];
  const options = recipientOptions(messages);
  const recipient = to && options.includes(to) ? to : defaultRecipient(messages);
  const bytes = new TextEncoder().encode(draft).length;
  const tooLong = bytes > MAX_BYTES;
  const post = useMutation({
    mutationFn: () => apiRequest<{ message: { kind: string } }>(`/operator/fleet/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST", body: JSON.stringify({ to: recipient, body: draft }),
    }),
    onSuccess: ({ message }) => {
      setDraft("");
      // Show the kind the server stored, not the one the user asked for.
      if (message.kind === "question") toast.success("Chưa có agent nhận đích này; tin đã lưu thành câu hỏi.");
      else toast.success(`Đã gửi ${KIND_LABEL[message.kind] ?? message.kind}.`);
      void client.invalidateQueries({ queryKey: threadsKey });
    },
  });
  if (detail.isPending) return <Spinner label="Đang tải chuỗi tin" />;
  if (detail.isError) return <p role="alert">{detail.error.message}</p>;
  return <div className="form-stack">
    {messages.length === 0 ? <p>Chuỗi này chưa có tin.</p> : <ol className="plain-list">{messages.map((m) => <li key={m.id}>
      <p className="muted">{m.fromInstance} → {m.toValue} · {KIND_LABEL[m.kind] ?? m.kind} · {when(m.createdAt)}{m.ackedAt ? " · đã xác nhận" : ""}</p>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.body}</p>
    </li>)}</ol>}
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (!draft.trim() || tooLong) return; post.mutate(); }}>
      <label>Gửi tới
        <select value={recipient} onChange={(e) => setTo(e.target.value)}>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>Nội dung
        <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <p className={tooLong ? "error" : "muted"}>{bytes.toLocaleString("vi-VN")} / {MAX_BYTES.toLocaleString("vi-VN")} byte{tooLong ? " — quá 8 KB, hãy rút ngắn" : ""}</p>
      {post.error ? <p role="alert">{post.error.message}</p> : null}
      <div><Button type="submit" loading={post.isPending} disabled={!draft.trim() || tooLong}>Gửi vào chuỗi</Button></div>
    </form>
  </div>;
}

export function FleetThreads() {
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: threadsKey,
    queryFn: () => apiRequest<{ threads: ThreadSummary[] }>("/operator/fleet/threads"),
    refetchInterval: 15_000, refetchIntervalInBackground: false,
  });
  if (list.isPending) return <Spinner label="Đang tải chuỗi tin agent" />;
  if (list.isError) return <p role="alert">{list.error.message}</p>;
  const threads = list.data.threads ?? [];
  return <Card title="Chuỗi tin giữa agent">
    <p>Mọi chuỗi của workspace. Tin bạn gửi là chỉ thị từ cấp cao nhất, trừ khi đích chưa có ai giữ (khi đó thành câu hỏi).</p>
    {threads.length === 0 ? <p>Chưa có chuỗi tin nào.</p> : <ul className="plain-list">{threads.map((t) => <li key={t.threadId}>
      <Button variant={selected === t.threadId ? "primary" : "secondary"} onClick={() => setSelected(t.threadId)}>
        {t.lastFrom} · {t.messages} tin · {when(t.lastAt)}
      </Button>
    </li>)}</ul>}
    {selected ? <ThreadView key={selected} threadId={selected} /> : null}
  </Card>;
}
