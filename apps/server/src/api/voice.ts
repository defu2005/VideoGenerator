import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { Project } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { projectDir } from "../storage/paths.js";
import type { AppConfig } from "../lib/config.js";
import type { TtsProviderRegistry } from "../providers/tts/registry.js";
import { markStaleFrom } from "../pipeline/invalidation.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { probeDurationSec } from "../media/ffmpeg.js";
import type { TtsCue } from "../providers/tts/types.js";
import { defaultVoiceFor } from "../lib/defaultVoice.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const SceneParams = z.object({ id: z.string().uuid(), sceneId: z.string().uuid() }).strict();
const TrackParams = z.object({ id: z.string().uuid(), trackId: z.string().uuid() }).strict();
const RegenerateBody = z.object({ voice: z.string().trim().max(200).optional(), rate: z.string().regex(/^[+-]\d{1,3}%$/).optional() }).strict();
const MAX_VOICE_BYTES = 25 * 1024 * 1024;
const VOICE_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};
type VoiceTrackRow = {
  id: string;
  project_id: string;
  scene_id: string;
  provider: string;
  voice: string;
  rate: string;
  origin: "AGENT" | "USER";
  audio_path: string;
  duration_sec: number;
  cues: string | TtsCue[];
  words?: string | TtsCue[];
  timing_source?: string;
  input_hash: string;
  created_at: string;
  updated_at: string;
};

function toVoiceTrack(track: VoiceTrackRow) {
  return {
    id: track.id,
    projectId: track.project_id,
    sceneId: track.scene_id,
    provider: track.provider,
    voice: track.voice,
    rate: track.rate,
    origin: track.origin,
    audioPath: track.audio_path,
    cues: typeof track.cues === "string" ? JSON.parse(track.cues) as TtsCue[] : track.cues,
    words: !track.words ? [] : typeof track.words === "string" ? JSON.parse(track.words) as TtsCue[] : track.words,
    timingSource: track.timing_source ?? "estimated",
    durationSec: Number(track.duration_sec),
    inputHash: track.input_hash,
    createdAt: track.created_at,
    updatedAt: track.updated_at,
  };
}

function parseRangeHeader(rangeHeader: string | undefined, size: number): { start: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= size) return null;
  return { start, end };
}

function projectVoiceTrackPath(config: AppConfig, projectId: string, sceneId: string, hash: string, extension: string): string {
  const base = join(projectDir(config.DATA_DIR, projectId), "voice");
  return join(base, `${sceneId}-${hash.slice(0, 8)}.${extension}`);
}

