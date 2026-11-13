import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { apiRequest } from "../../services/apiClient";

export function ProfileMemoryTab({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["profile", profileId, "memory"];
  const path = `/operator/profiles/${profileId}/memory`;
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const memory = useQuery({
    queryKey,
    queryFn: () => apiRequest<{ items: Array<{ id: string; text: string; version: number }> }>(path),
  });
  const save = useMutation({
    mutationFn: () => apiRequest(editing ? `${path}/${editing}` : path, {
      method: editing ? "PUT" : "POST", body: JSON.stringify({ text }),
    }),
    onSuccess: async () => {
      setText("");
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`${path}/${id}`, { method: "DELETE" }),
    onSuccess: async (_result, id) => {
      if (editing === id) {
        setEditing(null);
        setText("");
      }
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const busy = save.isPending || remove.isPending;

  return (
    <section className="panel">
      <h2>Ghi nhớ của hồ sơ</h2>
      <p>Agent có thể tra cứu các ghi nhớ bạn lưu khi làm việc với hồ sơ này.</p>
      <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <label>
          Nội dung ghi nhớ
          <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} required disabled={busy} />
        </label>
        <button type="submit" className="button" disabled={busy || !text.trim()}>{editing ? "Lưu chỉnh sửa" : "Thêm ghi nhớ"}</button>
        {editing && <button type="button" className="button button-secondary" disabled={busy} onClick={() => {
          setEditing(null);
          setText("");
        }}>Hủy chỉnh sửa</button>}
      </form>
      {memory.isPending && <p>Đang tải ghi nhớ…</p>}
      {(memory.error ?? save.error ?? remove.error) && <p role="alert">{(memory.error ?? save.error ?? remove.error)?.message}</p>}
      {memory.data?.items.length === 0 && <p>Chưa có ghi nhớ.</p>}
      <ul>
        {memory.data?.items.map((item) => (
          <li key={item.id}>
            <p style={{ whiteSpace: "pre-wrap" }}>{item.text}</p>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => {
              setEditing(item.id);
              setText(item.text);
            }}>Sửa</button>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => setDeleting(item.id)}>Xóa</button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title="Xóa ghi nhớ?"
        message="Agent sẽ không tìm thấy ghi nhớ này trong hồ sơ nữa."
        confirmLabel="Xóa ghi nhớ"
        cancelLabel="Giữ lại"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(null);
        }}
      />
    </section>
  );
}
