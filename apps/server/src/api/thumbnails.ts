import { createReadStream, statSync } from "node:fs";
import { z } from "zod";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ThumbnailRecomposeBodySchema, type Project } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { ThumbnailService } from "../services/thumbnailService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const ImageParams = z.object({
  id: z.string().uuid(),
  kind: z.string().min(1).max(40),
}).strict();

export function registerThumbnailRoutes(
  app: FastifyInstance,
  thumbnails: ThumbnailService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
): void {
  async function project(id: string): Promise<Project> {
    const found = await projectService.getProject(id);
    if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return found;
  }

  function sendImage(reply: FastifyReply, path: string | null) {
    if (!path) throw new AppError(404, "THUMBNAIL_NOT_FOUND", "Chưa có ảnh thumbnail này.");
    const size = statSync(path).size;
    const type = path.endsWith(".png") ? "image/png" : "image/jpeg";
    reply.header("Content-Type", type);
    reply.header("Content-Length", String(size));
    reply.header("Cache-Control", "no-cache");
    return reply.send(createReadStream(path));
  }

  app.get("/api/projects/:id/thumbnail", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    return thumbnails.state((await project(id)).id);
  });

  app.get("/api/projects/:id/thumbnail/image/:kind", async (request, reply) => {
    const { id, kind } = ImageParams.parse(request.params);
    await project(id);
    return sendImage(reply, thumbnails.imagePath(id, kind));
  });

  app.post("/api/projects/:id/thumbnail/recompose", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const found = await project(id);
    const body = ThumbnailRecomposeBodySchema.parse(request.body ?? {});
    return thumbnails.recompose(found, body, new AbortController().signal);
  });

  app.post("/api/projects/:id/thumbnail/regenerate", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const found = await project(id);
    return thumbnails.regenerate(found, new AbortController().signal);
  });

  app.post("/api/projects/:id/thumbnail/upload", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const found = await project(id);
    const type = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "image/png" && type !== "image/jpeg") {
      throw new AppError(400, "THUMBNAIL_TYPE", "Chỉ nhận PNG hoặc JPG.");
    }
    if (!Buffer.isBuffer(request.body)) {
      throw new AppError(400, "THUMBNAIL_TYPE", "Chỉ nhận PNG hoặc JPG.");
    }
    return thumbnails.upload(found, request.body, new AbortController().signal);
  });
}
