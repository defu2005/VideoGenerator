import { readFileSync } from "node:fs";
import { z } from "zod";
import type { AssistantToolContext, AssistantToolDef } from "../assistant/tools.js";
import { AppError } from "../lib/errors.js";
import { PREVIEW_MAX_LONG_SIDE, type PreviewResult } from "./service.js";

const LongSide = z.number().int().min(160).max(PREVIEW_MAX_LONG_SIDE).optional();

export const PreviewFrameArgs = z.object({
  projectId: z.string().uuid(),
  atSec: z.number().min(0).max(36_000).optional(),
  sceneId: z.string().uuid().optional(),
  offsetSec: z.number().min(0).max(600).optional(),
  longSide: LongSide,
}).strict().refine((args) => args.atSec !== undefined || args.sceneId !== undefined, "Cần atSec hoặc sceneId.");

export const PreviewSheetArgs = z.object({
  projectId: z.string().uuid(),
  sceneId: z.union([z.literal("all"), z.string().uuid()]).default("all"),
  longSide: LongSide,
}).strict();

export const PreviewClipArgs = z.object({
  projectId: z.string().uuid(),
  sceneId: z.string().uuid(),
  startSec: z.number().min(0).max(600).optional(),
  durationSec: z.number().min(0.2).max(3).optional(),
  longSide: LongSide,
}).strict();

function service(ctx: AssistantToolContext) {
  if (!ctx.preview) throw new AppError(503, "PREVIEW_UNAVAILABLE", "Dịch vụ xem trước chưa sẵn sàng.");
  return ctx.preview;
}

/** Result for agents: file id, API URL, facts, and (frames and sheets) an MCP image block. */
function shape(ctx: AssistantToolContext, projectId: string, result: PreviewResult): unknown {
  const base = {
    kind: result.kind, basis: result.basis, notes: result.notes, cached: result.cached, elapsedMs: result.elapsedMs,
    file: result.file, width: result.width, height: result.height,
    warnings: result.warnings, facts: result.facts, tiles: result.tiles,
    atSec: result.atSec, sceneId: result.sceneId, durationSec: result.durationSec,
  };
  if (result.file.mime !== "image/jpeg") return base;
  const path = service(ctx).filePath(projectId, result.file.name);
  if (!path) return base;
  return { ...base, content: [{ type: "image", mimeType: "image/jpeg", data: readFileSync(path).toString("base64") }] };
}

/** Read-only: previews never change stage state or input versions. */
export const previewToolDefs: AssistantToolDef[] = [
  {
    name: "preview_frame", risk: "read", argsSchema: PreviewFrameArgs,
    description: "Khung tại atSec hoặc sceneId+offsetSec; trả ảnh, facts và cảnh báo. Không đổi stage.",
    summarize: () => "Xem trước một khung hình",
    execute: async (raw, ctx) => {
      const args = PreviewFrameArgs.parse(raw);
      return shape(ctx, args.projectId, await service(ctx).frame(args.projectId, args));
    },
  },
  {
    name: "preview_contact_sheet", risk: "read", argsSchema: PreviewSheetArgs,
    description: "Lưới đầu/giữa/cuối từng shot; sceneId=all cho cả video. Trả ảnh và facts.",
    summarize: () => "Xem trước contact sheet",
    execute: async (raw, ctx) => {
      const args = PreviewSheetArgs.parse(raw);
      return shape(ctx, args.projectId, await service(ctx).contactSheet(args.projectId, args));
    },
  },
  {
    name: "preview_clip", risk: "read", argsSchema: PreviewClipArgs,
    description: "Clip cảnh ≤3 giây có giọng và phụ đề; trả URL mp4 và facts.",
    summarize: () => "Xem trước clip ngắn",
    execute: async (raw, ctx) => {
      const args = PreviewClipArgs.parse(raw);
      return shape(ctx, args.projectId, await service(ctx).clip(args.projectId, args));
    },
  },
];
