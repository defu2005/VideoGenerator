import { z } from "zod";
import { PipelineStageSchema } from "@vg/shared";
import type { AssistantToolContext, AssistantToolDef } from "../assistant/tools.js";
import { currentActor } from "../auth/requestContext.js";
import { getKeyProfile, resolveTrustedAgent } from "../supervision/identity.js";
import { AppError } from "../lib/errors.js";
import { AgentVisualItemSchema, AgentVisualVerdictSchema } from "./visualToolkit.js";
import { AgentUsageSchema } from "./usage.js";
import { readVisualQueries } from "./visualCache.js";
import { queryHints } from "../learning/queryPatterns.js";

export const StageClaimSchema = z.object({ stages: z.array(PipelineStageSchema).min(1).optional(), projectId: z.uuid().optional(), profileId: z.uuid().optional() }).strict();
export const StageFenceShape = { jobId: z.uuid(), leaseId: z.uuid() };
export const StageHeartbeatSchema = z.object({ ...StageFenceShape, progress: z.number().min(0).max(99).optional(), note: z.string().max(300).optional() }).strict();
export const StageCompleteSchema = z.object({ ...StageFenceShape, summary: z.string().trim().min(1).max(1000), usage: AgentUsageSchema.optional() }).strict();
export const StageReleaseSchema = z.object({ ...StageFenceShape, reason: z.string().trim().min(1).max(500) }).strict();
export const VisualSubmitSchema = z.object({ ...StageFenceShape, sceneId: z.uuid(), items: z.array(AgentVisualItemSchema).min(1).max(12) }).strict();
export const VisualImageSchema = z.object({ candidateId: z.uuid(), maxSide: z.number().int().min(64).max(2048).default(768) }).strict();
export const VisualVerdictSchema = AgentVisualVerdictSchema.extend({ ...StageFenceShape, candidateId: z.uuid() }).strict();
// notes is checked by AgentResearchToolkit so a bad shape returns RESEARCH_AGENT_INVALID with problems, not a Zod error.
export const ResearchSubmitSchema = z.object({ ...StageFenceShape, notes: z.record(z.string(), z.unknown()) }).strict();
export const MusicSubmitSchema = z.object({ ...StageFenceShape, candidates: z.array(z.unknown()).min(1).max(8) }).strict();
// script is checked by AgentScriptToolkit so a bad shape returns SCRIPT_AGENT_INVALID with problems, not a Zod error.
export const ScriptSubmitSchema = z.object({ ...StageFenceShape, script: z.record(z.string(), z.unknown()) }).strict();
export const VisualSelectSchema =z.object({ ...StageFenceShape, sceneId: z.uuid(), candidateId: z.uuid() }).strict();
const VisualCacheLookupSchema = z.object({
  subjectKey: z.string().trim().min(1).max(1000), phash: z.string().regex(/^[a-f0-9]{16}$/i).optional(),
  candidateId: z.uuid().optional(), imageUrl: z.string().url().max(4000).optional(),
}).strict().refine((args) => [args.phash, args.candidateId, args.imageUrl].filter(Boolean).length === 1, "Chọn đúng một nguồn ảnh.");
const VisualCacheQuerySchema = z.object({ query: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(101).optional(), topic: z.string().trim().min(1).max(80).optional() }).strict();

function resolveAgent(ctx: AssistantToolContext, fixedInstance: boolean) {
  // Re-resolve the machine key: a caller-supplied kind/name is never authority.
  const actor = currentActor();
  const profile = getKeyProfile(ctx.sqlite, actor?.kind === "apikey" ? actor.keyId : null);
  if (fixedInstance && profile?.instanceName === "unknown") throw new AppError(403, "STAGE_AGENT_KEY_REQUIRED", "Khóa máy cần tên instance cố định trước khi nhận stage.");
  return resolveTrustedAgent({ sqlite: ctx.sqlite, keyId: actor?.kind === "apikey" ? actor.keyId : null,
    headers: { "x-vg-agent-model": ctx.agent?.model ?? undefined, "x-vg-agent-environment": ctx.agent?.environment } });
}

