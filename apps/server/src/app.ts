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
import { getLlmGatewaySettings } from "./providers/llm/gatewaySettings.js";
import { ResearchExecutor } from "./stages/research/researchExecutor.js";
import { ScriptExecutor } from "./stages/script/scriptExecutor.js";
import { ScriptService } from "./services/scriptService.js";
import { SceneService } from "./services/sceneService.js";
import { registerSceneRoutes } from "./api/scenes.js";
import { ScenePlanExecutor } from "./stages/scenes/scenePlanExecutor.js";
import { VisualService } from "./services/visualService.js";
import { VisualSearchExecutor } from "./stages/visuals/visualSearchExecutor.js";
import { registerVisualRoutes } from "./api/visuals.js";
import { registerWebImageSettingsRoutes } from "./api/webImageSettings.js";
import { registerImageSourcesSettingsRoutes } from "./api/imageSourcesSettings.js";
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
import { TimelineService } from "./services/timelineService.js";
import { TimelineExecutor } from "./stages/timeline/timelineExecutor.js";
import { registerTimelineRoutes } from "./api/timeline.js";
import { RenderService } from "./services/renderService.js";
import { RenderExecutor } from "./stages/render/renderExecutor.js";
import { registerRenderRoutes } from "./api/render.js";
import { MetadataService } from "./services/metadataService.js";
import { registerMetadataRoutes } from "./api/metadata.js";
import { ReviewService } from "./review/service.js";
import { registerReviewRoutes } from "./api/review.js";
import { AudioStore, MAX_AUDIO_BYTES } from "./services/audioStore.js";
import { createMusicProviders } from "./providers/music/registry.js";
import { probeDurationSec } from "./media/ffmpeg.js";
import { GuidelineService } from "./guidelines/service.js";
import { registerGuidelineRoutes } from "./api/guidelines.js";
import { AutoReportService } from "./services/autoReportService.js";
import { registerAutoReportRoutes } from "./api/autoReport.js";
import { createProfileService } from "./services/profileService.js";
import { registerProfileRoutes } from "./api/profiles.js";
import { TokenVault } from "./publishing/tokenVault.js";
import { createPublisherRegistry } from "./publishing/registry.js";
import { FacebookReelsPublisher } from "./publishing/facebookReelsPublisher.js";
import { InstagramReelsPublisher } from "./publishing/instagramReelsPublisher.js";
import { OAuthStateStore } from "./publishing/oauthState.js";
import { PublishService } from "./publishing/publishService.js";
import { PublishTicker } from "./publishing/ticker.js";
import { TikTokPublisher } from "./publishing/tiktokPublisher.js";
import { YouTubePublisher } from "./publishing/youtubePublisher.js";
import { PublishExecutor } from "./stages/publish/publishExecutor.js";
import { registerOAuthRoutes } from "./api/oauth.js";
import { registerPublicationRoutes } from "./api/publications.js";
import { createTopicService } from "./services/topicService.js";
import { createAutomationService, setAutomationNotify } from "./services/automationService.js";
import { getAutomationPaused, setAutomationPausedNotify } from "./services/automationSettings.js";
import { registerAutomationRoutes } from "./api/automation.js";
import { NotificationService } from "./notifications/notificationService.js";
import { TelegramPoller } from "./notifications/telegram.js";
import { registerNotificationRoutes } from "./api/notifications.js";
import { AssistantService } from "./assistant/service.js";
import { installAssistantTelegramHandlers } from "./assistant/telegramBridge.js";
import { registerAssistantRoutes } from "./api/assistant.js";

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
  const profileService = createProfileService(database.db);
  const projectService = createProjectService(database.db, config, server.log, database.sqlite, profileService);
  const guidelineService = new GuidelineService(database.sqlite);
  const autoReportService = new AutoReportService(database.sqlite);
  const events = new PipelineEventBus();
  const jobRepository = new JobRepository(database.sqlite, events);
  const usageService = new UsageService(database.sqlite, config.USD_VND_RATE);
  const visualService = new VisualService(database.sqlite, jobRepository, config, server.log, {
    autoReport: autoReportService,
  });
  const musicService = new MusicService(
    database.sqlite,
    config,
    createMusicProviders(config),
    new AudioStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT),
    probeDurationSec,
  );
  const timelineService = new TimelineService(database.sqlite, config);
  const llmProviders = new LlmProviderRegistry(config);
  llmProviders.setGatewaySettingsLoader(() => getLlmGatewaySettings(database.sqlite));
  const renderService = new RenderService(database.sqlite, config, timelineService, undefined, undefined, llmProviders, autoReportService);
  const metadataService = new MetadataService(database.sqlite, config, llmProviders, timelineService, renderService);
  const orchestrator = new PipelineOrchestrator(
    jobRepository,
    config,
    server.log,
    undefined,
    (project, gate) => gate === "VISUAL_REVIEW"
      ? visualService.canApproveVisualReview(project.id)
      : gate === "MUSIC_REVIEW"
        ? musicService.canApproveMusicReview(project)
        : gate === "FINAL_APPROVAL"
          ? timelineService.canApproveFinal(project.id)
          : { allowed: true },
    (project, gate) => {
      // AUTO never pauses for content issues — record decisions and continue.
      if (project.mode === "AUTO" && guidelineService.openMustCount(project.id) > 0) {
        autoReportService.clearStage(project.id, "SCRIPT");
        for (const finding of guidelineService.listFindings(project.id)) {
          if (finding.status !== "OPEN" || finding.severity !== "MUST") continue;
          autoReportService.add(project.id, {
            stage: "SCRIPT",
            sceneId: finding.sceneId,
            code: "MUST_FINDING_OPEN",
            severity: "WARN",
            message: `MUST còn mở (${finding.ruleId}): ${finding.text}`,
            data: { ruleId: finding.ruleId, text: finding.text },
          });
        }
      }
      void gate;
      return null;
    },
  );
  const ttsProviders = new TtsProviderRegistry(config);
  const scriptService = new ScriptService(database.sqlite, jobRepository, orchestrator, config);
  const sceneService = new SceneService(database.sqlite, jobRepository);
  const reviewService = new ReviewService(
    database.sqlite,
    jobRepository,
    config,
    llmProviders,
    sceneService,
    visualService,
    musicService,
    timelineService,
    guidelineService,
    metadataService,
  );
  const tokenVault = new TokenVault(database.sqlite, config.DATA_DIR, config.TOKEN_ENCRYPTION_KEY);
  const youtubePublisher = new YouTubePublisher({
    config,
    vault: tokenVault,
    sqlite: database.sqlite,
  });
  const tiktokPublisher = new TikTokPublisher({
    config,
    vault: tokenVault,
    sqlite: database.sqlite,
  });
  const facebookReelsPublisher = new FacebookReelsPublisher({
    config,
    vault: tokenVault,
    sqlite: database.sqlite,
  });
  const instagramReelsPublisher = new InstagramReelsPublisher({
    config,
    vault: tokenVault,
    sqlite: database.sqlite,
  });
  const { registry: publisherRegistry, mock: mockPublisher } = createPublisherRegistry({
    enableMock: config.LLM_ENABLE_MOCK,
    youtube: youtubePublisher,
    tiktok: tiktokPublisher,
    facebookReels: facebookReelsPublisher,
    instagramReels: instagramReelsPublisher,
  });
  const oauthState = new OAuthStateStore();
  const publishService = new PublishService(
    database.sqlite,
    config,
    tokenVault,
    publisherRegistry,
    jobRepository,
    renderService,
  );
  const publishTicker = new PublishTicker(publishService, server.log);
  const topicService = createTopicService(database.db, database.sqlite, profileService, llmProviders);
  const automationService = createAutomationService({
    db: database.db,
    sqlite: database.sqlite,
    profiles: profileService,
    projects: projectService,
    topics: topicService,
    orchestrator,
    publish: publishService,
    render: renderService,
    logger: server.log,
  });
  publishTicker.setAutomation(automationService);
  const notificationService = new NotificationService({
    sqlite: database.sqlite,
    vault: tokenVault,
    config,
    logger: server.log,
    usage: usageService,
  });
  const telegramPoller = new TelegramPoller({
    sqlite: database.sqlite,
    vault: tokenVault,
    logger: server.log,
    workerEnabled: config.WORKER_ENABLED,
    getAutomationStatusText: async () => {
      const status = await automationService.getStatus();
      const paused = getAutomationPaused(database.sqlite);
      const lines = [
        `<b>Tự động hoá</b>: ${paused ? "⏸ tạm dừng" : "đang chạy"}`,
        ...status.profiles.slice(0, 8).map((p) =>
          `• ${p.profileName}: ${p.enabled ? "bật" : "tắt"} · hôm nay ${p.todayCount}`
        ),
      ];
      if (status.profiles.length === 0) lines.push("— chưa có hồ sơ");
      return lines.join("\n");
    },
  });
  const assistantService = new AssistantService(
    database.db,
    database.sqlite,
    config,
    llmProviders,
    profileService,
    projectService,
    topicService,
    automationService,
    orchestrator,
    publishService,
    usageService,
    sceneService,
  );
  installAssistantTelegramHandlers(telegramPoller, assistantService, {
    sqlite: database.sqlite,
    getAutomationStatusText: async () => {
      const status = await automationService.getStatus();
      const paused = getAutomationPaused(database.sqlite);
      const lines = [
        `<b>Tự động hoá</b>: ${paused ? "⏸ tạm dừng" : "đang chạy"}`,
        ...status.profiles.slice(0, 8).map((p) =>
          `• ${p.profileName}: ${p.enabled ? "bật" : "tắt"} · hôm nay ${p.todayCount}`
        ),
      ];
      if (status.profiles.length === 0) lines.push("— chưa có hồ sơ");
      return lines.join("\n");
    },
  });
  notificationService.setWaitingApprovalButtons((event) => {
    const action = assistantService.createPendingApproveGate({
      projectId: event.projectId,
      gate: event.gate,
      projectTitle: event.project,
    });
    return [[{ text: "Duyệt", data: `pa:${action.id}:y` }]];
  });
  publishService.setNotificationService(notificationService);
  orchestrator.setNotificationService(notificationService);
  publishTicker.setNotifications(notificationService);
  setAutomationNotify((event) => {
    void notificationService.notify(event);
  });
  setAutomationPausedNotify(() => {
    void notificationService.notify({ kind: "automation_paused" });
  });
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
        MUSIC_SEARCH: new MusicSearchExecutor(musicService, database.sqlite, llmProviders, config, autoReportService),
        TIMELINE: new TimelineExecutor(timelineService, guidelineService, metadataService),
        RENDER: new RenderExecutor(renderService),
        PUBLISH: new PublishExecutor(publishService),
      },
    ),
    config,
    server.log,
  );
  server.decorate("vgPublish", {
    mock: mockPublisher,
    youtube: youtubePublisher,
    tiktok: tiktokPublisher,
    facebookReels: facebookReelsPublisher,
    instagramReels: instagramReelsPublisher,
    service: publishService,
    vault: tokenVault,
    ticker: publishTicker,
    oauthState,
    worker,
    registry: publisherRegistry,
  });
  server.decorate("vgAutomation", {
    service: automationService,
    topics: topicService,
  });
  server.decorate("vgNotifications", {
    service: notificationService,
    poller: telegramPoller,
  });
  server.decorate("vgAssistant", {
    service: assistantService,
  });

  server.register(cors, { origin: config.CORS_ORIGIN });
  registerHealthRoutes(server, database.sqlite);
  registerProjectRoutes(server, projectService);
  registerProfileRoutes(server, profileService);
  registerAutomationRoutes(server, {
    topics: topicService,
    automation: automationService,
    sqlite: database.sqlite,
  });
  registerOAuthRoutes(server, { publish: publishService, registry: publisherRegistry, oauthState });
  registerPublicationRoutes(server, { publish: publishService, vault: tokenVault });
  registerRecommendationRoutes(server);
  registerBudgetRoutes(server, projectService, jobRepository, config, llmProviders);
  registerDashboardRoutes(server, projectService, automationService);
  registerUsageRoutes(server, usageService, projectService);
  registerPipelineRoutes(server, projectService, jobRepository, orchestrator, events, sceneService);
  registerLlmRoutes(server, llmProviders, database.sqlite, projectService, profileService);
  registerScriptRoutes(server, scriptService, projectService, config, guidelineService, database.sqlite);
  registerGuidelineRoutes(server, database.sqlite, projectService, guidelineService, llmProviders, config);
  registerSceneRoutes(server, sceneService);
  registerVisualRoutes(server, visualService, jobRepository, llmProviders);
  registerWebImageSettingsRoutes(server, database.sqlite, config);
  registerImageSourcesSettingsRoutes(server, database.sqlite, config);
  registerNotificationRoutes(server, {
    sqlite: database.sqlite,
    vault: tokenVault,
    notifications: notificationService,
    poller: telegramPoller,
  });
  registerAssistantRoutes(server, assistantService);
  registerVoiceRoutes(server, ttsProviders, database.sqlite, projectService, jobRepository, config);
  registerSubtitleRoutes(server, database.sqlite, jobRepository, config);
  registerMusicRoutes(server, musicService, projectService, jobRepository);
  registerTimelineRoutes(server, timelineService, projectService);
  registerRenderRoutes(server, renderService, projectService, database.sqlite, autoReportService, orchestrator);
  registerMetadataRoutes(server, metadataService, projectService);
  registerAutoReportRoutes(server, autoReportService, projectService);
  registerReviewRoutes(server, reviewService, projectService);

  server.addHook("onReady", async () => {
    await worker.start();
    if (config.WORKER_ENABLED) {
      publishTicker.start();
      telegramPoller.start();
    }
  });
  server.addHook("onClose", async () => {
    await telegramPoller.stop();
    await publishTicker.stop();
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
