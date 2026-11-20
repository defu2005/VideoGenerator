import { z } from "zod";
import type { AssistantToolContext, AssistantToolDef } from "../assistant/tools.js";
import { currentActor, currentWorkspaceId } from "../auth/requestContext.js";
import { AppError } from "../lib/errors.js";
import { currentDuty, isOnDuty } from "../supervision/duty.js";
import { fixedKeyAgent } from "../supervision/identity.js";
import {
  attachMissionProject, cancelMission, createMission, getMission, listMissions, MAX_PLAN_STEPS, MISSION_STATES, moveMissionByAgent,
  setMissionPlan, type MissionState,
} from "./missions.js";
import { resumeMissionByUser } from "./checkpoints.js";

// TASK-129c slice 1: the orchestrator's mission tools. The caller must hold a machine key, be on duty, and own the mission
// (the owner check lives in the service). Workspace comes from the session and fails closed.
const idArgs = z.object({ id: z.string().min(1).max(80) }).strict();
const planToolArgs = idArgs.extend({ steps: z.array(z.record(z.string(), z.unknown())).max(MAX_PLAN_STEPS) }).strict();
const attachToolArgs = idArgs.extend({ projectId: z.string().min(1).max(80) }).strict();
const moveToolArgs = idArgs.extend({ to: z.enum(MISSION_STATES) }).strict();

// Identity comes from the machine key, the same way the mailbox tools resolve it (ctx.agent is not set on registry calls).
function scoped(ctx: AssistantToolContext): { instance: string; workspaceId: string } {
  const actor = currentActor();
  const instance = fixedKeyAgent(ctx.sqlite, actor?.kind === "apikey" ? actor.keyId : null).instance;
  const workspaceId = currentWorkspaceId(ctx.sqlite) ?? "";
  if (!workspaceId) throw new AppError(403, "MISSION_NO_WORKSPACE", "Chưa chọn workspace.");
  if (!isOnDuty(ctx.sqlite, instance)) throw new AppError(403, "MISSION_NOT_ON_DUTY", "Chỉ agent đang trực mới làm việc với mission.");
  return { instance, workspaceId };
}

// TASK-129c: the chat tools for the user (the same actions as /mission on Telegram). An API-key actor is refused, so an agent
// cannot clear a hold. The user's own clearing of a hold never approves a gate or a confirm-risk action.
const createArgs = z.object({ command: z.string().trim().min(1).max(2000) }).strict();
// Mirrors the web route's userOnly: a present actor must be the signed-in instance owner. Internal chat calls carry no actor.
const userWorkspace = (ctx: AssistantToolContext): string => {
  const actor = currentActor();
  if (actor && (actor.kind !== "user" || !actor.isInstanceOwner)) throw new AppError(403, "MISSION_USER_ONLY", "Chỉ chủ app đăng nhập qua giao diện được thao tác mission từ trợ lý.");
  const workspaceId = currentWorkspaceId(ctx.sqlite);
  if (!workspaceId) throw new AppError(403, "MISSION_NO_WORKSPACE", "Chưa chọn workspace.");
  return workspaceId;
};

export const missionToolDefs: AssistantToolDef[] = [
  {
    name: "mission_list",
    description: "Liệt kê 5 mission gần nhất.",
    risk: "read",
    argsSchema: z.object({}).strict(),
    summarize: () => "Xem danh sách mission",
    execute: async (_args, ctx) => ({ missions: listMissions(ctx.sqlite, userWorkspace(ctx), 5) }),
  },
  {
    name: "mission_create",
    description: "Tạo mission từ lệnh người dùng.",
    risk: "confirm",
    argsSchema: createArgs,
    summarize: () => "Tạo mission",
    execute: async (args, ctx) => {
      const input = createArgs.parse(args);
      const workspaceId = userWorkspace(ctx);
      return { mission: createMission(ctx.sqlite, workspaceId, { command: input.command, channelProfileId: null, projectIds: [] }, {
        createdBy: "user", owner: currentDuty(ctx.sqlite)?.instance ?? null,
      }) };
    },
  },
  {
    name: "mission_resume",
    description: "Gỡ chờ người (waiting_user). Không duyệt cổng.",
    risk: "confirm",
    argsSchema: idArgs,
    summarize: () => "Gỡ chờ mission",
    execute: async (args, ctx) => {
      const { id } = idArgs.parse(args);
      return { mission: resumeMissionByUser(ctx.sqlite, userWorkspace(ctx), id) };
    },
  },
  {
    name: "mission_cancel",
    description: "Huỷ mission còn mở.",
    risk: "confirm",
    argsSchema: idArgs,
    summarize: () => "Huỷ mission",
    execute: async (args, ctx) => {
      const { id } = idArgs.parse(args);
      return { mission: cancelMission(ctx.sqlite, userWorkspace(ctx), id) };
    },
  },
  {
    name: "mission_get",
    description: "Đọc một mission trong workspace: trạng thái, người giữ, kế hoạch, dự án.",
    risk: "read",
    argsSchema: idArgs,
    summarize: () => "Xem mission",
    execute: async (args, ctx) => {
      const { id } = idArgs.parse(args);
      const { workspaceId } = scoped(ctx);
      return { mission: getMission(ctx.sqlite, workspaceId, id) };
    },
  },
  {
    name: "mission_set_plan",
    description: "Người giữ mission ghi kế hoạch (thay toàn bộ danh sách bước). Chỉ khi mission đang planning.",
    risk: "safe",
    argsSchema: planToolArgs,
    summarize: () => "Ghi kế hoạch mission",
    execute: async (args, ctx) => {
      const { id, steps } = planToolArgs.parse(args);
      const { instance, workspaceId } = scoped(ctx);
      return { mission: setMissionPlan(ctx.sqlite, workspaceId, id, instance, steps) };
    },
  },
  {
    name: "mission_attach_project",
    description: "Người giữ mission gắn thêm một dự án trong cùng workspace. Dự án được bảo vệ bị từ chối.",
    risk: "safe",
    argsSchema: attachToolArgs,
    summarize: () => "Gắn dự án vào mission",
    execute: async (args, ctx) => {
      const { id, projectId } = attachToolArgs.parse(args);
      const { instance, workspaceId } = scoped(ctx);
      return { mission: attachMissionProject(ctx.sqlite, workspaceId, id, instance, projectId) };
    },
  },
  {
    name: "mission_move",
    description: "Người giữ mission chuyển trạng thái. Agent chỉ được planning → producing hoặc đánh dấu failed; các bước khác do hệ thống làm.",
    risk: "safe",
    argsSchema: moveToolArgs,
    summarize: (args) => `Chuyển mission sang ${(args as { to?: string }).to ?? "?"}`,
    execute: async (args, ctx) => {
      const { id, to } = moveToolArgs.parse(args);
      const { instance, workspaceId } = scoped(ctx);
      return { mission: moveMissionByAgent(ctx.sqlite, workspaceId, id, instance, to as MissionState) };
    },
  },
];
