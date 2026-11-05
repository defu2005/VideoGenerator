import { useMemo, useState, type FormEvent } from "react";
import type { ProfileDetail, ProfileTopic } from "@vg/shared";
import { ErrorState } from "../../components/ErrorState";
import { Spinner } from "../../components/Spinner";
import { LoadMore } from "../../components/ui/LoadMore";
import {
  useAddTopic,
  useApproveTopics,
  useReorderTopics,
  useSuggestTopics,
  useTopics,
} from "../../hooks/useAutomation";

export function TopicsTab({ profile }: { profile: ProfileDetail }) {
  const topics = useTopics(profile.id);
  const add = useAddTopic(profile.id);
  const approve = useApproveTopics(profile.id);
  const reorder = useReorderTopics(profile.id);
  const suggest = useSuggestTopics(profile.id);

  const [newTopic, setNewTopic] = useState("");
  const [hint, setHint] = useState("");
  const [count, setCount] = useState(5);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [shown, setShown] = useState(20);

  const items = topics.data?.items ?? [];
  const ordered = useMemo(
    () => [...items].sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt)),
    [items],
  );

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!newTopic.trim()) return;
    setMessage(null);
    try {
      await add.mutateAsync({ topic: newTopic.trim() });
      setNewTopic("");
      setMessage("Đã thêm chủ đề.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thêm được");
    }
  }

  async function onSuggest(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const result = await suggest.mutateAsync({
        hint: hint.trim() || undefined,
        count,
      });
      setMessage(`Đã gợi ý ${result.items.length} chủ đề` + (result.rejectedDuplicates
        ? ` (bỏ ${result.rejectedDuplicates} trùng)`
        : ""));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gợi ý thất bại");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(status: "APPROVED" | "REJECTED") {
    if (selected.size === 0) return;
    await approve.mutateAsync({ ids: [...selected], status });
    setSelected(new Set());
  }

  async function move(topic: ProfileTopic, direction: -1 | 1) {
    const ids = ordered.map((item) => item.id);
    const index = ids.indexOf(topic.id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= ids.length) return;
    const next = [...ids];
    [next[index], next[swap]] = [next[swap]!, next[index]!];
    await reorder.mutateAsync({ orderedIds: next });
  }

  if (topics.isPending) return <Spinner label="Đang tải chủ đề" />;
  if (topics.isError) {
    return (
      <ErrorState
        message={topics.error instanceof Error ? topics.error.message : "Lỗi"}
        onRetry={() => void topics.refetch()}
      />
    );
  }

  return (
    <div className="page-stack">
      <form className="panel form-stack" onSubmit={(event) => void onAdd(event)}>
        <div className="section-heading">
          <div><p className="eyebrow">HÀNG ĐỢI</p><h2>Thêm chủ đề</h2></div>
        </div>
        <label>
          Chủ đề
          <input value={newTopic} onChange={(event) => setNewTopic(event.target.value)} placeholder="Ví dụ: Kim tự tháp Ai Cập" />
        </label>
        <button className="button button-primary" type="submit" disabled={add.isPending || !newTopic.trim()}>
          Thêm
        </button>
      </form>

      <form className="panel form-stack" onSubmit={(event) => void onSuggest(event)}>
        <div className="section-heading">
          <div><p className="eyebrow">AI</p><h2>Gợi ý chủ đề</h2></div>
        </div>
        <label>
          Gợi ý thêm (tuỳ chọn)
          <input value={hint} onChange={(event) => setHint(event.target.value)} placeholder="Ví dụ: thời kỳ La Mã" />
        </label>
        <label>
          Số lượng
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(event) => setCount(Number(event.target.value) || 5)}
          />
        </label>
        <button className="button" type="submit" disabled={suggest.isPending}>
          {suggest.isPending ? "Đang gợi ý…" : "Gợi ý chủ đề"}
        </button>
      </form>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DANH SÁCH</p>
            <h2>Chủ đề ({ordered.length})</h2>
          </div>
          <div className="form-actions">
            <button className="button" type="button" disabled={selected.size === 0 || approve.isPending} onClick={() => void bulk("APPROVED")}>
              Duyệt đã chọn
            </button>
            <button className="button" type="button" disabled={selected.size === 0 || approve.isPending} onClick={() => void bulk("REJECTED")}>
              Từ chối đã chọn
            </button>
          </div>
        </div>
        {message && <p className="form-hint">{message}</p>}
        {ordered.length === 0 ? (
          <p className="page-subtitle">Chưa có chủ đề. Thêm tay hoặc dùng gợi ý AI.</p>
        ) : (
          <div className="topic-queue-list">
            {ordered.slice(0, shown).map((topic) => (
              <div key={topic.id} className="topic-queue-row">
                <input
                  type="checkbox"
                  checked={selected.has(topic.id)}
                  onChange={() => toggle(topic.id)}
                  disabled={topic.status !== "PENDING" && topic.status !== "APPROVED" && topic.status !== "REJECTED"}
                />
                <div className="topic-queue-main">
                  <strong>{topic.topic}</strong>
                  {topic.notes && <small>{topic.notes}</small>}
                  <span className="topic-meta">
                    {topic.status} · {topic.source} · ưu tiên {topic.priority}
                  </span>
                </div>
                <div className="topic-queue-actions">
                  <button type="button" className="text-button" onClick={() => void move(topic, -1)} aria-label="Lên">↑</button>
                  <button type="button" className="text-button" onClick={() => void move(topic, 1)} aria-label="Xuống">↓</button>
                  {topic.status === "PENDING" && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void approve.mutateAsync({ ids: [topic.id], status: "APPROVED" })}
                    >
                      Duyệt
                    </button>
                  )}
                  {(topic.status === "PENDING" || topic.status === "APPROVED") && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void approve.mutateAsync({ ids: [topic.id], status: "REJECTED" })}
                    >
                      Từ chối
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <LoadMore shown={Math.min(shown, ordered.length)} total={ordered.length} onMore={() => setShown((count) => count + 20)} />
      </section>
    </div>
  );
}
