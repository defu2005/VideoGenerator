import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AppError } from "../lib/errors.js";
import type { PreviewService } from "../preview/service.js";
import { PreviewClipArgs, PreviewFrameArgs, PreviewSheetArgs } from "../preview/toolDefs.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const FileParams = z.object({ id: z.string().uuid(), name: z.string().max(80) }).strict();

/** TASK-139: fast previews. POST needs project.read only: nothing here changes a stage or an input version. */
export function registerPreviewRoutes(app: FastifyInstance, preview: PreviewService): void {
  const body = (request: { body: unknown }, id: string) => ({ ...(request.body as object | undefined), projectId: id });

  app.post("/api/projects/:id/preview/frame", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const args = PreviewFrameArgs.parse(body(request, id));
    return preview.frame(id, args);
  });

  app.post("/api/projects/:id/preview/contact-sheet", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const args = PreviewSheetArgs.parse(body(request, id));
    return preview.contactSheet(id, args);
  });

  app.post("/api/projects/:id/preview/clip", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const args = PreviewClipArgs.parse(body(request, id));
    return preview.clip(id, args);
  });

  app.get("/api/projects/:id/preview/files/:name", async (request, reply) => {
    const { id, name } = FileParams.parse(request.params);
    const file = preview.openFile(id, name);
    if (!file) throw new AppError(404, "PREVIEW_FILE_NOT_FOUND", "Tệp xem trước đã hết hạn hoặc không tồn tại.");
    reply.header("content-type", file.mime).header("content-length", file.bytes).header("cache-control", "private, max-age=3600");
    return reply.send(file.stream);
  });
}
