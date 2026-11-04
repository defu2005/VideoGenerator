import { createReadStream, statSync } from "node:fs";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Project } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { RenderService } from "../services/renderService.js";
import { parseRangeHeader } from "./music.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const ThumbParams = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();

export function registerRenderRoutes(
  app: FastifyInstance,
  renders: RenderService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
): void {
  async function project(request: FastifyRequest): Promise<Project> {
    const { id } = ProjectParams.parse(request.params);
    const found = await projectService.getProject(id);
    if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return found;
  }

  function sendFile(request: FastifyRequest, reply: FastifyReply, path: string | null, type: string, downloadName?: string) {
    if (!path) throw new AppError(404, "RENDER_FILE_NOT_FOUND", "Chưa có tệp render này.");
    const size = statSync(path).size;
    reply.header("Content-Type", type);
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "no-cache");
    if (downloadName) reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    const range = parseRangeHeader(request.headers.range, size);
    if (request.headers.range && !range) {
      reply.code(416);
      reply.header("Content-Range", `bytes */${size}`);
      return reply.send();
    }
    if (range) {
      reply.code(206);
      reply.header("Content-Length", String(range.end - range.start + 1));
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      return reply.send(createReadStream(path, { start: range.start, end: range.end }));
    }
    reply.header("Content-Length", String(size));
    return reply.send(createReadStream(path));
  }

  const baseName = (title: string) => (title.replace(/[\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 80) || "video");

  app.get("/api/projects/:id/render", async (request) => renders.get((await project(request)).id));

  app.get("/api/projects/:id/render/video", async (request, reply) => {
    const found = await project(request);
    const download = (request.query as { download?: string } | undefined)?.download === "1";
    return sendFile(request, reply, renders.file(found.id, "video"), "video/mp4", download ? `${baseName(found.title)}.mp4` : undefined);
  });

  app.get("/api/projects/:id/render/credits", async (request, reply) => {
    const found = await project(request);
    return sendFile(request, reply, renders.file(found.id, "credits"), "text/plain; charset=utf-8", `${baseName(found.title)} - credits.txt`);
  });

  app.get("/api/projects/:id/render/subtitles", async (request, reply) => {
    const found = await project(request);
    return sendFile(request, reply, renders.file(found.id, "subtitles"), "application/x-subrip; charset=utf-8", `${baseName(found.title)}.srt`);
  });

  app.get("/api/projects/:id/render/thumbs/:sceneId", async (request, reply) => {
    const { id, sceneId } = ThumbParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return sendFile(request, reply, renders.file(id, "thumb", sceneId), "image/jpeg");
  });
}