export function registerVoiceRoutes(
  app: FastifyInstance,
  registry: TtsProviderRegistry,
  db: Database.Database,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
  repository: JobRepository,
  config: AppConfig,
): void {
  app.get("/api/tts/voices", async (request) => {
    const query = z.object({
      provider: z.string().optional(),
      language: z.string().optional(),
      gender: z.enum(["female", "male", "neutral", "unknown"]).optional(),
    }).strict().parse(request.query ?? {});
    let voices = await registry.listVoices(query.provider);
    if (query.language) {
      const language = query.language.toLowerCase();
      voices = voices.filter((voice) => {
        const code = voice.language.toLowerCase();
        return code === "multi" || code === "*" || code.startsWith(language) || voice.multilingual;
      });
    }
    if (query.gender) voices = voices.filter((voice) => (voice.gender ?? "unknown") === query.gender);
    return {
      voices: voices.map((voice) => ({
        ...voice,
        multilingual: Boolean(voice.multilingual ?? /Multilingual/i.test(voice.name)),
      })),
    };
  });

  app.get("/api/projects/:id/voice", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const tracks = db.prepare("SELECT * FROM voice_tracks WHERE project_id = ? ORDER BY scene_id").all(id) as VoiceTrackRow[];
    const scenes = db.prepare("SELECT id, narration FROM scenes WHERE project_id = ? ORDER BY \"order\"").all(id) as Array<{ id: string; narration: string }>;
    const missingSceneIds = scenes
      .filter((scene) => scene.narration.trim().length > 0)
      .filter((scene) => !tracks.some((track) => track.scene_id === scene.id && existsSync(track.audio_path)))
      .map((scene) => scene.id);
    const plan = typeof registry.planVoice === "function" ? registry.planVoice(project) : null;
    return {
      voice: plan?.voice || project.settings.voice?.voice || null,
      rate: plan?.rate || project.settings.voice?.rate || null,
      provider: plan?.provider || config.TTS_PROVIDER,
      wordTimings: plan?.wordTimings ?? false,
      tracks: tracks.map(toVoiceTrack),
      totalDurationSec: tracks.reduce((sum, track) => sum + Number(track.duration_sec ?? 0), 0),
      missingSceneIds,
    };
  });

  app.get("/api/projects/:id/voice/:trackId/audio", async (request, reply) => {
    const { id, trackId } = TrackParams.parse(request.params);
    const row = db.prepare("SELECT * FROM voice_tracks WHERE id = ? AND project_id = ?").get(trackId, id) as VoiceTrackRow | undefined;
    if (!row) throw new AppError(404, "VOICE_TRACK_NOT_FOUND", "Voice track not found");
    const filePath = row.audio_path;
    if (!existsSync(filePath)) throw new AppError(404, "VOICE_TRACK_NOT_FOUND", "Audio file not found");
    const stat = statSync(filePath);
    const extension = filePath.split(".").at(-1)?.toLowerCase() ?? "mp3";
    const mimeType = VOICE_TYPES[extension] ?? "application/octet-stream";
    const range = parseRangeHeader(request.headers.range, stat.size);
    if (range) {
      reply.code(206);
      reply.header("Content-Type", mimeType);
      reply.header("Content-Length", String(range.end - range.start + 1));
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
      return reply.send(createReadStream(filePath, { start: range.start, end: range.end }));
    }
    reply.header("Content-Type", mimeType);
    reply.header("Content-Length", String(stat.size));
    reply.header("Accept-Ranges", "bytes");
    return reply.send(createReadStream(filePath));
  });

  app.post("/api/projects/:id/scenes/:sceneId/voice/regenerate", async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const scene = db.prepare("SELECT id, narration FROM scenes WHERE id = ? AND project_id = ?").get(sceneId, id) as { id: string; narration: string } | undefined;
    if (!scene) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
    const body = RegenerateBody.parse(request.body ?? {});
    const voices = await registry.listVoices();
    const voice = body.voice ?? project.settings.voice?.voice ?? defaultVoiceFor(project.settings.language, voices, config, () => undefined);
    const rate = body.rate ?? project.settings.voice?.rate ?? config.TTS_RATE;
    const provider = registry.resolve();
    const hash = createHash("sha256").update(`${scene.narration}\u0000${voice}\u0000${rate}\u0000${provider.id}`).digest("hex");
    const filePath = projectVoiceTrackPath(config, id, sceneId, hash, provider.id === "mock" ? "wav" : "mp3");
    const tracked = typeof registry.synthesizeTracked === "function"
      ? await registry.synthesizeTracked({ project, text: scene.narration, outPath: filePath, voice, rate, signal: new AbortController().signal })
      : null;
    const result = tracked ?? await provider.synthesize({ text: scene.narration, voice, rate, outPath: filePath, signal: new AbortController().signal });
    const now = new Date().toISOString();
    const narrationHash = createHash("sha256").update(scene.narration.trim()).digest("hex");
    const previous = db.prepare("SELECT audio_path FROM voice_tracks WHERE scene_id = ? AND project_id = ?").get(sceneId, id) as { audio_path: string } | undefined;
    const audioPath = tracked?.audioPath ?? filePath;
    db.prepare(`INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, words, timing_source, input_hash, narration_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'AGENT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scene_id) DO UPDATE SET provider=excluded.provider, voice=excluded.voice, rate=excluded.rate, origin='AGENT', audio_path=excluded.audio_path, duration_sec=excluded.duration_sec, cues=excluded.cues, words=excluded.words, timing_source=excluded.timing_source, input_hash=excluded.input_hash, narration_hash=excluded.narration_hash, updated_at=excluded.updated_at`).run(
      randomUUID(),
      id,
      sceneId,
      tracked?.providerId ?? provider.id,
      tracked?.voice ?? voice,
      tracked?.rate ?? rate,
      audioPath,
      result.durationSec,
      JSON.stringify(result.cues),
      JSON.stringify(result.words ?? []),
      result.timingSource ?? "estimated",
      hash,
      narrationHash,
      now,
      now,
    );
    if (previous && previous.audio_path !== audioPath) rmSync(previous.audio_path, { force: true });
    markStaleFrom(repository, id, "VOICE");
    const track = db.prepare("SELECT * FROM voice_tracks WHERE scene_id = ? AND project_id = ?").get(sceneId, id) as VoiceTrackRow;
    return toVoiceTrack(track);
  });

  app.post("/api/projects/:id/scenes/:sceneId/voice/upload", async (request) => {
    const { id, sceneId } = SceneParams.parse(request.params);
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    const scene = db.prepare("SELECT id, narration FROM scenes WHERE id = ? AND project_id = ?").get(sceneId, id) as { id: string; narration: string } | undefined;
    if (!scene) throw new AppError(404, "SCENE_NOT_FOUND", "Scene not found");
    const parsedUpload = parseVoiceUpload(request.body, request.headers["content-type"], request.headers["x-file-name"]);
    if (parsedUpload.bytes.length > MAX_VOICE_BYTES) throw new AppError(413, "PAYLOAD_TOO_LARGE", "Voice upload exceeds the 25 MB limit.");
    const extension = parsedUpload.extension;
    if (!VOICE_TYPES[extension]) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Voice upload must be MP3, WAV, M4A, or OGG.");
    const fileName = `${sceneId}-${randomUUID()}.${extension}`;
    const filePath = join(projectDir(config.DATA_DIR, id), "voice", fileName);
    mkdirSync(join(projectDir(config.DATA_DIR, id), "voice"), { recursive: true });
    writeFileSync(filePath, parsedUpload.bytes);
    const durationSec = await probeDurationSec(filePath, new AbortController().signal);
    const inputHash = createHash("sha256").update(parsedUpload.bytes).digest("hex");
    const narrationHash = createHash("sha256").update(scene.narration.trim()).digest("hex");
    const previous = db.prepare("SELECT audio_path FROM voice_tracks WHERE scene_id = ? AND project_id = ?").get(sceneId, id) as { audio_path: string } | undefined;
    const row = {
      id: randomUUID(),
      project_id: id,
      scene_id: sceneId,
      provider: "USER",
      voice: project.settings.voice?.voice ?? "user-upload",
      rate: project.settings.voice?.rate ?? "+0%",
      origin: "USER",
      audio_path: filePath,
      duration_sec: durationSec,
      cues: JSON.stringify([]),
      input_hash: inputHash,
      narration_hash: narrationHash,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    db.prepare(`INSERT INTO voice_tracks (id, project_id, scene_id, provider, voice, rate, origin, audio_path, duration_sec, cues, input_hash, narration_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scene_id) DO UPDATE SET provider=excluded.provider, voice=excluded.voice, rate=excluded.rate, origin='USER', audio_path=excluded.audio_path, duration_sec=excluded.duration_sec, cues=excluded.cues, input_hash=excluded.input_hash, narration_hash=excluded.narration_hash, updated_at=excluded.updated_at`).run(
      row.id,
      row.project_id,
      row.scene_id,
      row.provider,
      row.voice,
      row.rate,
      row.origin,
      row.audio_path,
      row.duration_sec,
      row.cues,
      row.input_hash,
      row.narration_hash,
      row.created_at,
      row.updated_at,
    );
    if (previous && previous.audio_path !== filePath) rmSync(previous.audio_path, { force: true });
    markStaleFrom(repository, id, "VOICE");
    const track = db.prepare("SELECT * FROM voice_tracks WHERE scene_id = ? AND project_id = ?").get(sceneId, id) as VoiceTrackRow;
    return toVoiceTrack(track);
  });
}

