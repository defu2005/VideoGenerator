import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppConfig } from "./lib/config.js";
import { AppError } from "./lib/errors.js";
import { openDatabase } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { createProjectService } from "./services/projectService.js";
import { registerDashboardRoutes } from "./api/dashboard.js";
import { registerHealthRoutes } from "./api/health.js";
import { registerProjectRoutes } from "./api/projects.js";
import { registerPipelineRoutes } from "./api/pipeline.js";
import { registerLlmRoutes } from "./api/llm.js";
import { registerScriptRoutes } from "./api/script.js";
import { registerRecommendationRoutes } from "./api/recommendations.js";
import { registerBudgetRoutes } from "./api/budget.js";
import { PipelineEventBus } from "./jobs/eventBus.js";
import { JobRepository } from "./jobs/jobRepository.js";
import { JobWorker } from "./jobs/worker.js";
import { createExecutorRegistry } from "./pipeline/executorRegistry.js";
import { PipelineOrchestrator } from "./pipeline/orchestrator.js";
import { LlmProviderRegistry } from "./providers/llm/registry.js";
import { ResearchExecutor } from "./stages/research/researchExecutor.js";
import { ScriptExecutor } from "./stages/script/scriptExecutor.js";
import { ScriptService } from "./services/scriptService.js";
import { SceneService } from "./services/sceneService.js";
import { registerSceneRoutes } from "./api/scenes.js";
import { ScenePlanExecutor } from "./stages/scenes/scenePlanExecutor.js";
import { VisualService } from "./services/visualService.js";
import { VisualSearchExecutor } from "./stages/visuals/visualSearchExecutor.js";
import { registerVisualRoutes } from "./api/visuals.js";
import { MAX_IMAGE_BYTES } from "./services/imageStore.js";
import { UsageService } from "./services/usageService.js";
import { registerUsageRoutes } from "./api/usage.js";
import { registerVoiceRoutes } from "./api/voice.js";
import { registerSubtitleRoutes } from "./api/subtitles.js";
import { TtsProviderRegistry } from "./providers/tts/registry.js";
import { VoiceExecutor } from "./stages/voice/voiceExecutor.js";
import { SubtitleExecutor } from "./stages/subtitle/subtitleExecutor.js";
import { MusicSearchExecutor } from "./stages/music/musicSearchExecutor.js";
import { registerMusicRoutes } from "./api/music.js";
import { MusicService } from "./services/musicService.js";
import { AudioStore, MAX_AUDIO_BYTES } from "./services/audioStore.js";
import { createMusicProviders } from "./providers/music/registry.js";
import { probeDurationSec } from "./media/ffmpeg.js";

export function buildApp({ config }: { config: AppConfig }) {
  const server = Fastify({
    logger: { level: config.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.addContentTypeParser(/^image\/(?:jpeg|png|webp|gif)$/, {
    parseAs: "buffer",
    bodyLimit: MAX_IMAGE_BYTES,
  }, (_request, body, done) => done(null, body));
  server.addContentTypeParser(/^(?:audio\/(?:mpeg|wav|x-wav|mp4|x-m4a|ogg|flac|x-flac)|multipart\/form-data)(?:;|$)/i, {
    parseAs: "buffer",
    bodyLimit: MAX_AUDIO_BYTES + 64 * 1024,
  }, (_request, body, done) => done(null, body));

  const database = openDatabase(config.DATABASE_PATH);
  try {
    migrateDatabase(database.db, server.log, database.sqlite);
  } catch (error) {
    database.sqlite.close();
    throw error;
  }
  const projectService = createProjectService(database.db, config, server.log);
  const events = new PipelineEventBus();
  const jobRepository = new JobRepository(database.sqlite, events);
  const usageService = new UsageService(database.sqlite, config.USD_VND_RATE);
  const visualService = new VisualService(database.sqlite, jobRepository, config, server.log);
  const musicService = new MusicService(
    database.sqlite,
    config,
    createMusicProviders(config),
    new AudioStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT),
    probeDurationSec,
  );
  const orchestrator = new PipelineOrchestrator(
    jobRepository,
    config,
    server.log,
    undefined,
    (project, gate) => gate === "VISUAL_REVIEW"
      ? visualService.canApproveVisualReview(project.id)
      : gate === "MUSIC_REVIEW"
        ? musicService.canApproveMusicReview(project)
        : { allowed: true },
  );
  const llmProviders = new LlmProviderRegistry(config);
  const ttsProviders = new TtsProviderRegistry(config);
  const scriptService = new ScriptService(database.sqlite, jobRepository, orchestrator, config);
  const sceneService = new SceneService(database.sqlite, jobRepository);
  const worker = new JobWorker(
    jobRepository,
    orchestrator,
    createExecutorRegistry(
      { delayMs: config.FAKE_STAGE_DELAY_MS },
      {
        RESEARCH: new ResearchExecutor(database.sqlite, llmProviders, config),
        SCRIPT: new ScriptExecutor(database.sqlite, llmProviders, config),
        SCENE_PLAN: new ScenePlanExecutor(database.sqlite, llmProviders, config),
        VISUAL_SEARCH: new VisualSearchExecutor(visualService, llmProviders),
        VOICE: new VoiceExecutor(database.sqlite, ttsProviders, config),
        SUBTITLE: new SubtitleExecutor(database.sqlite, config),
        MUSIC_SEARCH: new MusicSearchExecutor(musicService),
      },
    ),
    config,
    server.log,
  );

  server.register(cors, { origin: config.CORS_ORIGIN });
  registerHealthRoutes(server, database.sqlite);
  registerProjectRoutes(server, projectService);
  registerRecommendationRoutes(server);
  registerBudgetRoutes(server, projectService, jobRepository, config, llmProviders);
  registerDashboardRoutes(server, projectService);
  registerUsageRoutes(server, usageService, projectService);
  registerPipelineRoutes(server, projectService, jobRepository, orchestrator, events, sceneService);
  registerLlmRoutes(server, llmProviders, database.sqlite, projectService);
  registerScriptRoutes(server, scriptService, projectService, config);
  registerSceneRoutes(server, sceneService);
  registerVisualRoutes(server, visualService, jobRepository);
  registerVoiceRoutes(server, ttsProviders, database.sqlite, projectService, jobRepository, config);
  registerSubtitleRoutes(server, database.sqlite, jobRepository, config);
  registerMusicRoutes(server, musicService, projectService, jobRepository);

  server.addHook("onReady", async () => worker.start());
  server.addHook("onClose", async () => {
    await worker.stop();
    database.sqlite.close();
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
    }

    const fastifyError = error as Error & { validation?: unknown; statusCode?: number };
    if (error instanceof ZodError || fastifyError.validation !== undefined) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error instanceof ZodError ? error.issues : fastifyError.validation,
        },
      });
    }

    if (fastifyError.statusCode === 413 || fastifyError.statusCode === 415) {
      const tooLarge = fastifyError.statusCode === 413;
      return reply.code(fastifyError.statusCode).send({
        error: {
          code: tooLarge ? "PAYLOAD_TOO_LARGE" : "UNSUPPORTED_MEDIA_TYPE",
          message: tooLarge ? "Image upload exceeds the 25 MB limit." : "Upload must use JPEG, PNG, WebP, or GIF content type.",
        },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred",
      },
    });
  });

  return server;
}
