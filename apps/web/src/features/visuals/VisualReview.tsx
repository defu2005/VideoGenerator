import { isWebImageProvider, type Project, type ProjectVisuals, type SceneVisualStatus, type SceneVisuals, type VisualCandidate } from "@vg/shared";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useConfirm } from "../../components/useConfirm";
import { ErrorState } from "../../components/ErrorState";
import { useToast } from "../../components/ui/Toast";
import { Spinner } from "../../components/Spinner";
import { pipelineKeys, usePipeline } from "../../hooks/usePipeline";
import { stageBlocked } from "../pipeline/activeJobs";
import { visualKeys, useVisuals } from "../../hooks/useVisuals";
import { approvePipelineGate } from "../../services/pipelineApi";
import {
  addCustomSceneVisual,
  approveAllSceneVisuals,
  approveSceneVisual,
  editSceneVisualQuery,
  getSceneVisuals,
  localVisualFileUrl,
  rejectSceneVisual,
  removeSceneVisual,
  searchSceneVisuals,
  selectSceneVisual,
  uploadSceneVisual,
  visionCheckCandidate,
  webSearchSceneVisuals,
} from "../../services/visualsApi";
import { sceneTimecode } from "../scenes/SceneCard";

type Filter = "all" | "review" | "low" | "reused" | "none" | "approved";
type VisualAction =
  | { type: "approve"; sceneId: string }
  | { type: "reject"; sceneId: string }
  | { type: "remove"; sceneId: string }
  | { type: "select"; sceneId: string; candidateId: string }
  | { type: "search"; sceneId: string; query: string }
  | { type: "url"; sceneId: string; url: string; title?: string; author?: string; license?: string }
  | { type: "upload"; sceneId: string; file: File }
  | { type: "query"; sceneId: string; visualQueries: { primary: string; alternatives: string[] }; visualDescription: string };
type VisualMutationContext = {
  previousVisuals: ProjectVisuals | undefined;
  previousActiveVisuals: SceneVisuals | null;
};

const attentionNames: Record<string, string> = {
  lowRelevance: "ảnh lệch chủ đề",
  vision_reject: "AI nhìn loại ảnh",
  vision_missing: "chưa có kết quả AI nhìn",
  invalid_source: "ảnh nguồn không dùng được",
  no_candidate: "không có ảnh đúng",
  source_risk: "nguồn rủi ro cao",
};

function attentionText(reason: string | null | undefined, fallback?: string): string {
  if (reason && attentionNames[reason]) return attentionNames[reason];
  return fallback || "chưa có ảnh đúng chủ đề";
}