function parseVoiceUpload(
  body: unknown,
  contentTypeHeader: string | string[] | undefined,
  fileNameHeader: string | string[] | undefined,
): { bytes: Buffer; extension: string } {
  if (!Buffer.isBuffer(body)) throw new AppError(422, "VOICE_UPLOAD_INVALID", "Voice upload must contain audio bytes.");
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] ?? "" : contentTypeHeader ?? "";
  const headerName = Array.isArray(fileNameHeader) ? fileNameHeader[0] ?? "" : fileNameHeader ?? "";
  let bytes = body;
  let name = headerName;
  if (contentType.startsWith("multipart/form-data")) {
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)?.trim();
    if (!boundary) throw new AppError(422, "VOICE_UPLOAD_INVALID", "Multipart upload is missing its boundary.");
    const payload = body.toString("latin1");
    const filePart = payload.split(`--${boundary}`).find((part) => /content-disposition: form-data;[^\r\n]*filename=/i.test(part));
    if (!filePart) throw new AppError(422, "VOICE_UPLOAD_INVALID", "Multipart upload must include an audio file.");
    const separator = filePart.indexOf("\r\n\r\n");
    if (separator < 0) throw new AppError(422, "VOICE_UPLOAD_INVALID", "Multipart audio part is malformed.");
    const headers = filePart.slice(0, separator);
    name = headers.match(/filename="([^"]+)"/i)?.[1] ?? "";
    const raw = filePart.slice(separator + 4).replace(/\r\n$/, "");
    bytes = Buffer.from(raw, "latin1");
  }
  const extension = name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "" : "";
  if (!extension || !VOICE_TYPES[extension]) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Voice upload must be MP3, WAV, M4A, or OGG.");
  return { bytes, extension };
}