function services(ctx: AssistantToolContext, fixedInstance = true) {
  if (!ctx.agentStages || !ctx.agentVisuals) throw new AppError(503, "AGENT_STAGES_UNAVAILABLE", "Bộ công cụ stage chưa sẵn sàng.");
  return { stages: ctx.agentStages, visuals: ctx.agentVisuals, agent: resolveAgent(ctx, fixedInstance) };
}

function musicServices(ctx: AssistantToolContext) {
  if (!ctx.agentStages || !ctx.agentMusic) throw new AppError(503, "AGENT_STAGES_UNAVAILABLE", "Bộ công cụ stage chưa sẵn sàng.");
  return { music: ctx.agentMusic, agent: resolveAgent(ctx, true) };
}

function scriptServices(ctx: AssistantToolContext) {
  if (!ctx.agentStages || !ctx.agentScript) throw new AppError(503, "AGENT_STAGES_UNAVAILABLE", "Bộ công cụ stage chưa sẵn sàng.");
  return { script: ctx.agentScript, agent: resolveAgent(ctx, true) };
}

function researchServices(ctx: AssistantToolContext) {
  if (!ctx.agentStages || !ctx.agentResearch) throw new AppError(503, "AGENT_STAGES_UNAVAILABLE", "Bộ công cụ stage chưa sẵn sàng.");
  return { research: ctx.agentResearch, agent: resolveAgent(ctx, true) };
}

