import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import {
  RenderSettingsSchema,
  RenderVersionListSchema,
  RenderVersionPatchSchema,
  RenderVersionSchema,
  type Project,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { createZipStream } from "../lib/zip.js";
import { getRenderSettings, saveRenderSettings } from "../settings/render.js";
import type { RenderService } from "../services/renderService.js";
import type { AutoReportService } from "../services/autoReportService.js";
import { parseRangeHeader } from "./music.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const ThumbParams = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const RenderParams = z.object({ id: z.string().uuid(), renderId: z.string().uuid() }).strict();
const VersionThumbParams = z.object({ id: z.string().uuid(), renderId: z.string().uuid(), sceneId: z.string().uuid() }).strict();

export function registerRenderRoutes(
  app: FastifyInstance,
  renders: RenderService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
  sqlite?: Database.Database,
  autoReport?: AutoReportService,
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

  app.get("/api/projects/:id/renders", async (request) => {
    const found = await project(request);
    return RenderVersionListSchema.parse(renders.list(found.id));
  });

  app.get("/api/projects/:id/renders/:renderId", async (request) => {
    const { id, renderId } = RenderParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return RenderVersionSchema.parse(renders.getVersion(id, renderId));
  });

  app.get("/api/projects/:id/renders/:renderId/video", async (request, reply) => {
    const { id, renderId } = RenderParams.parse(request.params);
    const found = await projectService.getProject(id);
    if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const download = (request.query as { download?: string } | undefined)?.download === "1";
    return sendFile(request, reply, renders.file(id, "video", undefined, renderId), "video/mp4", download ? `${baseName(found.title)}.mp4` : undefined);
  });

  app.get("/api/projects/:id/renders/:renderId/credits", async (request, reply) => {
    const { id, renderId } = RenderParams.parse(request.params);
    const found = await projectService.getProject(id);
    if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return sendFile(request, reply, renders.file(id, "credits", undefined, renderId), "text/plain; charset=utf-8", `${baseName(found.title)} - credits.txt`);
  });

  app.get("/api/projects/:id/renders/:renderId/subtitles", async (request, reply) => {
    const { id, renderId } = RenderParams.parse(request.params);
    const found = await projectService.getProject(id);
    if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return sendFile(request, reply, renders.file(id, "subtitles", undefined, renderId), "application/x-subrip; charset=utf-8", `${baseName(found.title)}.srt`);
  });

  app.get("/api/projects/:id/renders/:renderId/thumbs/:sceneId", async (request, reply) => {
    const { id, renderId, sceneId } = VersionThumbParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return sendFile(request, reply, renders.file(id, "thumb", sceneId, renderId), "image/jpeg");
  });

  app.patch("/api/projects/:id/renders/:renderId", async (request) => {
    const { id, renderId } = RenderParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const body = RenderVersionPatchSchema.parse(request.body);
    return RenderVersionSchema.parse(renders.patch(id, renderId, body));
  });

  app.delete("/api/projects/:id/renders/:renderId", async (request) => {
    const { id, renderId } = RenderParams.parse(request.params);
    if (!await projectService.getProject(id)) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return RenderVersionSchema.parse(renders.deleteVersion(id, renderId));
  });

  app.get("/api/projects/:id/renders/:renderId/export", async (request, reply) => {
    const { id, renderId } = RenderParams.parse(request.params);
    const found = await projectService.getProject(id);
    if (!found) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const paths = renders.exportPaths(id, renderId);
    const title = baseName(found.title);
    const staging = join(tmpdir(), `vg-export-${randomUUID()}`);
    mkdirSync(staging, { recursive: true });
    const metadataPath = join(staging, "metadata.txt");
    const reportPath = join(staging, "render-report.json");
    writeFileSync(metadataPath, renders.metadataTextForExport(id, renderId, found.title), "utf8");
    writeFileSync(reportPath, JSON.stringify(paths.report, null, 2), "utf8");
    const autoReportPayload = autoReport?.responseFor(id);
    const autoReportPath = autoReportPayload && autoReportPayload.groups.length > 0
      ? join(staging, "auto-report.json")
      : null;
    if (autoReportPath && autoReportPayload) {
      writeFileSync(autoReportPath, JSON.stringify(autoReportPayload, null, 2), "utf8");
    }
    const entries = [
      { name: `${title}.mp4`, path: paths.video },
      ...(paths.subtitles ? [{ name: `${title}.srt`, path: paths.subtitles }] : []),
      ...(paths.credits ? [{ name: "credits.txt", path: paths.credits }] : []),
      { name: "metadata.txt", path: metadataPath },
      { name: "render-report.json", path: reportPath },
      ...(autoReportPath ? [{ name: "auto-report.json", path: autoReportPath }] : []),
    ];
    const zipName = `${title} - v${paths.version}.zip`;
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    reply.header("Cache-Control", "no-cache");
    const stream = createZipStream(entries);
    const cleanup = () => rmSync(staging, { recursive: true, force: true });
    stream.once("close", cleanup);
    reply.raw.once("close", () => { stream.destroy(); cleanup(); });
    stream.on("error", (error) => {
      if (error.name === "EXPORT_TOO_LARGE") {
        if (!reply.sent) {
          reply.code(413).send({ error: { code: "EXPORT_TOO_LARGE", message: "Tệp quá lớn để xuất zip (giới hạn 4 GB)." } });
        }
        return;
      }
      if (!reply.sent) reply.code(500).send({ error: { code: "EXPORT_FAILED", message: error.message } });
    });
    return reply.send(stream);
  });

  if (sqlite) {
    app.get("/api/settings/render", async () => getRenderSettings(sqlite));
    app.put("/api/settings/render", async (request) => {
      const body = RenderSettingsSchema.parse(request.body);
      return saveRenderSettings(sqlite, body);
    });
  }
}
