import type Database from "better-sqlite3";
import { AppError } from "../lib/errors.js";
import { currentWorkspaceId } from "../auth/requestContext.js";
import { escapeHtml } from "../notifications/telegram.js";
import { currentDuty } from "../supervision/duty.js";
import { resumeMissionByUser } from "./checkpoints.js";
import { cancelMission, createMission, listMissions, type MissionRow } from "./missions.js";

// TASK-129c: the /mission Telegram command. It reuses the same mission functions as the web routes.
// It only creates, lists, cancels or resumes a mission. It never approves a gate or a confirm-risk action.
export const MISSION_HELP = "/mission <lệnh> — tạo mission · /mission list — danh sách · /mission resume <id> — gỡ chờ · /mission cancel <id> — huỷ";

export function handleMissionCommand(sqlite: Database.Database, args: string): string {
  const workspaceId = currentWorkspaceId(sqlite);
  if (!workspaceId) return "Chưa có workspace để tạo mission.";
  const [sub = "", ...rest] = args.trim().split(/\s+/);
  const tail = rest.join(" ").trim();
  try {
    if (!args.trim() || sub.toLowerCase() === "list") return formatList(listMissions(sqlite, workspaceId, 5));
    if (sub.toLowerCase() === "resume") {
      const mission = resumeMissionByUser(sqlite, workspaceId, requireId(tail));
      return `Đã gỡ chờ: ${missionLine(mission)}`;
    }
    if (sub.toLowerCase() === "cancel") {
      const mission = cancelMission(sqlite, workspaceId, requireId(tail));
      return `Đã huỷ: ${missionLine(mission)}`;
    }
    // Anything else is a new command. The whole text is kept as the mission command.
    const mission = createMission(sqlite, workspaceId, { command: args.trim().slice(0, 2000), channelProfileId: null, projectIds: [] }, {
      createdBy: "user", owner: currentDuty(sqlite)?.instance ?? null,
    });
    return `Đã tạo mission: ${missionLine(mission)}`;
  } catch (error) {
    if (error instanceof AppError) return escapeHtml(error.message);
    throw error;
  }
}

function requireId(value: string): string {
  if (!value) throw new AppError(422, "MISSION_ID_REQUIRED", "Thiếu mã mission. Ví dụ: /mission resume <id>");
  return value;
}

function formatList(missions: MissionRow[]): string {
  if (!missions.length) return "Chưa có mission nào.";
  return ["<b>Mission gần đây</b>", ...missions.map(missionLine)].join("\n");
}

function missionLine(mission: MissionRow): string {
  return `${escapeHtml(mission.command.slice(0, 80))} · <code>${escapeHtml(mission.id)}</code> · ${escapeHtml(mission.state)}`;
}