export const agentStageToolDefs: AssistantToolDef[] = [
  { name: "visual_cache_lookup", description: "Tra verdict theo chủ thể và một trong phash, candidateId hoặc URL ảnh. Kết quả chỉ tham khảo khi chọn ảnh.", risk: "read", argsSchema: VisualCacheLookupSchema,
    summarize: () => "Tra kết quả đã kiểm ảnh", execute: async (raw, ctx) => services(ctx, false).visuals.lookupVerdict(VisualCacheLookupSchema.parse(raw)) },
  { name: "visual_cache_query", description: "Tra URL và metadata ảnh đã tìm trong workspace theo truy vấn, có thể lọc nguồn. Truyền topic để nhận queryHints: truy vấn agent đã đánh giá đạt cho chủ đề tương tự (TASK-148d; chỉ dự án không kênh).", risk: "read", argsSchema: VisualCacheQuerySchema,
    summarize: () => "Tra kết quả tìm ảnh", execute: async (raw, ctx) => { const args = VisualCacheQuerySchema.parse(raw); const workspaceId = currentActor()?.workspaceId ?? null; return { results: readVisualQueries(ctx.sqlite, workspaceId, args.query, args.source), queryHints: queryHints(ctx.sqlite, workspaceId, args.topic) }; } },
  { name: "stage_claim_next", description: "Nhận một stage còn mở bằng danh tính khóa máy; trả job, leaseId và ngữ cảnh. Không có việc thì trả null.", risk: "safe", argsSchema: StageClaimSchema,
    summarize: () => "Nhận stage chờ agent", execute: async (raw, ctx) => { const { stages, agent } = services(ctx); return stages.claim(agent, StageClaimSchema.parse(raw)); } },
  { name: "stage_heartbeat", description: "Báo tiến độ và gia hạn lease stage 10 phút; mã lease cũ bị từ chối.", risk: "safe", argsSchema: StageHeartbeatSchema,
    summarize: () => "Báo stage đang chạy", execute: async (raw, ctx) => { const a = StageHeartbeatSchema.parse(raw), { stages, agent } = services(ctx); return stages.heartbeat(agent, a.jobId, a.leaseId, a.progress, a.note); } },
  { name: "stage_complete", description: "Hoàn tất stage sau khi app kiểm tra đủ ảnh, kết quả duyệt, hash và cổng chất lượng; pipeline tiếp tục.", risk: "safe", argsSchema: StageCompleteSchema,
    summarize: () => "Hoàn tất stage do agent xử lý", execute: async (raw, ctx) => { const a = StageCompleteSchema.parse(raw), { stages, agent } = services(ctx); return stages.complete(agent, a.jobId, a.leaseId, a.summary, a.usage); } },
  { name: "stage_release", description: "Trả stage về hàng đợi; reason=cannot_do chuyển việc lại cho app.", risk: "safe", argsSchema: StageReleaseSchema,
    summarize: () => "Trả stage về hàng đợi", execute: async (raw, ctx) => { const a = StageReleaseSchema.parse(raw), { stages, agent } = services(ctx); return stages.release(agent, a.jobId, a.leaseId, a.reason); } },
  { name: "visual_submit_candidates", description: "Tải ảnh cho cảnh còn mở, lưu nguồn và hash, bỏ ảnh trùng. Cần lease stage hợp lệ.", risk: "safe", argsSchema: VisualSubmitSchema,
    summarize: () => "Nạp ảnh agent tìm được", execute: async (raw, ctx) => { const a = VisualSubmitSchema.parse(raw), { visuals, agent } = services(ctx); return visuals.submit(agent, a.jobId, a.leaseId, a.sceneId, a.items); } },
  { name: "visual_get_candidate_image", description: "Xem đúng tệp ảnh lưu trong app, thu nhỏ mặc định 768px; trả ảnh MCP và SHA gốc.", risk: "read", argsSchema: VisualImageSchema,
    summarize: () => "Xem tệp ảnh ứng viên", execute: async (raw, ctx) => { const a = VisualImageSchema.parse(raw), { visuals } = services(ctx, false); return visuals.image(a.candidateId, a.maxSide); } },
  { name: "visual_record_verdict", description: "Agent duyệt hoặc loại ảnh đã lưu; lưu model, chủ thể và SHA đã xem. Không thay đổi các cổng còn lại.", risk: "safe", argsSchema: VisualVerdictSchema,
    summarize: () => "Ghi kết quả agent nhìn ảnh", execute: async (raw, ctx) => { const a = VisualVerdictSchema.parse(raw), { visuals, agent } = services(ctx); return visuals.recordVerdict(agent, a.jobId, a.leaseId, a.candidateId, { verdict: a.verdict, subjectMatch: a.subjectMatch, reason: a.reason, model: a.model }); } },
  { name: "script_submit_draft", description: "Nộp kịch bản SCRIPT theo cấu trúc trong skill script-writer. App chạy lint, critic và kiểm sự thật. Kết quả: held (sửa theo critique rồi nộp lại), returned_to_app (việc đã trả về app, không gọi stage_release), passed (gọi stage_complete để hoàn tất). Cần lease hợp lệ.", risk: "safe", argsSchema: ScriptSubmitSchema,
    summarize: () => "Nộp kịch bản agent", execute: async (raw, ctx) => { const a = ScriptSubmitSchema.parse(raw), { script, agent } = scriptServices(ctx); return script.submit(agent, a.jobId, a.leaseId, a.script); } },
  { name: "research_submit_notes", description: "Nộp notes nghiên cứu có nguồn cho stage RESEARCH. App kiểm đủ 6 fact, tối thiểu 60% có nguồn, quote tối đa 30 từ, và miền bị chặn trước khi ghi. Cần lease hợp lệ.", risk: "safe", argsSchema: ResearchSubmitSchema,
    summarize: () => "Nộp notes nghiên cứu agent", execute: async (raw, ctx) => { const a = ResearchSubmitSchema.parse(raw), { research, agent } = researchServices(ctx); return research.submit(agent, a.jobId, a.leaseId, a.notes); } },
  { name: "music_submit_candidates", description: "Nộp tối đa 8 bản nhạc ứng viên cho stage MUSIC_SEARCH. App kiểm giấy phép thương mại, URL công khai và miền bị chặn, tải và lưu từng bản; bản bị lỗi bị trả về riêng. Agent không chọn bản cuối cùng. Cần lease hợp lệ.", risk: "safe", argsSchema: MusicSubmitSchema,
    summarize: () => "Nộp ứng viên nhạc agent", execute: async (raw, ctx) => { const a = MusicSubmitSchema.parse(raw), { music, agent } = musicServices(ctx); return music.submit(agent, a.jobId, a.leaseId, { candidates: a.candidates }); } },
  { name: "visual_select", description: "Chọn ảnh đã được agent duyệt đúng SHA cho cảnh còn mở; giữ kiểm tra nguồn, bản quyền và ảnh trùng.", risk: "safe", argsSchema: VisualSelectSchema,
    summarize: () => "Chọn ảnh agent đã duyệt", execute: async (raw, ctx) => { const a = VisualSelectSchema.parse(raw), { visuals, agent } = services(ctx); return visuals.select(agent, a.jobId, a.leaseId, a.sceneId, a.candidateId); } },
];
