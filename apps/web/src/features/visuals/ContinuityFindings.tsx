import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { continuityQueries, type ContinuityReport } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { getScenes } from "../../services/scenesApi";

export function ContinuityFindings({ projectId, revision, disabled, onResearch }: {
  projectId: string; revision: number; disabled: boolean; onResearch: (sceneId: string, query: string) => Promise<unknown>;
}) {
  const query = useQuery({ queryKey: ["continuity", projectId, revision], queryFn: () => apiRequest<ContinuityReport>(`/projects/${projectId}/visuals/continuity`), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function research(sceneId: string) {
    setBusy(true); setError("");
    try {
      const summary = await getScenes(projectId);
      const scene = summary.scenes.find((item) => item.id === sceneId);
      if (!scene) throw new Error("Cảnh đã thay đổi; tải lại danh sách.");
      const queries = continuityQueries(summary.continuity?.plan, sceneId, [scene.visualQueries.primary]);
      await onResearch(sceneId, queries[1] ?? queries[0]);
      await query.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tìm lại được cảnh."); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Kiểm tra liền mạch">
    <h3>Kiểm tra liền mạch</h3>
    {query.isPending ? <p role="status">Đang kiểm tra màu và nhịp…</p> : query.isError ? <p>Chưa tải được kiểm tra liền mạch.</p> : <>
      <p>{query.data.characterReason}</p>
      {query.data.estimatedPacing && <small>Nhịp hiện là ước tính theo cảnh, trước khi có thời lượng shot thực tế.</small>}
      {!query.data.findings?.length ? <p>Chưa phát hiện lệch màu, nhịp hoặc motif.</p> : <ul>{query.data.findings.map((finding, index) => <li key={`${finding.code}-${index}`}>
        <p>{finding.message} {finding.suggestedFix}</p>
        {finding.sceneIds.map((sceneId) => <button type="button" className="button button-secondary" key={sceneId} disabled={disabled || busy} onClick={() => void research(sceneId)}>Tìm lại cảnh này</button>)}
      </li>)}</ul>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
