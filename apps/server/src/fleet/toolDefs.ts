import { z } from "zod";
import type { AssistantToolDef } from "../assistant/tools.js";
import { agentOf } from "../supervision/toolDefs.js";
import { isOnDuty } from "../supervision/duty.js";
import { LessonScopeSchema, RecordLessonSchema, recordLesson, retireLesson, searchLessons } from "./lessons.js";

export const fleetToolDefs: AssistantToolDef[] = [
  { name: "record_lesson", description: "Ghi bài học có bằng chứng dùng chung trong workspace; trùng nội dung tăng số lần xác nhận.", risk: "safe", argsSchema: RecordLessonSchema,
    summarize: () => "Ghi bài học vận hành", execute: async (args, ctx) => { const a = agentOf(ctx); return recordLesson(ctx.sqlite, args, { kind: a.kind, instance: a.instance }); } },
  { name: "search_lessons", description: "Tìm bài học vận hành đã xác nhận trong workspace hiện tại.", risk: "read",
    argsSchema: z.object({ query: z.string().max(500).default(""), scope: LessonScopeSchema.optional(), limit: z.number().int().min(1).max(100).default(20) }).strict(),
    summarize: () => "Tìm bài học", execute: async (args, ctx) => { const a = args as { query: string; scope?: string; limit: number }; return { items: searchLessons(ctx.sqlite, a.query, a.scope, a.limit) }; } },
  { name: "retire_lesson", description: "Hermes đang trực ngừng dùng một bài học, kèm lý do; không xóa lịch sử.", risk: "safe",
    argsSchema: z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict(), summarize: () => "Ngừng dùng bài học",
    execute: async (args, ctx) => { const a = agentOf(ctx); if (a.kind !== "hermes" || !a.canSupervise || !isOnDuty(ctx.sqlite, a.instance)) return { ok: false, code: "NOT_ON_DUTY" }; const input = args as { id: string; reason: string }; return retireLesson(ctx.sqlite, input.id, input.reason); } },
];
