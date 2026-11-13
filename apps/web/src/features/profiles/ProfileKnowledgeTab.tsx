import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { KnowledgeKindSchema } from "@vg/shared";
import { getKnowledgeSettings, getKnowledgeStatus, rebuildKnowledge, saveKnowledgeSettings, searchKnowledge } from "../../services/retrievalApi";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ErrorState";
export const KIND_LABELS: Record<string, string> = { memory: "Ghi nhớ", lesson: "Bài học", guideline: "Định hướng", script: "Kịch bản", research: "Nghiên cứu", result: "Kết quả", comment: "Bình luận", topic: "Chủ đề" };
export function ProfileKnowledgeTab({ profileId }: {
    profileId: string;
}) {
    const client = useQueryClient();
    const [query, setQuery] = useState("");
    const status = useQuery({ queryKey: ["knowledge-status", profileId], queryFn: () => getKnowledgeStatus(profileId), refetchInterval: 5000 });
    const settings = useQuery({ queryKey: ["knowledge-settings"], queryFn: getKnowledgeSettings });
    const rebuild = useMutation({ mutationFn: () => rebuildKnowledge(profileId), onSuccess: () => client.invalidateQueries({ queryKey: ["knowledge-status", profileId] }) });
    const search = useMutation({ mutationFn: () => searchKnowledge(profileId, query) });
    const save = useMutation({ mutationFn: saveKnowledgeSettings, onSuccess: () => client.invalidateQueries({ queryKey: ["knowledge-settings"] }) });
    if (status.isPending || settings.isPending)
        return <p role="status">Đang tải tri thức…</p>;
    if (status.isError || settings.isError)
        return <ErrorState message="Không tải được tri thức" onRetry={() => { void status.refetch(); void settings.refetch(); }}/>;
    const off = settings.data.settings.profiles[profileId]?.kindsOff ?? [];
    return <section className="panel"><h2>Tri thức của kênh</h2>
    <p role="status">{status.data.indexing ? "Đang lập chỉ mục…" : status.data.total + " đoạn đã lập chỉ mục"}</p>
    <p>Embedding: {Math.round(status.data.embeddingCoverage)}% · {status.data.embeddingModel ?? "Chưa chọn model"}</p>
    <p>Lần lập chỉ mục: {status.data.lastIndexedAt ?? "Chưa có"} · {status.data.ftsAvailable ? "Tìm toàn văn" : "Tìm từ khoá dự phòng"}</p>
    {status.data.chunksOverCap > 0 && <p>Đã bỏ {status.data.chunksOverCap} đoạn cũ do giới hạn 20 000 đoạn.</p>}
    <Button disabled={rebuild.isPending} onClick={() => rebuild.mutate()}>Lập lại chỉ mục</Button>
    {rebuild.isSuccess && <p role="status">Đã đưa vào hàng đợi.</p>}
    <fieldset disabled={save.isPending}><legend>Nguồn tri thức</legend>{KnowledgeKindSchema.options.map(kind => <label key={kind} className="checkbox-field"><input type="checkbox" checked={!off.includes(kind) && (kind !== "comment" || settings.data.settings.indexComments)} onChange={e => save.mutate({ ...settings.data.settings, indexComments: kind === "comment" ? e.target.checked : settings.data.settings.indexComments, profiles: { ...settings.data.settings.profiles, [profileId]: { kindsOff: e.target.checked ? off.filter(k => k !== kind) : [...new Set([...off, kind])] } } })}/>{KIND_LABELS[kind]} ({status.data.counts[kind] ?? 0})</label>)}</fieldset>
    <p className="muted">Bình luận mặc định tắt. Khi bật, chỉ lập chỉ mục nội dung, không tên tác giả, tài khoản hoặc mã người dùng; bỏ spam.</p>
    <form onSubmit={e => { e.preventDefault(); search.mutate(); }}><label htmlFor="knowledge-query">Thử tìm</label><input id="knowledge-query" maxLength={300} required value={query} onChange={e => setQuery(e.target.value)}/><Button type="submit" disabled={search.isPending}>Thử tìm</Button></form>
    {[rebuild, search, save].some(m => m.isError) && <p role="alert">Không thực hiện được. Hãy thử lại.</p>}
    {search.data && <p>Tìm bằng: {search.data.mode} · {search.data.matches.length} kết quả</p>}
    {search.data?.matches.map(hit => <article key={hit.chunkId}><span className="badge">{KIND_LABELS[hit.kind]}</span><h3>{hit.title}</h3><p>{hit.text}</p>{hit.projectId ? <Link to={'/projects/' + hit.projectId + '/script'}>Mở nguồn</Link> : <span>Nguồn: {hit.sourceId} · {hit.sourceVersion}</span>}<details><summary>Điểm tìm kiếm</summary><pre className="overflow-x-auto">{JSON.stringify({ score: hit.score, ...hit.breakdown }, null, 2)}</pre></details></article>)}
  </section>;
}
