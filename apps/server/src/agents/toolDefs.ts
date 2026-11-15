import { z } from "zod";
import { PipelineStageSchema } from "@vg/shared";
import type { AssistantToolContext, AssistantToolDef } from "../assistant/tools.js";
import { currentActor } from "../auth/requestContext.js";
import { getKeyProfile, resolveTrustedAgent } from "../supervision/identity.js";
import { AppError } from "../lib/errors.js";
import { AgentVisualItemSchema, AgentVisualVerdictSchema } from "./visualToolkit.js";
import { AgentUsageSchema } from "./usage.js";

export const StageClaimSchema = z.object({ stages: z.array(PipelineStageSchema).min(1).optional(), projectId: z.uuid().optional(), profileId: z.uuid().optional() }).strict();
export const StageFenceShape = { jobId: z.uuid(), leaseId: z.uuid() };
export const StageHeartbeatSchema = z.object({ ...StageFenceShape, progress: z.number().min(0).max(99).optional(), note: z.string().max(300).optional() }).strict();
export const StageCompleteSchema = z.object({ ...StageFenceShape, summary: z.string().trim().min(1).max(1000), usage: AgentUsageSchema.optional() }).strict();
export const StageReleaseSchema = z.object({ ...StageFenceShape, reason: z.string().trim().min(1).max(500) }).strict();
export const VisualSubmitSchema = z.object({ ...StageFenceShape, sceneId: z.uuid(), items: z.array(AgentVisualItemSchema).min(1).max(12) }).strict();
export const VisualImageSchema = z.object({ candidateId: z.uuid(), maxSide: z.number().int().min(64).max(2048).default(768) }).strict();
export const VisualVerdictSchema = AgentVisualVerdictSchema.extend({ ...StageFenceShape, candidateId: z.uuid() }).strict();
export const VisualSelectSchema = z.object({ ...StageFenceShape, sceneId: z.uuid(), candidateId: z.uuid() }).strict();

function services(ctx: AssistantToolContext, fixedInstance = true) {
  if (!ctx.agentStages || !ctx.agentVisuals) throw new AppError(503, "AGENT_STAGES_UNAVAILABLE", "Bộ công cụ stage chưa sẵn sàng.");
  // Re-resolve the machine key: a caller-supplied kind/name is never authority.
  const actor = currentActor();
  const profile = getKeyProfile(ctx.sqlite, actor?.kind === "apikey" ? actor.keyId : null);
  if (fixedInstance && profile?.instanceName === "unknown") throw new AppError(403, "STAGE_AGENT_KEY_REQUIRED", "Khóa máy cần tên instance cố định trước khi nhận stage.");
  const agent = resolveTrustedAgent({ sqlite: ctx.sqlite, keyId: actor?.kind === "apikey" ? actor.keyId : null,
    headers: { "x-vg-agent-model": ctx.agent?.model ?? undefined, "x-vg-agent-environment": ctx.agent?.environment } });
  return { stages: ctx.agentStages, visuals: ctx.agentVisuals, agent };
}

export const agentStageToolDefs: AssistantToolDef[] = [
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
  { name: "visual_select", description: "Chọn ảnh đã được agent duyệt đúng SHA cho cảnh còn mở; giữ kiểm tra nguồn, bản quyền và ảnh trùng.", risk: "safe", argsSchema: VisualSelectSchema,
    summarize: () => "Chọn ảnh agent đã duyệt", execute: async (raw, ctx) => { const a = VisualSelectSchema.parse(raw), { visuals, agent } = services(ctx); return visuals.select(agent, a.jobId, a.leaseId, a.sceneId, a.candidateId); } },
];
