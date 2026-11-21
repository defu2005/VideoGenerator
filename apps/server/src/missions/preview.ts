import type Database from "better-sqlite3";
import { GATES, scriptReviewAutoPasses, type ScriptOutlineApproval } from "@vg/shared";

// TASK-129c: what will stop for the user, read from the same inputs the orchestrator uses for gates:
// project.mode, settings.autoRender, and the gate's readiness check. The gate path (pipeline/orchestrator.ts)
// does not read the profile autonomy level or grants, so this preview does not either; a grants-based
// preview would tell the user the wrong thing.

export type GatePreview = { gate: string; label: string; stopsForUser: boolean; reason: string };
export type ProjectPreview = { projectId: string; title: string; mode: string; gates: GatePreview[] };
export type MissionPreview = { projects: ProjectPreview[]; alwaysStops: string[]; note: string | null };

const GATE_LABEL: Record<string, string> = {
  SCRIPT_REVIEW: "Duyệt kịch bản",
  VISUAL_REVIEW: "Duyệt hình ảnh",
  MUSIC_REVIEW: "Duyệt nhạc",
  FINAL_APPROVAL: "Duyệt bản cuối",
};

const ALWAYS_STOPS = [
  "Hành động rủi ro (confirm-risk) luôn chờ bạn duyệt, ở mọi mức.",
  "Ghi và duyệt cổng chỉ do bạn thực hiện từ trang dự án hoặc chat; agent không tự duyệt.",
];

export function missionPreview(sqlite: Database.Database, mission: { projectIds: string[] }): MissionPreview {
  if (mission.projectIds.length === 0) {
    return {
      projects: [],
      alwaysStops: ALWAYS_STOPS,
      note: "Chưa gắn dự án nào. Cổng sẽ theo chế độ của từng dự án khi dự án được gắn vào mission.",
    };
  }
  const read = sqlite.prepare("SELECT id, title, mode, settings FROM projects WHERE id = ?");
  const projects: ProjectPreview[] = [];
  for (const projectId of mission.projectIds) {
    const row = read.get(projectId) as { id: string; title: string; mode: string; settings: string } | undefined;
    if (!row) continue;
    let autoRender = false;
    let approval: ScriptOutlineApproval | undefined;
    try {
      const parsed = JSON.parse(row.settings) as { autoRender?: unknown; scriptOutlineApproval?: ScriptOutlineApproval };
      autoRender = parsed.autoRender === true;
      approval = parsed.scriptOutlineApproval;
    } catch { autoRender = false; }
    const gates = GATES.map((gate): GatePreview => {
      const label = GATE_LABEL[gate] ?? gate;
      if (gate === "SCRIPT_REVIEW" && scriptReviewAutoPasses(approval)) {
        return { gate, label, stopsForUser: false, reason: "Tắt duyệt kịch bản: qua ngay, không chờ bạn." };
      }
      if (row.mode !== "AUTO") {
        return { gate, label, stopsForUser: true, reason: "Dự án không ở chế độ AUTO: chờ bạn duyệt." };
      }
      if (gate === "FINAL_APPROVAL" && !autoRender) {
        return { gate, label, stopsForUser: true, reason: "Dự án AUTO nhưng chưa bật tự render: dừng chờ bạn." };
      }
      return { gate, label, stopsForUser: false, reason: "Tự duyệt khi dự án ở chế độ AUTO. Vẫn dừng nếu chưa đạt điều kiện duyệt hoặc còn lỗi MUST về nội dung." };
    });
    projects.push({ projectId: row.id, title: row.title, mode: row.mode, gates });
  }
  return { projects, alwaysStops: ALWAYS_STOPS, note: null };
}
