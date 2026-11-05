import { STAGE_ORDER, isGate, type PipelineStage, type Project } from "@vg/shared";
import { Link } from "react-router-dom";

const SHORT: Record<string, string> = {
  RESEARCH: "Nghiên cứu",
  SCRIPT: "Kịch bản",
  SCENE_PLAN: "Phân cảnh",
  VISUAL_SEARCH: "Tìm ảnh",
  VISUAL_REVIEW: "Duyệt ảnh",
  VOICE: "Giọng",
  SUBTITLE: "Phụ đề",
  MUSIC_SEARCH: "Nhạc",
  MUSIC_REVIEW: "Duyệt nhạc",
  TIMELINE: "Timeline",
  FINAL_APPROVAL: "Duyệt cuối",
  RENDER: "Render",
};

const NEXT: Record<string, { tab: string; label: string }> = {
  TOPIC: { tab: "overview", label: "Xem tổng quan" },
  RESEARCH: { tab: "script", label: "Mở nghiên cứu" },
  SCRIPT: { tab: "script", label: "Mở kịch bản" },
  SCENE_PLAN: { tab: "scenes", label: "Mở phân cảnh" },
  VISUAL_SEARCH: { tab: "visuals", label: "Mở hình ảnh" },
  VISUAL_REVIEW: { tab: "visuals", label: "Duyệt hình ảnh" },
  VOICE: { tab: "voice", label: "Mở giọng đọc" },
  SUBTITLE: { tab: "subtitles", label: "Mở phụ đề" },
  MUSIC_SEARCH: { tab: "music", label: "Mở nhạc" },
  MUSIC_REVIEW: { tab: "music", label: "Duyệt nhạc" },
  TIMELINE: { tab: "timeline", label: "Mở timeline" },
  FINAL_APPROVAL: { tab: "timeline", label: "Duyệt lần cuối" },
  RENDER: { tab: "render", label: "Mở render" },
  DONE: { tab: "render", label: "Xem video" },
  PUBLISH: { tab: "render", label: "Mở phần đăng" },
  CLIP: { tab: "render", label: "Mở clip" },
};

export function StageStepper({ project }: { project: Project }) {
  const currentIndex = STAGE_ORDER.indexOf(project.stage as PipelineStage);
  const next = NEXT[project.stage] ?? NEXT.TOPIC;
  const gate = isGate(project.stage);
  const gateText = !gate
    ? "Không phải cổng duyệt"
    : project.status === "REVIEW"
      ? "Đang chờ bạn duyệt"
      : "Cổng duyệt";
  if (!next) return null;
  return (
    <div className="stage-stepper-wrap">
      <ol className="stage-stepper" aria-label="Các bước sản xuất">
        {STAGE_ORDER.map((stage, index) => (
          <li
            key={stage}
            className={stage === project.stage ? "is-current" : currentIndex > index ? "is-done" : undefined}
            aria-current={stage === project.stage ? "step" : undefined}
            title={SHORT[stage] ?? stage}
          >
            {SHORT[stage] ?? stage}
          </li>
        ))}
      </ol>
      <p className="stage-next">
        <span>Bước hiện tại: {SHORT[project.stage] ?? project.stage}</span>
        <span> · {gateText}</span>
        <span> · </span>
        <Link to={`/projects/${project.id}/${next.tab}`}>{next.label}</Link>
      </p>
    </div>
  );
}
