import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Project, TranslationView } from "@vg/shared";
import { apiRequest } from "../../services/apiClient";

export function TranslationPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: ["translations", project.id],
    queryFn: () => apiRequest<TranslationView>(`/projects/${project.id}/translations`),
    enabled: project.status === "COMPLETED" && project.kind !== "clip",
  });
  const start = useMutation({
    mutationFn: (language: string) => apiRequest(`/projects/${project.id}/translations`, {
      method: "POST",
      body: JSON.stringify({ language }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["translations", project.id] });
    },
  });

  if (project.status !== "COMPLETED" || project.kind === "clip") return null;
  const data = view.data;

  return (
    <section className="panel overview-card" aria-label="Bản dịch">
      <p className="eyebrow">LANGUAGES</p>
      <h2>Bản dịch</h2>
      {view.isPending && <p>Đang tải bản dịch…</p>}
      {view.isError && <p>{view.error instanceof Error ? view.error.message : "Không tải được bản dịch"}</p>}
      {data && data.targets.length === 0 && <p>Chưa cấu hình ngôn ngữ trên hồ sơ.</p>}
      {data?.targets.map((target) => (
        <div key={target.language}>
          <p>{target.language} · {target.mode === "dub" ? "Lồng tiếng" : "Chỉ phụ đề"}</p>
          <button className="button button-primary" type="button" disabled={start.isPending} onClick={() => start.mutate(target.language)}>
            Tạo bản dịch
          </button>
        </div>
      ))}
      {data && data.children.length > 0 && (
        <ul>
          {data.children.map((child) => (
            <li key={child.id}>
              <Link to={`/projects/${child.id}/overview`}>{child.title}</Link>
              <span> · {child.status}{child.waitingReview ? " · chờ duyệt" : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {data?.review && (
        <div>
          <h3>Duyệt bản dịch</h3>
          <ul>
            {data.review.scenes.map((scene) => (
              <li key={scene.id}>
                <p>{scene.original}</p>
                <p>{scene.translated}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data && data.youtubeHints.length > 0 && (
        <ul>
          {data.youtubeHints.map((hint) => <li key={hint}>{hint}</li>)}
        </ul>
      )}
      {start.isError && <p>{start.error instanceof Error ? start.error.message : "Không tạo được bản dịch"}</p>}
    </section>
  );
}
