import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { excludeKnowledge, getKnowledgeUses } from "../../services/retrievalApi";
export function KnowledgeUsesPanel({ projectId, tasks }: {
    projectId: string;
    tasks: string[];
}) {
    const client = useQueryClient();
    const [changed, setChanged] = useState(false);
    const uses = useQuery({ queryKey: ["knowledge-uses", projectId], queryFn: () => getKnowledgeUses(projectId), refetchInterval: 5000 });
    const update = useMutation({ mutationFn: ({ id, excluded }: {
            id: number;
            excluded: boolean;
        }) => excludeKnowledge(projectId, id, excluded), onSuccess: () => { setChanged(true); return client.invalidateQueries({ queryKey: ["knowledge-uses", projectId] }); } });
    const chunks = [...new Map((uses.data?.uses ?? []).filter(u => tasks.includes(u.task_id)).flatMap(u => u.chunks).map(c => [c.chunkId, c])).values()];
    return <details className="panel"><summary>Ngữ cảnh đã dùng ({chunks.length})</summary>{uses.isPending && <p>Đang tải…</p>}{uses.isError && <p role="alert">Không tải được ngữ cảnh.</p>}{!chunks.length && !uses.isPending && <p>Chưa dùng đoạn tri thức nào.</p>}{chunks.map(c => <article key={c.chunkId}><h3>{c.title}</h3><p>{c.text}</p><button type="button" disabled={update.isPending} onClick={() => update.mutate({ id: c.chunkId, excluded: !c.excluded })}>{c.excluded ? "Dùng lại" : "Bỏ đoạn này"}</button></article>)}{changed && <p role="status">Chạy lại bước này để áp dụng.</p>}{update.isError && <p role="alert">Không lưu được thay đổi.</p>}</details>;
}
