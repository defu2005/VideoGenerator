import { z } from "zod";
import type { AssistantToolDef } from "../assistant/tools.js";
import { OriginalityService } from "./service.js";

export const originalityToolDefs: AssistantToolDef[] = [{
  name: "get_originality_report",
  description: "Đọc bản kê nguồn, tính nguyên bản, video tương tự và cảnh báo cần người duyệt. Không gọi AI hoặc thay đổi dữ liệu.",
  risk: "read", argsSchema: z.object({ projectId: z.string().uuid() }).strict(),
  summarize: () => "Đọc nguồn & tính nguyên bản",
  execute: async (args, ctx) => new OriginalityService(ctx.sqlite).get((args as { projectId: string }).projectId),
}];
