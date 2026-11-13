import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getKnowledgeSettings, saveKnowledgeSettings, testEmbedding } from "../../services/retrievalApi";
import { Button } from "../../components/ui/Button";
const MODELS: Record<string, string[]> = { openai: ["text-embedding-3-small", "text-embedding-3-large"], gemini: ["gemini-embedding-001"], ollama: ["nomic-embed-text", "embeddinggemma"], mock: ["mock-v1"] };
export function EmbeddingRow() {
    const client = useQueryClient();
    const data = useQuery({ queryKey: ["knowledge-settings"], queryFn: getKnowledgeSettings });
    const [provider, setProvider] = useState<string | null>(null), [model, setModel] = useState<string | null>(null);
    const save = useMutation({ mutationFn: saveKnowledgeSettings, onSuccess: () => client.invalidateQueries({ queryKey: ["knowledge-settings"] }) });
    const test = useMutation({ mutationFn: testEmbedding });
    if (data.isPending)
        return <p>Đang tải Embedding…</p>;
    if (data.isError)
        return <p role="alert">Không tải được cấu hình Embedding.</p>;
    const p = provider ?? data.data.settings.embeddingProvider ?? "", m = model ?? data.data.settings.embeddingModel ?? "";
    return <section className="panel"><h3>Embedding</h3>{!data.data.providers.length ? <p>Tìm theo nghĩa cần nhà cung cấp hỗ trợ embedding. Không có thì app vẫn tìm theo từ khoá.</p> : <form onSubmit={e => { e.preventDefault(); save.mutate({ ...data.data.settings, embeddingProvider: p || undefined, embeddingModel: m || undefined }); }}><label>Nhà cung cấp embedding<select aria-label="Nhà cung cấp embedding" value={p} onChange={e => { setProvider(e.target.value); setModel(MODELS[e.target.value]?.[0] ?? ""); }}><option value="">Chỉ từ khoá</option>{data.data.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>{p && <label>Model embedding<input aria-label="Model embedding" list="embedding-models" value={m} onChange={e => setModel(e.target.value)} required/><datalist id="embedding-models">{(MODELS[p] ?? []).map(m => <option key={m} value={m}/>)}</datalist></label>}<Button type="submit" disabled={save.isPending}>Lưu embedding</Button><Button type="button" disabled={!data.data.settings.embeddingProvider || test.isPending} onClick={() => test.mutate()}>Kiểm tra</Button></form>}{save.isSuccess && <p role="status">Đã lưu. Đang lập lại chỉ mục nền.</p>}{test.data && <p role="status">{test.data.ok ? "Embedding hoạt động." : "Embedding chưa sẵn sàng; app dùng từ khoá."}</p>}{(save.isError || test.isError) && <p role="alert">Không thực hiện được.</p>}</section>;
}
