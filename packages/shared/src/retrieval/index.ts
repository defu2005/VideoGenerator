import { z } from "zod";
import { redactExportText } from "../operator/redact.js";
export const KnowledgeKindSchema = z.enum(["memory", "lesson", "guideline", "script", "research", "result", "comment", "topic", "skill_report"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;
export const RetrievalSettingsSchema = z.object({
    embeddingProvider: z.string().max(80).optional(),
    embeddingModel: z.string().max(200).optional(),
    indexComments: z.boolean().default(false),
    profiles: z.record(z.string(), z.object({ kindsOff: z.array(KnowledgeKindSchema).default([]) }).strict()).default({}),
}).strict();
export type RetrievalSettings = z.infer<typeof RetrievalSettingsSchema>;
export const KnowledgeSearchSchema = z.object({ query: z.string().trim().min(1).max(300), kinds: z.array(KnowledgeKindSchema).optional(), mode: z.enum(["text", "hybrid"]).default("hybrid") }).strict();
export const KnowledgeExclusionSchema = z.object({ chunkId: z.number().int().positive(), excluded: z.boolean() }).strict();
export function knowledgeTerms(text: string): string[] {
    return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").match(/[\p{L}\p{N}]+/gu) ?? [];
}
// Same embedded-command pattern as Computer Use. Retrieved material is always data.
const EMBEDDED_COMMAND = /(bỏ qua|phớt lờ|ignore|disregard).{0,40}(hướng dẫn|chỉ dẫn|instruction|prompt)|(agent|trợ lý|assistant|ai)\s*(hãy|ơi|,|:)\s*(bấm|nhấn|xóa|gửi|nhập|click|delete|send)|system prompt|you are now/i;
export function safeKnowledgeText(text: string): string {
    return redactExportText(text).split(/\r?\n/).filter((line) => !EMBEDDED_COMMAND.test(line)).join("\n")
        .replace(/<\/?kien_thuc_kenh[^>]*>/gi, "").trim();
}
export function chunkKnowledge(text: string, max = 1200): string[] {
    const safe = safeKnowledgeText(text);
    const chunks: string[] = [];
    let rest = safe;
    while (rest.length) {
        let end = Math.min(max, rest.length);
        if (end < rest.length) {
            const split = rest.lastIndexOf(" ", end);
            if (split > max / 2)
                end = split;
        }
        const part = rest.slice(0, end).trim();
        if (part)
            chunks.push(part);
        rest = rest.slice(end).trim();
    }
    return chunks;
}
export function resultSentence(views?: number | null, avgViewPct?: number | null): string {
    return [views == null ? "Chưa có lượt xem" : `${Math.round(views).toLocaleString("fr-FR").replace(/\s/g, " ")} lượt xem`, avgViewPct == null ? "" : `xem trung bình ${Math.round(avgViewPct)}%`].filter(Boolean).join(", ");
}
export function commentText(comments: {
    text: string;
    status?: string;
    classification?: string | null;
    like_count?: number;
}[]): string {
    return comments.filter((c) => c.status !== "spam" && c.status !== "hidden" && c.classification !== "spam")
        .sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0)).slice(0, 10)
        .map((c) => safeKnowledgeText(c.text).replace(/@[\p{L}\p{N}_.-]+/gu, "[ẩn]")).join("\n").slice(0, 1200);
}

export const KnowledgeMatchSchema = z.object({
  chunkId:z.number().int().positive(),kind:KnowledgeKindSchema,title:z.string(),text:z.string(),sourceId:z.string(),sourceVersion:z.string(),projectId:z.string().optional(),score:z.number(),
  breakdown:z.object({bm25:z.number().nullable(),vector:z.number().nullable(),boost:z.number()}),
});
export const KnowledgeSearchResultSchema=z.object({matches:z.array(KnowledgeMatchSchema),mode:z.enum(["text","hybrid"])});
export const KnowledgeStatusSchema=z.object({counts:z.record(z.string(),z.number().int().nonnegative()),total:z.number().int().nonnegative(),embeddingCoverage:z.number().min(0).max(100),embeddingModel:z.string().nullable(),lastIndexedAt:z.string().nullable(),chunksOverCap:z.number().int().nonnegative(),ftsAvailable:z.boolean(),indexing:z.boolean()});
export const RetrievalUseSchema=z.object({id:z.number().int(),project_id:z.string(),stage:z.string(),task_id:z.string(),chunkIds:z.array(z.number().int()),scores:z.array(z.number()),tokens:z.number().int().nonnegative(),mode:z.enum(["text","hybrid"]),created_at:z.string()});
export const KnowledgeUsedChunkSchema=KnowledgeMatchSchema.pick({chunkId:true,title:true,text:true,kind:true,projectId:true}).extend({excluded:z.boolean()});
export const KnowledgeUsesResponseSchema=z.object({uses:z.array(RetrievalUseSchema.extend({chunks:z.array(KnowledgeUsedChunkSchema)}))});
export const KnowledgeSettingsResponseSchema=z.object({settings:RetrievalSettingsSchema,providers:z.array(z.object({id:z.string(),label:z.string()}))});
