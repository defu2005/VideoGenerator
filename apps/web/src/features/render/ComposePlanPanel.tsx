import { graphicDurationBounds, SHOT_KINDS, type ShotKind } from "@vg/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";

type Shot = { id: string; kind: string; startSec: number; endSec: number; reason: string; locked?: boolean };
type Plan = {
  stats: { shotsPerMin: number; kindShare: { still: number }; beatCutPct: number | null };
  renderEstimate?: { textVi?: string };
  scenes: { sceneId: string; shots: Shot[] }[];
};

const KIND: Record<string, string> = {
  still: "Ảnh tĩnh",
  footage: "Footage",
  kinetic_text: "Chữ động",
  chart: "Biểu đồ",
  map: "Bản đồ",
  compare: "So sánh",
  quote_full: "Câu trích",
  list_full: "Danh sách",
};

function otherKinds(shot: Shot): ShotKind[] {
  const seconds = shot.endSec - shot.startSec;
  return SHOT_KINDS.filter((kind) => {
    if (kind === shot.kind) return false;
    const bounds = graphicDurationBounds(kind);
    if (!bounds) return kind === "still" || kind === "footage";
    return seconds >= bounds.min && seconds <= bounds.max;
  });
}

export function ComposePlanPanel({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["compose-plan", projectId],
    queryFn: async (): Promise<Plan | null> => {
      const response = await fetch(`/api/projects/${projectId}/compose-plan`);
      if (!response.ok) return null;
      const body = await response.json() as Plan;
      if (!body?.stats || !Array.isArray(body.scenes)) return null;
      return body;
    },
  });
  const edit = useMutation({
    mutationFn: (body: { shotId: string; kind?: ShotKind; reroll?: true; locked?: boolean }) => apiRequest<{ ok: boolean }>(
      `/projects/${projectId}/compose-plan/shots/${body.shotId}`,
      { method: "PATCH", body: JSON.stringify({ kind: body.kind, reroll: body.reroll, locked: body.locked }) },
    ),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["compose-plan", projectId] }); },
  });
  const plan = query.data;
  if (!plan) return null;
  const still = Math.round((plan.stats.kindShare?.still ?? 0) * 100);
  const beat = plan.stats.beatCutPct == null ? "chưa có nhịp" : `${Math.round(plan.stats.beatCutPct * 100)}%`;
  return (
    <section aria-label="Cảnh quay">
      <h3>Cảnh quay</h3>
      <p>
        {plan.stats.shotsPerMin.toFixed(1)} cảnh/phút · ảnh tĩnh {still}% · cắt đúng nhịp {beat}
      </p>
      {plan.renderEstimate?.textVi ? <p>{plan.renderEstimate.textVi}</p> : null}
      {edit.error instanceof Error ? <p role="alert">{edit.error.message}</p> : null}
      {plan.scenes.map((scene, index) => (
        <article key={scene.sceneId}>
          <h4>Cảnh {index + 1}</h4>
          <ul>
            {scene.shots.map((shot) => (
              <li key={shot.id}>
                <span>{KIND[shot.kind] ?? shot.kind} · {shot.startSec.toFixed(1)}–{shot.endSec.toFixed(1)}s · {shot.reason}</span>
                {shot.locked ? <span> · đã khoá</span> : null}
                {otherKinds(shot).map((kind) => (
                  <button key={kind} type="button" disabled={edit.isPending} onClick={() => edit.mutate({ shotId: shot.id, kind })}>
                    Đổi kiểu {KIND[kind]}
                  </button>
                ))}
                {shot.kind === "footage" ? (
                  <button type="button" disabled={edit.isPending} onClick={() => edit.mutate({ shotId: shot.id, reroll: true })}>
                    Đổi footage
                  </button>
                ) : null}
                <button type="button" disabled={edit.isPending} onClick={() => edit.mutate({ shotId: shot.id, locked: !shot.locked })}>
                  {shot.locked ? "Bỏ khoá" : "Khoá"}
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
