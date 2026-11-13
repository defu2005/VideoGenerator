import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORIGINALITY_CHECKLIST, type OriginalityReport } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";
import { dismissGuidelineFinding } from "../../services/guidelinesApi";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const kindLabel = { own_template: "Đồ hoạ riêng", stock: "Stock", web: "Ảnh web", ai_generated: "Ảnh AI", user_upload: "Bạn tải lên", third_party_footage: "Footage bên thứ ba" };
export function OriginalityCard({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const key = ["originality", projectId];
  const report = useQuery({ queryKey: key, queryFn: () => apiRequest<OriginalityReport>(`/projects/${projectId}/originality`) });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const recheck = useMutation({
    mutationFn: () => apiRequest<OriginalityReport>(`/projects/${projectId}/originality/recheck`, { method: "POST" }),
    onSuccess: (data) => { client.setQueryData(key, data); void client.invalidateQueries({ queryKey: ["operator-requests"] }); },
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => dismissGuidelineFinding(projectId, id, reasons[id]?.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["operator-requests"] });
      void client.invalidateQueries({ queryKey: ["guideline-findings", projectId] });
    },
  });
  const data = report.data;
  const manifest = data?.manifest;
  return <section className="panel originality-card" aria-label="Nguồn & tính nguyên bản">
    <h3>Nguồn &amp; tính nguyên bản</h3>
    <p className="field-hint">Ngưỡng nội bộ, không phải chứng nhận bản quyền hay điều kiện kiếm tiền của nền tảng.</p>
    {report.isPending && <p role="status">Đang tải bản kê nguồn…</p>}
    {report.isError && <p role="alert">Không tải được báo cáo. <button type="button" onClick={() => void report.refetch()}>Thử lại</button></p>}
    {(recheck.isError || dismiss.isError) && <p role="alert" className="request-error">{recheck.error?.message ?? dismiss.error?.message}</p>}
    <button type="button" className="secondary-button" disabled={recheck.isPending || dismiss.isPending} onClick={() => recheck.mutate()}>
      {recheck.isPending ? "Đang kiểm tra…" : "Kiểm tra lại tính nguyên bản"}
    </button>
    {data && <>
      <p role="status"><strong>{manifest ? data.verdict === "OK" ? "Đã kiểm tra — không còn cảnh báo mở" : "Cần bạn kiểm tra — chưa tự đăng công khai" : "Chưa có bản kê — dựng timeline hoặc kiểm tra lại"}</strong></p>
      {manifest && <>
        <p>Đóng góp riêng có bằng chứng: <strong>{percent(manifest.contribution.ownShare)}</strong> · AI: {percent(manifest.contribution.aiGeneratedShare)} · {manifest.contribution.thirdPartySourceCount} nguồn bên thứ ba.</p>
        <p>{manifest.script.narrationWordCount} từ lời dẫn · {manifest.voice.map((v) => `${v.provider}/${v.voice}`).filter((v, i, all) => all.indexOf(v) === i).join(", ") || "Chưa có giọng đọc"}.</p>
        {data.scores?.script && <p>Kịch bản giống nhất: <a href={`/projects/${data.scores.script.projectId}/script`}>{data.scores.script.title}</a> ({percent(data.scores.script.similarity)}).</p>}
        <p>Ảnh tái sử dụng: {data.scores?.reusedImages ?? 0} · Đã so {data.scores?.comparedProjects ?? 0} video cùng hồ sơ.</p>
        {data.scores?.title && <p>Tiêu đề giống nhất: <a href={`/projects/${data.scores.title.projectId}/metadata`}>{data.scores.title.title}</a> ({percent(data.scores.title.similarity)}).</p>}
        <details><summary>Nguồn nghiên cứu ({manifest.script.sources.length})</summary><ul>{manifest.script.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></details>
        <details><summary>Asset &amp; giấy phép ({manifest.assets.length})</summary><ul>{manifest.assets.map((a, i) => <li key={`${a.assetId}:${i}`}>
          {kindLabel[a.kind]} · {a.screenSeconds.toFixed(1)} giây · {a.license?.name ?? (a.kind === "own_template" ? "App tự tạo" : "Chưa rõ giấy phép")} · {a.licenseVerified ? "Có bằng chứng" : "Chưa xác minh"}
          {a.sourceUrl && <> · <a href={a.sourceUrl} target="_blank" rel="noreferrer">Nguồn</a></>}
          {a.license?.url && <> · <a href={a.license.url} target="_blank" rel="noreferrer">Giấy phép</a></>}
        </li>)}</ul></details>
      </>}
      {(Array.isArray(data.findings) ? data.findings : []).filter((f) => f.status === "OPEN").map((f) => <form key={f.id} onSubmit={(e) => { e.preventDefault(); dismiss.mutate(f.id); }}>
        <p><strong>Cần duyệt:</strong> {f.text}</p>
        <label className="form-field"><span>Lý do bỏ qua cảnh báo</span><input required maxLength={300} value={reasons[f.id] ?? ""}
          onChange={(e) => setReasons({ ...reasons, [f.id]: e.target.value })} /></label>
        <button type="submit" className="text-button" disabled={dismiss.isPending || recheck.isPending || !reasons[f.id]?.trim()}>Đã tự duyệt, bỏ qua kèm lý do</button>
      </form>)}
      {!!manifest?.history.length && <details><summary>Lịch sử bỏ qua ({manifest.history.length})</summary><ul>{manifest.history.map((h) => <li key={h.findingId}>{h.at} · {h.ruleId}: {h.reason}</li>)}</ul></details>}
    </>}
    <details><summary>Checklist theo nền tảng (chỉ nhắc nhở)</summary><ul>{ORIGINALITY_CHECKLIST.map((item) => <li key={item.platform}><strong>{item.platform}:</strong> {item.text} <a href={item.url} target="_blank" rel="noreferrer">Chính sách</a></li>)}</ul></details>
  </section>;
}