const statuses: SceneVisualStatus[] = ["NO_VISUAL", "SEARCHING", "REVIEW_REQUIRED", "NEEDS_ATTENTION", "APPROVED", "READY_FOR_RENDER", "SKIPPED"];
const statusNames: Record<SceneVisualStatus, string> = {
  NO_VISUAL: "Chưa có ảnh",
  SEARCHING: "Đang tìm",
  REVIEW_REQUIRED: "Cần xem",
  NEEDS_ATTENTION: "Cần bạn",
  APPROVED: "Đã duyệt",
  READY_FOR_RENDER: "Sẵn sàng render",
  SKIPPED: "Không dùng ảnh",
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function licenseBadge(candidate: VisualCandidate): string {
  if (isWebImageProvider(candidate.provider) && candidate.licenseVerified === false) {
    return "Chưa xác minh license";
  }
  if (candidate.license.kind === "UNKNOWN") return "License chưa rõ";
  if (candidate.license.kind.includes("NC")) return "Phi thương mại";
  if (candidate.license.attributionRequired) return "Attribution required";
  return candidate.license.kind;
}

function providerBadge(candidate: VisualCandidate): string {
  if (candidate.provider === "brave" || candidate.provider === "web-grounding") return "Web";
  return candidate.provider;
}

function imageUrl(projectId: string, candidate: VisualCandidate | null): string | undefined {
  if (!candidate) return undefined;
  return candidate.localPath
    ? localVisualFileUrl(projectId, candidate.localPath)
    : candidate.previewUrl;
}

export function VisualReview({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const visualsQuery = useVisuals(project.id);
  const pipeline = usePipeline(project.id);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const [activeVisuals, setActiveVisuals] = useState<SceneVisuals | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [license, setLicense] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const { ask, dialog: visionDialog } = useConfirm();
  const [page, setPage] = useState(0);
  const [candidateLimit, setCandidateLimit] = useState(8);
  const [approvingAll, setApprovingAll] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const mutate = useMutation({
    mutationFn: async (action: VisualAction) => {
      switch (action.type) {
        case "approve": return approveSceneVisual(project.id, action.sceneId);
        case "reject": return rejectSceneVisual(project.id, action.sceneId);
        case "remove": return removeSceneVisual(project.id, action.sceneId);
        case "select": return selectSceneVisual(project.id, action.sceneId, action.candidateId);
        case "search": return searchSceneVisuals(project.id, action.sceneId, action.query);
        case "url": return addCustomSceneVisual(project.id, action.sceneId, action);
        case "upload": return uploadSceneVisual(project.id, action.sceneId, action.file);
        case "query": return editSceneVisualQuery(project.id, action.sceneId, action);
      }
    },
    onMutate: async (action): Promise<VisualMutationContext> => {
      setError("");
      await queryClient.cancelQueries({ queryKey: visualKeys.project(project.id) });
      const previousVisuals = queryClient.getQueryData<ProjectVisuals>(visualKeys.project(project.id));
      const previousActiveVisuals = activeVisuals;
      if (previousVisuals) {
        const selected = action.type === "select"
          ? activeVisuals?.candidates.find((candidate) => candidate.id === action.candidateId) ?? null
          : null;
        const scenes = previousVisuals.scenes.map((row) => {
          if (row.sceneId !== action.sceneId) return row;
          if (action.type === "query") {
            return { ...row, visualQueries: action.visualQueries, visualDescription: action.visualDescription };
          }
          if (action.type === "approve") {
            return {
              ...row,
              selection: row.selection ? { ...row.selection, status: "APPROVED" as const, reviewedAt: new Date().toISOString() } : null,
              status: "APPROVED" as const,
              needsUser: false,
            };
          }
          if (action.type === "reject") {
            return { ...row, selection: null, selectedCandidate: null, status: "NO_VISUAL" as const, needsUser: true, noVisual: false };
          }
          if (action.type === "remove") {
            return { ...row, selection: null, selectedCandidate: null, status: "SKIPPED" as const, needsUser: false, noVisual: true };
          }
          if (action.type === "select") {
            return {
              ...row,
              selection: row.selection ? { ...row.selection, candidateId: action.candidateId, status: "REPLACED" as const, selectedBy: "USER" as const } : null,
              selectedCandidate: selected ?? row.selectedCandidate,
              status: "REVIEW_REQUIRED" as const,
              needsUser: true,
              noVisual: false,
            };
          }
          return row;
        });
        const statusCounts = Object.fromEntries(statuses.map((status) => [
          status,
          scenes.filter((row) => row.status === status).length,
        ])) as ProjectVisuals["summary"]["statusCounts"];
        queryClient.setQueryData<ProjectVisuals>(visualKeys.project(project.id), {
          ...previousVisuals,
          scenes,
          summary: {
            ...previousVisuals.summary,
            withImage: scenes.filter((row) => row.selectedCandidate !== null).length,
            needsUser: scenes.filter((row) => row.needsUser).length,
            lowRelevance: scenes.filter((row) => row.lowRelevance).length,
            statusCounts,
          },
        });
      }
      if (activeSceneId === action.sceneId && previousActiveVisuals) {
        if (action.type === "approve") {
          setActiveVisuals({ ...previousActiveVisuals, selection: previousActiveVisuals.selection
            ? { ...previousActiveVisuals.selection, status: "APPROVED", reviewedAt: new Date().toISOString() }
            : null, status: "APPROVED" });
        } else if (action.type === "reject") {
          setActiveVisuals({ ...previousActiveVisuals, selection: null, status: "NO_VISUAL", noVisual: false });
        } else if (action.type === "remove") {
          setActiveVisuals({ ...previousActiveVisuals, selection: null, status: "SKIPPED", noVisual: true });
        } else if (action.type === "select") {
          setActiveVisuals({
            ...previousActiveVisuals,
            selection: previousActiveVisuals.selection
              ? { ...previousActiveVisuals.selection, candidateId: action.candidateId, status: "REPLACED", selectedBy: "USER" }
              : null,
            status: "REVIEW_REQUIRED",
            noVisual: false,
          });
        }
      }
      setNotice(action.type === "url" || action.type === "upload"
        ? "Đang kiểm tra và lưu ảnh..."
        : "Đang cập nhật ảnh...");
      return { previousVisuals, previousActiveVisuals };
    },
    onSuccess: async (result, action) => {
      setActiveVisuals(result);
      if ("sceneId" in action) {
        const current = queryClient.getQueryData<ProjectVisuals>(visualKeys.project(project.id));
        if (current) {
          queryClient.setQueryData(visualKeys.project(project.id), {
            ...current,
            scenes: current.scenes.map((item) => item.sceneId === action.sceneId
              ? { ...item, selection: result.selection, selectedCandidate: result.candidates.find((candidate) => candidate.id === result.selection?.candidateId) ?? null, status: result.status ?? item.status, noVisual: result.noVisual ?? false, needsUser: result.status === "NO_VISUAL" || result.status === "REVIEW_REQUIRED" }
              : item),
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: visualKeys.project(project.id) });
      setNotice("");
      toast.success("Đã cập nhật hình");
    },
    onError: (cause, action, context) => {
      if (context?.previousVisuals) queryClient.setQueryData(visualKeys.project(project.id), context.previousVisuals);
      if (action.sceneId === activeSceneId && context) setActiveVisuals(context.previousActiveVisuals);
      setNotice("");
      const message = cause instanceof Error ? cause.message : "Không thể cập nhật ảnh.";
      setError(message);
      toast.error(message);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: visualKeys.project(project.id) }),
  });

  const rows = visualsQuery.data?.scenes ?? [];
  const reused = useMemo(() => {
    const uses = new Map<string, number[]>();
    for (const [index, row] of rows.entries()) {
      const candidate = row.selectedCandidate;
      if (!candidate) continue;
      const key = candidate.sourceUrl || candidate.providerItemId;
      uses.set(key, [...(uses.get(key) ?? []), index + 1]);
    }
    return new Map([...uses].filter(([, indexes]) => indexes.length > 1));
  }, [rows]);
  const visible = rows.filter((row) => {
    if (filter === "review") return row.status === "REVIEW_REQUIRED" || row.status === "NEEDS_ATTENTION";
    if (filter === "low") return row.lowRelevance;
    if (filter === "reused") return Boolean(row.selectedCandidate && reused.has(row.selectedCandidate.sourceUrl || row.selectedCandidate.providerItemId));
    if (filter === "none") return row.status === "NO_VISUAL";
    if (filter === "approved") return row.status === "APPROVED" || row.status === "READY_FOR_RENDER";
    return true;
  });
  const paged = rows.length > 40 ? visible.slice(page * 40, (page + 1) * 40) : visible;
  const gate = pipeline.data?.stages.find((stage) => stage.stage === "VISUAL_REVIEW");
  const needsAttention = rows.filter((row) => row.status !== "READY_FOR_RENDER" && row.status !== "SKIPPED").length;
  const canApproveGate = needsAttention === 0;
  const activeRow = rows.find((row) => row.sceneId === activeSceneId);
  const selectedCandidate = activeVisuals?.candidates.find((candidate) => candidate.id === activeVisuals.selection?.candidateId) ?? null;

  useEffect(() => {
    setPage(0);
  }, [filter]);

  useEffect(() => {
    const sceneId = searchParams.get("scene");
    if (sceneId && rows.some((row) => row.sceneId === sceneId)) setActiveSceneId(sceneId);
  }, [rows, searchParams]);

  useEffect(() => {
    if (!activeSceneId) {
      setActiveVisuals(null);
      return;
    }
    const row = rows.find((item) => item.sceneId === activeSceneId);
    setQuery(row?.visualQueries.primary ?? "");
    setDescription(row?.visualDescription ?? "");
    setCandidateLimit(8);
    void getSceneVisuals(project.id, activeSceneId).then(setActiveVisuals).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Không tải được danh sách ảnh.");
    });
  }, [activeSceneId, project.id, rows]);

  useEffect(() => {
    if (!activeSceneId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const currentIndex = rows.findIndex((item) => item.sceneId === activeSceneId);
      if (event.key.toLowerCase() === "j" && rows[currentIndex + 1]) openPanel(rows[currentIndex + 1].sceneId);
      if (event.key.toLowerCase() === "k" && rows[currentIndex - 1]) openPanel(rows[currentIndex - 1].sceneId);
      if (event.key.toLowerCase() === "a") run({ type: "approve", sceneId: activeSceneId });
      if (event.key.toLowerCase() === "r") run({ type: "reject", sceneId: activeSceneId });
      const candidateIndex = Number(event.key) - 1;
      const candidate = activeVisuals?.candidates[candidateIndex];
      if (candidate && candidateIndex >= 0 && candidateIndex < 8) run({ type: "select", sceneId: activeSceneId, candidateId: candidate.id });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeSceneId, activeVisuals, mutate, rows]);

  if (visualsQuery.isPending || pipeline.isPending) return <Spinner label="Đang tải hình" />;
  if (visualsQuery.isError) return <ErrorState message={visualsQuery.error.message} onRetry={() => void visualsQuery.refetch()} />;
  if (pipeline.isError) return <ErrorState message={pipeline.error.message} onRetry={() => void pipeline.refetch()} />;

  async function approveGate() {
    setError("");
    try {
      const next = await approvePipelineGate(project.id, "VISUAL_REVIEW");
      queryClient.setQueryData(pipelineKeys.detail(project.id), next);
      toast.success("Đã duyệt cổng");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không thể duyệt cổng hình ảnh.";
      setError(message);
      toast.error(message);
    }
  }

  async function approveAll() {
    setError("");
    setApprovingAll(true);
    try {
      const result = await approveAllSceneVisuals(project.id);
      const skippedNote = result.skipped ? ` Bỏ qua ${result.skipped} cảnh chưa đủ liên quan.` : "";
      setNotice(`Đã duyệt ${result.approved} ảnh.${skippedNote} ${result.failed.length ? `Thất bại: ${result.failed.length} scene.` : ""}`);
      if (result.failed.length) {
        const rateLimited = result.failed.filter((item) => item.retryable && /HTTP 429|giới hạn tốc độ/i.test(item.reason));
        const messages = [
          ...rateLimited.length ? [`${rateLimited.length} cảnh bị máy chủ ảnh giới hạn tốc độ — bấm Duyệt tất cả lần nữa sau ít phút`] : [],
          ...result.failed.filter((item) => !rateLimited.includes(item)).map((item) => `Scene ${rows.find((row) => row.sceneId === item.sceneId)?.order! + 1}: ${item.reason}`),
        ];
        setError(messages.join(" · "));
      }
      await queryClient.invalidateQueries({ queryKey: visualKeys.project(project.id) });
      if (activeSceneId) setActiveVisuals(await getSceneVisuals(project.id, activeSceneId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể duyệt tất cả ảnh.");
    } finally {
      setApprovingAll(false);
      setConfirmAll(false);
    }
  }

  async function run(action: VisualAction) {
    try {
      await mutate.mutateAsync(action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật ảnh.");
    }
  }

  async function searchAgain() {
    if (!activeSceneId) return;
    try {
      await mutate.mutateAsync({
        type: "query",
        sceneId: activeSceneId,
        visualQueries: { primary: query, alternatives: activeRow?.visualQueries.alternatives ?? [] },
        visualDescription: description,
      });
      await mutate.mutateAsync({ type: "search", sceneId: activeSceneId, query });
      setRecentQueries((current) => [query, ...current.filter((item) => item !== query)].slice(0, 5));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tìm lại ảnh.");
    }
  }

  function openPanel(sceneId: string) {
    setActiveSceneId(sceneId);
    const next = new URLSearchParams(searchParams);
    next.set("scene", sceneId);
    setSearchParams(next, { replace: true });
  }

  function closePanel() {
    setActiveSceneId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("scene");
    setSearchParams(next, { replace: true });
  }

  function onUpload(file: File | undefined) {
    if (!file || !activeSceneId) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setError("Chỉ nhận JPEG, PNG, WebP hoặc GIF.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("Ảnh tải lên không được vượt quá 25 MB.");
      return;
    }
    run({ type: "upload", sceneId: activeSceneId, file });
  }

  const licenseCounts = visualsQuery.data?.summary.licenseCounts ?? {};
  return (
    <section className="visual-review">
      {error && <p className="request-error" role="alert">{error}</p>}
      {notice && <p className="visual-notice" role="status">{notice}</p>}
      <header className="panel visual-toolbar">
        <div className="visual-status-chips" aria-label="Số trạng thái hình">
          {statuses.map((status) => <span className="visual-chip" key={status}>{statusNames[status]} · {visualsQuery.data.summary.statusCounts[status] ?? 0}</span>)}
        </div>
        <div className="visual-license-summary">
          <span>CC0/PD · {(licenseCounts.CC0 ?? 0) + (licenseCounts.PUBLIC_DOMAIN ?? 0)}</span>
          <span>Attribution · {Object.entries(licenseCounts).filter(([kind]) => kind.startsWith("CC_BY")).reduce((sum, [, count]) => sum + count, 0)}</span>
          <span>Unknown · {licenseCounts.UNKNOWN ?? 0}</span>
          <span>NC/all-rights · {(licenseCounts.CC_BY_NC ?? 0) + (licenseCounts.ALL_RIGHTS_RESERVED ?? 0)}</span>
        </div>
        <div className="visual-top-actions">
          <button className="button button-secondary" type="button" disabled={mutate.isPending || !rows.some((row) => ["DISCOVERED", "REVIEW_REQUIRED", "REPLACED"].includes(row.selection?.status ?? ""))} onClick={() => setConfirmAll(true)}>Duyệt tất cả</button>
          <button className="button button-primary" type="button" disabled={!canApproveGate || gate?.state !== "WAITING_USER" || stageBlocked("VISUAL_REVIEW", pipeline.data)} title={canApproveGate ? undefined : `${needsAttention} scene cần xử lý`} onClick={() => void approveGate()}>Duyệt xong → tiếp tục</button>
        </div>
        <p className="visual-gate-reason" role="status">{canApproveGate ? "Tất cả scene đã sẵn sàng hoặc được bỏ qua." : `${needsAttention} scene cần xử lý trước khi duyệt cổng.`}</p>
        <label className="visual-filter">Lọc
          <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">Tất cả</option><option value="review">Cần xem</option><option value="low">Ít liên quan</option>
            <option value="reused">Ảnh dùng lại</option><option value="none">Chưa có ảnh</option><option value="approved">Đã duyệt</option>
          </select>
        </label>
      </header>
          {reused.size > 0 && (
        <div className="visual-warning" role="status">
          <p>{[...reused.values()].reduce((total, orders) => total + orders.length, 0)} cảnh đang dùng ảnh trùng — Tìm ảnh khác</p>
          <div className="visual-candidate-grid">
            {rows.filter((row) => row.selectedCandidate && reused.has(row.selectedCandidate.sourceUrl || row.selectedCandidate.providerItemId)).map((row) => (
              <figure key={row.sceneId}>
                {row.selectedCandidate && imageUrl(project.id, row.selectedCandidate)
                  ? <img src={imageUrl(project.id, row.selectedCandidate)} alt="" loading="lazy" />
                  : null}
                <figcaption>Cảnh {row.order + 1}</figcaption>
              </figure>
            ))}
          </div>
          <button type="button" onClick={() => void fetch(`/api/projects/${project.id}/visuals/dedupe`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: visualKeys.project(project.id) }))}>
            Tìm ảnh khác
          </button>
        </div>
      )}
      {paged.map((row) => {
        const candidate = row.selectedCandidate;
        const reusedAt = candidate ? reused.get(candidate.sourceUrl || candidate.providerItemId) : undefined;
        return (
          <article className="panel visual-scene-row" key={row.sceneId}>
            <div className="visual-scene-info">
              <p className="eyebrow">SCENE {row.order + 1} · {sceneTimecode(row.startSec)}–{sceneTimecode(row.startSec + row.durationSec)}</p>
              <h2>{row.visualDescription || row.visualQueries.primary || "Chưa có mô tả ảnh"}</h2>
              <p>{row.narration.slice(0, 170)}</p>
              <span className={`visual-status status-${row.status.toLowerCase()}`}>{statusNames[row.status]}</span>
              {row.status === "NEEDS_ATTENTION"
                ? <span className="visual-warning">Cần bạn · {attentionText(row.attentionReason, row.visionMeta?.reason)}</span>
                : row.selectedCandidate?.visionCheck
                  ? <span className="visual-chip">Đã kiểm tra bằng AI · {row.selectedCandidate.visionCheck.fit}/10</span>
                  : null}
              {row.lowRelevance && <span className="visual-warning">Ít liên quan</span>}
              {row.lowRelevance && (
                <button type="button" onClick={() => void fetch(`/api/projects/${project.id}/visuals/research`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ reason: "low_relevance" }),
                })}>
                  Tìm lại ảnh cho cảnh lệch chủ đề
                </button>
              )}
              {reusedAt && <span className="visual-warning">Ảnh dùng lại ở scene {reusedAt.filter((number) => number !== row.order + 1).join(", ")}</span>}
              {candidate && <span className={`visual-warning license-${candidate.license.kind.toLowerCase()}`}>{licenseBadge(candidate)}</span>}
            </div>
            <button type="button" className="visual-preview" onClick={() => openPanel(row.sceneId)} aria-label={`Đổi ảnh scene ${row.order + 1}`}>
              {candidate && imageUrl(project.id, candidate)
                ? <img src={imageUrl(project.id, candidate)} loading="lazy" alt={candidate.title} />
                : <span>{row.noVisual ? "Không dùng ảnh" : "Chưa có ảnh được chọn"}</span>}
            </button>
            <div className="visual-row-actions">
              <button className="button button-primary" type="button" disabled={!candidate || row.status === "READY_FOR_RENDER" || mutate.isPending} onClick={() => run({ type: "approve", sceneId: row.sceneId })}>Duyệt</button>
              <button className="button button-secondary" type="button" disabled={!candidate || mutate.isPending} onClick={() => run({ type: "reject", sceneId: row.sceneId })}>Bỏ ảnh này</button>
              <button className="button button-secondary" type="button" disabled={mutate.isPending} onClick={() => run({ type: "remove", sceneId: row.sceneId })}>Không dùng ảnh</button>
              <button className="button button-secondary" type="button" onClick={() => openPanel(row.sceneId)}>Đổi ảnh</button>
              <button className="button button-secondary" type="button" onClick={() => void fetch(`/api/projects/${project.id}/scenes/${row.sceneId}/crop`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ aspect: project.settings.aspectRatio === "9:16" || project.settings.aspectRatio === "1:1" ? project.settings.aspectRatio : "16:9" }),
              })}>Cắt ảnh</button>
            </div>
          </article>
        );
      })}
      {visible.length === 0 && <p className="panel visual-empty">Không có scene phù hợp bộ lọc.</p>}
      {rows.length > 40 && <nav className="visual-pagination" aria-label="Phân trang cảnh">
        <button className="button button-secondary" type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Trước</button>
        <span>{page + 1} / {Math.max(1, Math.ceil(visible.length / 40))}</span>
        <button className="button button-secondary" type="button" disabled={(page + 1) * 40 >= visible.length} onClick={() => setPage((value) => value + 1)}>Sau</button>
      </nav>}

      {activeSceneId && activeRow && (
        <div className="visual-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePanel(); }}>
          <section className="panel visual-drawer" role="dialog" aria-modal="true" aria-labelledby="visual-drawer-title">
            <header><div><p className="eyebrow">SCENE {activeRow.order + 1}</p><h2 id="visual-drawer-title">Chọn hình ảnh</h2></div><button className="button button-secondary" type="button" onClick={closePanel}>Đóng</button></header>
            {activeVisuals?.status === "NEEDS_ATTENTION" || activeRow.status === "NEEDS_ATTENTION" ? (
              <p className="visual-warning" role="status">Cần bạn xem — {activeVisuals?.visionMeta?.reason ?? activeRow.visionMeta?.reason ?? "AI nhìn chưa đạt ngưỡng."}</p>
            ) : activeRow.selectedCandidate?.visionCheck ? (
              <p className="visual-chip" role="status">Đã kiểm tra bằng AI · {activeRow.selectedCandidate.visionCheck.fit}/10</p>
            ) : null}
            {(activeVisuals?.visionMeta?.reSearchHistory?.length ?? activeRow.visionMeta?.reSearchHistory?.length ?? 0) > 0 && (
              <details className="visual-research-history">
                <summary>Lịch sử tìm lại bằng AI</summary>
                <ul>
                  {(activeVisuals?.visionMeta?.reSearchHistory ?? activeRow.visionMeta?.reSearchHistory ?? []).map((entry) => (
                    <li key={`r-${entry.round}`}>{entry.round}. {entry.queries.join(" · ")} — {entry.why}{entry.bestFit != null ? ` (fit ${entry.bestFit}/10)` : ""}</li>
                  ))}
                </ul>
              </details>
            )}
            <label className="form-field"><span>Mô tả ảnh</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="visual-search-form">
              <label className="form-field"><span>Từ khóa tìm kiếm</span><input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <button className="button button-primary" type="button" disabled={!query.trim() || mutate.isPending} onClick={() => void searchAgain()}>Tìm lại</button>
              <button
                className="button button-secondary"
                type="button"
                disabled={mutate.isPending}
                onClick={() => {
                  if (!activeSceneId) return;
                  setError("");
                  void webSearchSceneVisuals(project.id, activeSceneId)
                    .then(async (result) => {
                      setActiveVisuals(result);
                      await queryClient.invalidateQueries({ queryKey: visualKeys.project(project.id) });
                      const brave = result.usage?.braveRequests ?? 0;
                      const grounding = result.usage?.groundingCalls ?? 0;
                      setNotice(`Đã tìm trên web (Brave ${brave}, grounding ${grounding}).`);
                    })
                    .catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : "Không tìm được ảnh trên web.");
                    });
                }}
              >
                Tìm trên web
              </button>
            </div>
            {recentQueries.length > 0 && <div className="visual-recent-queries" aria-label="Các từ khóa gần đây">
              {recentQueries.map((recent) => <button className="visual-query-chip" type="button" key={recent} onClick={() => setQuery(recent)}>{recent}</button>)}
            </div>}
            <div className="visual-candidate-grid">
              {(activeVisuals?.candidates ?? []).slice(0, candidateLimit).map((item, index) => (
                <article className={`visual-candidate${item.id === activeVisuals?.selection?.candidateId ? " is-selected" : ""}`} key={item.id}>
                  <img src={imageUrl(project.id, item)} loading="lazy" alt={item.title} />
                  <strong>{item.title || `Candidate ${index + 1}`}</strong>
                  <small>{providerBadge(item)} · {item.width}×{item.height} · {Math.round(item.relevanceScore * 100)}% · {licenseBadge(item)}</small>
                  {item.why && <small className="visual-why">{item.why}</small>}
                  {item.visionCheck && (
                    <div className="visual-vision-check">
                      <span className="visual-chip">AI nhìn: {item.visionCheck.fit}/10</span>
                      <small>{item.visionCheck.depicts}</small>
                      <div className="visual-candidate-marks">
                        {item.visionCheck.issues.map((issue) => <span key={issue}>{issue}</span>)}
                      </div>
                    </div>
                  )}
                  <div className="visual-candidate-marks">
                    {isWebImageProvider(item.provider) && <span>Web</span>}
                    {isWebImageProvider(item.provider) && item.licenseVerified === false && <span>Chưa xác minh license</span>}
                    {item.scoreBreakdown.lowRelevance === true && <span>Ít liên quan</span>}
                    {(item.scoreBreakdown.reusedAcrossScenes === true || rows.some((row) => row.sceneId !== activeSceneId
                      && row.selectedCandidate?.sourceUrl === item.sourceUrl)) && <span>Dùng lại</span>}
                    {(item.watermark === "SUSPECTED" || item.visionCheck?.issues.includes("watermark")) && <span>Đã loại vì có watermark</span>}
                    {item.watermark === "UNKNOWN" && <span>Watermark chưa rõ</span>}
                  </div>
                  <button className="button button-secondary" type="button" disabled={mutate.isPending} onClick={() => run({ type: "select", sceneId: activeSceneId, candidateId: item.id })}>Chọn · {index + 1}</button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={mutate.isPending}
                    onClick={() => {
                      void (async () => {
                      const accepted = await ask({
                        title: "Kiểm tra lại bằng AI?",
                        message: "Ước tính khoảng 1 lượt gọi vision (khoảng 1000 token ảnh).",
                        confirmLabel: "Kiểm tra",
                        cancelLabel: "Hủy",
                      });
                      if (!accepted || !activeSceneId) return;
                      void visionCheckCandidate(project.id, activeSceneId, item.id)
                        .then(async () => {
                          setActiveVisuals(await getSceneVisuals(project.id, activeSceneId));
                          await queryClient.invalidateQueries({ queryKey: visualKeys.project(project.id) });
                          setNotice("Đã kiểm tra bằng AI.");
                        })
                        .catch((cause: unknown) => {
                          setError(cause instanceof Error ? cause.message : "Không kiểm tra được bằng AI.");
                        });
                      })();
                    }}
                  >
                    Kiểm tra lại bằng AI
                  </button>
                </article>
              ))}
            </div>
            {(activeVisuals?.candidates.length ?? 0) > candidateLimit && <button className="button button-secondary" type="button" onClick={() => setCandidateLimit((value) => value + 8)}>Xem thêm</button>}
            {selectedCandidate && <section className="visual-metadata">
              <h3>{selectedCandidate.title}</h3>
              <p>{selectedCandidate.sourceSite} · {selectedCandidate.actualWidth && selectedCandidate.actualHeight
                ? `${selectedCandidate.actualWidth}×${selectedCandidate.actualHeight} px thực tế`
                : `${selectedCandidate.width}×${selectedCandidate.height} px theo nguồn`}
                · tỉ lệ {selectedCandidate.aspectRatio.toFixed(2)}:1 · {selectedCandidate.fileType} · watermark {selectedCandidate.watermark}</p>
              <p>Tác giả: {selectedCandidate.license.author || "Chưa rõ"} · {selectedCandidate.license.name || selectedCandidate.license.kind}
                · {selectedCandidate.license.attributionRequired ? "cần attribution" : "không ghi nhận yêu cầu attribution"}</p>
              <p>{selectedCandidate.license.attributionText || "Không có thông tin attribution."}</p>
              {isWebImageProvider(selectedCandidate.provider) && selectedCandidate.licenseVerified === false && (
                <p role="alert">Chưa xác minh license — kiểm tra trang nguồn trước khi đăng tải công khai.</p>
              )}
              <a href={selectedCandidate.sourcePageUrl || selectedCandidate.sourceUrl} target="_blank" rel="noopener noreferrer">Mở trang nguồn</a>
              <a href={selectedCandidate.imageUrl} target="_blank" rel="noopener noreferrer">Mở URL ảnh</a>
              {selectedCandidate.license.url && <a href={selectedCandidate.license.url} target="_blank" rel="noopener noreferrer">Mở license</a>}
              {selectedCandidate.why && <p>{selectedCandidate.why}</p>}
              {selectedCandidate.license.authorUrl && <a href={selectedCandidate.license.authorUrl} target="_blank" rel="noopener noreferrer">Mở trang tác giả</a>}
              {selectedCandidate.license.attributionText && <button className="button button-secondary" type="button" onClick={() => {
                void navigator.clipboard.writeText(selectedCandidate.license.attributionText).then(
                  () => setNotice("Đã sao chép attribution."),
                  () => setError("Không thể sao chép attribution."),
                );
              }}>Sao chép attribution</button>}
              {selectedCandidate.localPath && <p>Đã lưu cục bộ: {selectedCandidate.localPath} ({selectedCandidate.bytes} bytes, {selectedCandidate.actualWidth}×{selectedCandidate.actualHeight} px)</p>}
              {selectedCandidate.downloadError && <p role="alert">Tải ảnh thất bại: {selectedCandidate.downloadError}</p>}
              <pre>{JSON.stringify(selectedCandidate.scoreBreakdown, null, 2)}</pre>
            </section>}
            <form className="visual-custom-form" onSubmit={(event) => {
              event.preventDefault();
              if (!activeSceneId || !isHttpUrl(url)) { setError("URL ảnh phải bắt đầu bằng http:// hoặc https://."); return; }
              run({ type: "url", sceneId: activeSceneId, url, ...(title ? { title } : {}), ...(author ? { author } : {}), ...(license ? { license } : {}) });
            }}>
              <h3>Dán URL ảnh</h3>
              <label className="form-field"><span>URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} /></label>
              <div className="visual-custom-fields">
                <label className="form-field"><span>Tiêu đề (tùy chọn)</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label className="form-field"><span>Tác giả (tùy chọn)</span><input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
                <label className="form-field"><span>License (tùy chọn)</span><input value={license} onChange={(event) => setLicense(event.target.value)} /></label>
              </div>
              <button className="button button-secondary" type="submit" disabled={mutate.isPending}>Dùng URL này</button>
            </form>
            <label className="button button-secondary visual-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault();
              onUpload(event.dataTransfer.files[0]);
            }}>
              Tải ảnh lên · kéo thả hoặc chọn tệp
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={mutate.isPending} onChange={(event) => onUpload(event.target.files?.[0])} />
            </label>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={confirmAll}
        title="Duyệt tất cả ảnh?"
        message={`${rows.filter((row) => ["DISCOVERED", "REVIEW_REQUIRED", "REPLACED"].includes(row.selection?.status ?? "")).length} ảnh chưa duyệt sẽ được tải và kiểm tra tuần tự.`}
        confirmLabel="Duyệt tất cả"
        busy={approvingAll}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => void approveAll()}
      />
      {visionDialog}
    </section>
  );
}
