import { z } from "zod";
import type { AssistantToolDef } from "../assistant/tools.js";
import { currentScope, scopeSql } from "../auth/requestContext.js";
import { FileGc } from "./fileGc.js";

export const storageToolDefs: AssistantToolDef[] = [{
  name: "storage_report",
  risk: "read",
  description: "Dung lượng tệp, bản mồ côi và ngày dọn theo các dự án được phép xem.",
  argsSchema: z.object({}).strict(),
  summarize: () => "Xem dung lượng lưu trữ",
  execute: async (_args, ctx) => {
    const scope = scopeSql("workspace_id", "profile_id");
    const projects = ctx.sqlite.prepare(`SELECT id FROM projects WHERE ${scope.sql}`).all(...scope.args) as Array<{ id: string }>;
    return new FileGc(ctx.sqlite, ctx.config.DATA_DIR).report(currentScope() ? new Set(projects.map(({ id }) => id)) : undefined);
  },
}];
