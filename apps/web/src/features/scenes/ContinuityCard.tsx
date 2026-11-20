import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ContinuityPlanSchema, emptyContinuityPlan, type ContinuityEnvelope, type ContinuityPlan, type Scene } from "@vg/shared";
import { applyRawReviewProposal } from "../../services/reviewApi";
import { sceneKeys } from "../../hooks/useScenes";
import "./continuity.css";

export function ContinuityCard({ projectId, scenes, envelope, disabled = false }: {
  projectId: string; scenes: Scene[]; envelope?: ContinuityEnvelope; disabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<ContinuityPlan>(emptyContinuityPlan);
  const [weight, setWeight] = useState(0.05);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const patch = (value: Partial<ContinuityPlan>) => setPlan((current) => ({ ...current, ...value }));
  const pickScenes = (label: string, selected: string[], onChange: (ids: string[]) => void) => <fieldset>
    <legend>{label}</legend><div className="continuity-scene-picks">{scenes.map((scene) => <label key={scene.id}>
      <input type="checkbox" checked={selected.includes(scene.id)} onChange={(event) => onChange(event.target.checked ? [...selected, scene.id] : selected.filter((id) => id !== scene.id))} />
      {scene.order + 1}. {scene.label}
    </label>)}</div></fieldset>;
  async function save() {
    setBusy(true); setMessage("");
    try {
      const parsed = ContinuityPlanSchema.safeParse(plan);
      if (!parsed.success) throw new Error("Kiểm tra các mô tả, truy vấn, màu #RRGGBB và nhịp 1–60 giây trước khi lưu.");
      await applyRawReviewProposal(projectId, { type: "PATCH_CONTINUITY_PLAN", plan: parsed.data, weight });
      await Promise.all([queryClient.invalidateQueries({ queryKey: sceneKeys.detail(projectId) }),
        queryClient.invalidateQueries({ queryKey: ["pipeline", projectId] }), queryClient.invalidateQueries({ queryKey: ["continuity", projectId] })]);
      setEditing(false); setMessage("Đã lưu định hướng; bước tìm ảnh sẽ cần cập nhật.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không lưu được định hướng."); }
    finally { setBusy(false); }
  }
  return <section className="panel continuity-card" aria-label="Định hướng hình ảnh">
    <div className="continuity-heading"><div><h3>Định hướng hình ảnh</h3>
      <p>Giữ nhân vật, màu sắc và nhịp điệu liền mạch trong cả video.</p></div>
      {!editing && <button type="button" className="button button-secondary" disabled={disabled || !scenes.length} onClick={() => {
        setPlan(structuredClone(envelope?.plan ?? emptyContinuityPlan())); setWeight(envelope?.weight ?? 0.05); setEditing(true); setMessage("");
      }}>Chỉnh định hướng</button>}</div>
    {envelope?.note && <p role="status">{envelope.note}</p>}
    {message && <p role="status">{message}</p>}
    {!editing ? envelope ? <div className="continuity-summary">
      <p>{envelope.plan.characters.length} nhân vật · {envelope.plan.motifs.length} motif · Bảng màu {({ warm: "ấm", neutral: "trung tính", cool: "lạnh" })[envelope.plan.palette.temperature]}</p>
      <p>Nhịp shot: mở đầu {envelope.plan.pacing.hook}s · thân bài {envelope.plan.pacing.body}s · kết {envelope.plan.pacing.outro}s.</p>
      {envelope.plan.characters.map((item) => <p key={item.id}>{item.description} · {item.appearsInScenes.length} cảnh</p>)}
      {envelope.plan.motifs.map((item) => <p key={item.id}>Motif: {item.description} · {item.scenes.length} cảnh</p>)}
    </div> : <p>Chưa có định hướng. Bạn có thể thêm thủ công hoặc bật định hướng tự động trong ngân sách.</p> :
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy || disabled}><legend>Bảng màu và nhịp</legend><div className="continuity-fields">
          <label>Nhiệt độ màu<select value={plan.palette.temperature} onChange={(event) => patch({ palette: { ...plan.palette, temperature: event.target.value as ContinuityPlan["palette"]["temperature"] } })}>
            <option value="warm">Ấm</option><option value="neutral">Trung tính</option><option value="cool">Lạnh</option></select></label>
          <label>Độ bão hòa<select value={plan.palette.saturation} onChange={(event) => patch({ palette: { ...plan.palette, saturation: event.target.value as ContinuityPlan["palette"]["saturation"] } })}>
            <option value="low">Thấp</option><option value="mid">Vừa</option><option value="high">Cao</option></select></label>
          <label>Màu chủ đạo, ngăn bằng dấu phẩy<input value={plan.palette.dominantHues.join(", ")} onChange={(event) => patch({ palette: { ...plan.palette, dominantHues: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} /></label>
          {(["hook", "body", "outro"] as const).map((section) => <label key={section}>{({ hook: "Mở đầu", body: "Thân bài", outro: "Kết" })[section]} · giây/shot
            <input type="number" required min={1} max={60} step={0.1} value={plan.pacing[section]} onChange={(event) => patch({ pacing: { ...plan.pacing, [section]: Number(event.target.value) } })} /></label>)}
          <label>Trọng số continuity (0–0.2)<input type="number" min={0} max={0.2} step={0.01} value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label>
        </div></fieldset>
        <fieldset disabled={busy || disabled}><legend>Nhân vật xuất hiện nhiều cảnh</legend>
          {plan.characters.map((item, index) => <fieldset key={index}><legend>Nhân vật {index + 1}</legend>
            <label>Mô tả<input required maxLength={500} value={item.description} onChange={(event) => patch({ characters: plan.characters.map((current, at) => at === index ? { ...current, description: event.target.value } : current) })} /></label>
            <label>Truy vấn tham chiếu<input required maxLength={500} value={item.referenceQuery} onChange={(event) => patch({ characters: plan.characters.map((current, at) => at === index ? { ...current, referenceQuery: event.target.value } : current) })} /></label>
            {pickScenes("Cảnh có nhân vật", item.appearsInScenes, (ids) => patch({ characters: plan.characters.map((current, at) => at === index ? { ...current, appearsInScenes: ids } : current) }))}
            <button type="button" className="button button-ghost" onClick={() => patch({ characters: plan.characters.filter((_, at) => at !== index) })}>Bỏ nhân vật {index + 1}</button>
          </fieldset>)}
          <button type="button" className="button button-secondary" disabled={plan.characters.length >= 12} onClick={() => patch({ characters: [...plan.characters, { id: crypto.randomUUID(), description: "", referenceQuery: "", appearsInScenes: [] }] })}>Thêm nhân vật</button>
        </fieldset>
        <fieldset disabled={busy || disabled}><legend>Motif lặp lại · tối đa 3</legend>
          {plan.motifs.map((item, index) => <fieldset key={index}><legend>Motif {index + 1}</legend>
            <label>Tag motif<input required value={item.id} onChange={(event) => patch({ motifs: plan.motifs.map((current, at) => at === index ? { ...current, id: event.target.value } : current) })} /></label>
            <label>Mô tả<input required value={item.description} onChange={(event) => patch({ motifs: plan.motifs.map((current, at) => at === index ? { ...current, description: event.target.value } : current) })} /></label>
            {pickScenes("Cảnh có motif", item.scenes, (ids) => patch({ motifs: plan.motifs.map((current, at) => at === index ? { ...current, scenes: ids } : current) }))}
            <button type="button" className="button button-ghost" onClick={() => patch({ motifs: plan.motifs.filter((_, at) => at !== index) })}>Bỏ motif {index + 1}</button>
          </fieldset>)}
          <button type="button" className="button button-secondary" disabled={plan.motifs.length >= 3} onClick={() => patch({ motifs: [...plan.motifs, { id: `motif-${plan.motifs.length + 1}`, description: "", scenes: [] }] })}>Thêm motif</button>
          <label>Tránh, mỗi dòng một ý<textarea value={plan.avoid.join("\n")} onChange={(event) => patch({ avoid: event.target.value.split("\n").filter(Boolean) })} /></label>
        </fieldset>
        <div className="continuity-heading"><button className="button button-primary" disabled={busy || disabled} type="submit">{busy ? "Đang lưu…" : "Lưu định hướng"}</button>
          <button className="button button-secondary" disabled={busy} type="button" onClick={() => setEditing(false)}>Hủy</button></div>
      </form>}
  </section>;
}
