import { z } from "zod";
import type { AssistantToolDef } from "../assistant/tools.js";
import { STAGE_LESSON_STAGES, decideStageNote, recordStageNotes } from "./stageLessons.js";
import { stageQualityTrend } from "./stageQuality.js";

/** TASK-148a: operator tools for stage feedback. Proposing is safe; approving needs the user (confirm). */

const StageEnum = z.enum(STAGE_LESSON_STAGES);
const ListArgs = z.object({ profileId: z.string().min(1).nullable(), stage: StageEnum, limit: z.number().int().min(1).max(50).default(20) }).strict();
const ProposeArgs = z.object({
  profileId: z.string().min(1).nullable(),
  stage: StageEnum,
  notes: z.array(z.object({
    text: z.string().min(1).max(300),
    evidenceIds: z.array(z.string().min(1)).min(1),
    confidence: z.number().min(0).max(1),
  })).min(1).max(5),
}).strict();
const ApproveArgs = z.object({ id: z.string().min(1), decision: z.enum(["approve", "reject", "retire"]) }).strict();

const QualityArgs = z.object({
  profileId: z.string().min(1).nullable().optional(),
  stage: StageEnum,
  metric: z.string().min(1).max(60).optional(),
  days: z.number().int().min(1).max(90).default(14),
}).strict();

export const stageToolDefs: AssistantToolDef[] = [
  {
    name: "stage_quality_report",
    description: "Đọc xu hướng chất lượng theo bước: trung bình 14 ngày gần đây so với 14 ngày trước, theo kênh hoặc toàn app.",
    risk: "read",
    argsSchema: QualityArgs,
    summarize: (args) => `Báo cáo chất lượng ${String((args as { stage?: string }).stage ?? "")}`,
    execute: async (args, ctx) => {
      const { profileId, stage, metric, days } = QualityArgs.parse(args);
      return stageQualityTrend(ctx.sqlite, { profileId, stage, metric, days });
    },
  },
  {
    name: "list_stage_feedback",
    description: "Đọc phản hồi theo bước (sửa lời thoại, từ chối cổng, đổi cảnh) chưa được chắt lọc, để đề xuất bài học.",
    risk: "read",
    argsSchema: ListArgs,
    summarize: () => "Đọc phản hồi theo bước",
    execute: async (args, ctx) => {
      const { profileId, stage, limit } = ListArgs.parse(args);
      const rows = ctx.sqlite.prepare(
        `SELECT id, kind, target, before, after, reason, created_at AS createdAt FROM stage_feedback
         WHERE profile_id IS ? AND stage = ? AND distilled_at IS NULL ORDER BY created_at LIMIT ?`,
      ).all(profileId, stage, limit);
      return { rows };
    },
  },
  {
    name: "propose_stage_note",
    description: "Đề xuất bài học theo bước từ phản hồi chưa chắt lọc. Chỉ tạo đề xuất (proposed), người dùng phải duyệt.",
    risk: "safe",
    argsSchema: ProposeArgs,
    summarize: (args) => `Đề xuất bài học cho ${String((args as { stage?: string }).stage ?? "bước")}`,
    execute: async (args, ctx) => {
      const input = ProposeArgs.parse(args);
      return recordStageNotes(ctx.sqlite, { profileId: input.profileId, stage: input.stage, notes: input.notes });
    },
  },
  {
    name: "decide_stage_note",
    description: "Duyệt, từ chối hoặc gỡ một bài học theo bước. Hành động này cần người dùng xác nhận.",
    risk: "confirm",
    argsSchema: ApproveArgs,
    summarize: (args) => `Quyết định bài học ${String((args as { id?: string }).id ?? "")}`,
    execute: async (args, ctx) => {
      const { id, decision } = ApproveArgs.parse(args);
      return decideStageNote(ctx.sqlite, { id, decision, decidedBy: "operator" });
    },
  },
];
