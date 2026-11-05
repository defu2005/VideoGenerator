import { z } from "zod";
import { ReframeModeSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type { ClipService } from "../services/clipService.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();

const ProposeBody = z.object({
  count: z.number().int().min(1).max(8).optional(),
  minSec: z.number().min(15).max(90).optional(),
  maxSec: z.number().min(15).max(90).optional(),
  reframe: ReframeModeSchema.optional(),
}).strict();

const EditBody = z.object({
  proposals: z.array(z.object({
    id: z.string().uuid(),
    start: z.number().nonnegative().optional(),
    end: z.number().positive().optional(),
    hook: z.string().max(60).optional(),
    title: z.string().min(1).max(120).optional(),
    selected: z.boolean().optional(),
  }).strict()).min(1),
}).strict();

const ExportBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(8),
}).strict();

const ImportBody = z.object({
  videoPath: z.string().trim().min(1).max(1000),
  title: z.string().trim().min(1).max(200).optional(),
  transcript: z.string().max(2_000_000).optional(),
  transcriptFormat: z.enum(["srt", "vtt", "plain"]).optional(),
  ownershipConfirmed: z.boolean(),
  profileId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(8).optional(),
  minSec: z.number().min(15).max(90).optional(),
  maxSec: z.number().min(15).max(90).optional(),
  reframe: ReframeModeSchema.optional(),
}).strict();

const SpeechBody = z.object({
  tool: z.enum(["whisper", "whisper.cpp", "faster-whisper"]).nullable().optional(),
  path: z.string().max(500).optional(),
  args: z.string().max(500).optional(),
}).strict();

export function registerClipRoutes(app: FastifyInstance, clips: ClipService): void {
  app.get("/api/projects/:id/clips", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    return clips.view(id);
  });

  app.post("/api/projects/:id/clips/propose", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const body = ProposeBody.parse(request.body ?? {});
    return clips.propose(id, body);
  });

  app.patch("/api/projects/:id/clips", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const body = EditBody.parse(request.body);
    return clips.updateProposals(id, body.proposals);
  });

  app.post("/api/projects/:id/clips/export", async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const body = ExportBody.parse(request.body);
    return clips.exportClips(id, body.ids);
  });

  app.post("/api/clips/import", async (request) => {
    const body = ImportBody.parse(request.body);
    return clips.importExternal(body);
  });

  app.get("/api/settings/speech-to-text", async () => clips.speechSettings());

  app.put("/api/settings/speech-to-text", async (request) => clips.saveSpeechSettings(SpeechBody.parse(request.body ?? {})));

  app.post("/api/settings/speech-to-text/detect", async (request) => clips.detectSpeech(SpeechBody.parse(request.body ?? {})));
}
