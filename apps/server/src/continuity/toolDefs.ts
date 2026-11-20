import { z } from "zod";
import type { AssistantToolDef } from "../assistant/tools.js";
import { checkContinuity } from "./check.js";

const Args = z.object({ projectId: z.string().uuid() }).strict();
export const continuityToolDefs: AssistantToolDef[] = [
  { name: "get_continuity_plan", risk: "read", argsSchema: Args, description: "Đọc định hướng nhân vật, bảng màu, nhịp và motif của projectId; không sửa hoặc gọi model.",
    summarize: () => "Đọc định hướng hình ảnh", execute: async (raw, ctx) => ctx.scenes.get(Args.parse(raw).projectId).continuity ?? null },
  { name: "check_continuity", risk: "read", argsSchema: Args, description: "Kiểm tra màu, nhịp, motif của projectId bằng code; trả findings và trạng thái kiểm nhân vật đã có. Không đổi ảnh, gate hoặc gọi model.",
    summarize: () => "Kiểm tra tính liền mạch", execute: async (raw, ctx) => {
      const { projectId } = Args.parse(raw); ctx.scenes.get(projectId);
      return checkContinuity(projectId, ctx.sqlite, ctx.config);
    } },
];
