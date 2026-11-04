import { createReadStream, statSync } from "node:fs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { MusicSelectRequestSchema, MusicSettingsPatchSchema, type Project } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { AudioDownloadError } from "../services/audioStore.js";
import type { MusicService } from "../services/musicService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const CandidateParams = z.object({ id: z.string().uuid(), candidateId: z.string().uuid() }).strict();
const SearchBody = z.object({ query: z.string().max(200).nullable().optional() }).strict();

export function parseRangeHeader(rangeHeader: string | undefined, size: number): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    // Suffix range: the last N bytes.
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

/** Raw audio body, or the first file part of a multipart form. */
export function parseAudioUpload(
  body: unknown,
  contentTypeHeader: string | string[] | undefined,
  fileNameHeader: string | string[] | undefined,
): { bytes: Buffer; fileName: string } {
  if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError(422, "MUSIC_UPLOAD_INVALID", "Hãy gửi một tệp âm thanh.");
  const contentType = (Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader) ?? "";
  let fileName = decodeHeaderName((Array.isArray(fileNameHeader) ? fileNameHeader[0] : fileNameHeader) ?? "");
  if (!contentType.startsWith("multipart/form-data")) return { bytes: body, fileName: fileName || "music" };
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)?.trim();
  if (!boundary) throw new AppError(422, "MUSIC_UPLOAD_INVALID", "Multipart thiếu boundary.");
  const payload = body.toString("latin1");
  const part = payload.split(`--${boundary}`).find((chunk) => /content-disposition: form-data;[^\r\n]*filename=/i.test(chunk));
  if (!part) throw new AppError(422, "MUSIC_UPLOAD_INVALID", "Multipart phải có một tệp âm thanh.");
  const separator = part.indexOf("\r\n\r\n");
  if (separator < 0) throw new AppError(422, "MUSIC_UPLOAD_INVALID", "Phần tệp multipart bị hỏng.");
  fileName = Buffer.from(part.slice(0, separator).match(/filename="([^"]*)"/i)?.[1] ?? "", "latin1").toString("utf8") || fileName;
  return { bytes: Buffer.from(part.slice(separator + 4).replace(/\r\n$/, ""), "latin1"), fileName: fileName || "music" };
}

function decodeHeaderName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function registerMusicRoutes(
  app: FastifyInstance,
  music: MusicService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
  repository: JobRepository,
): void {
  async function requireProject(id: string): Promise<Project> {
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  app.get("/api/projects/:id/music", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    return music.getProjectMusic(await requireProject(id));
  });

  app.post("/api/projects/:id/music/search", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await requireProject(id);
    const body = SearchBody.parse(request.body ?? {});
    if (body.query !== undefined) music.updateSettings(project, { query: body.query });
    let outcome;
    try {
      outcome = await music.search(project, { force: true, warn: (message) => request.log.warn(message) });
    } catch (error) {
      if (error instanceof AudioDownloadError) throw new AppError(502, "MUSIC_SEARCH_FAILED", error.message);
      throw error;
    }
    if (outcome.candidates.length === 0 && outcome.failedProviders.length > 0) {
      throw new AppError(502, "MUSIC_SEARCH_FAILED", `Không tìm được nhạc: ${outcome.failedProviders.join(", ")} bị lỗi hoặc quá thời gian. Thử lại sau.`);
    }
    if (music.selectionRow(id)?.selected_by !== "USER") music.preselectTop(project);
    markStaleFrom(repository, id, "MUSIC_REVIEW");
    return music.getProjectMusic(project);
  });

  app.post("/api/projects/:id/music/select", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await requireProject(id);
    const { candidateId } = MusicSelectRequestSchema.parse(request.body ?? {});
    const result = await music.select(project, candidateId, "USER");
    markStaleFrom(repository, id, "MUSIC_REVIEW");
    return result;
  });

  app.post("/api/projects/:id/music/none", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const result = music.selectNone(await requireProject(id), "USER");
    markStaleFrom(repository, id, "MUSIC_REVIEW");
    return result;
  });

  app.patch("/api/projects/:id/music/settings", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const patch = MusicSettingsPatchSchema.parse(request.body ?? {});
    const result = music.updateSettings(await requireProject(id), patch);
    markStaleFrom(repository, id, "MUSIC_REVIEW");
    return result;
  });

  app.post("/api/projects/:id/music/upload", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await requireProject(id);
    const upload = parseAudioUpload(request.body, request.headers["content-type"], request.headers["x-file-name"]);
    const result = await music.upload(project, upload.bytes, upload.fileName);
    markStaleFrom(repository, id, "MUSIC_REVIEW");
    return result;
  });

  app.get("/api/projects/:id/music/:candidateId/audio", async (request, reply) => {
    const { id, candidateId } = CandidateParams.parse(request.params);
    const file = music.audioFile(id, candidateId);
    const size = statSync(file.path).size;
    const range = parseRangeHeader(request.headers.range, size);
    reply.header("Content-Type", file.mimeType);
    reply.header("Accept-Ranges", "bytes");
    if (request.headers.range && !range) {
      reply.code(416);
      reply.header("Content-Range", `bytes */${size}`);
      return reply.send();
    }
    if (range) {
      reply.code(206);
      reply.header("Content-Length", String(range.end - range.start + 1));
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      return reply.send(createReadStream(file.path, { start: range.start, end: range.end }));
    }
    reply.header("Content-Length", String(size));
    return reply.send(createReadStream(file.path));
  });
}
