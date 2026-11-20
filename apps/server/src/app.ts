import { enqueueIndex, initializeRetrieval } from "./retrieval/service.js";
import { dependentStages, isSecretId, STAGE_ORDER } from "@vg/shared";
import { randomUUID } from "node:crypto";
import { findingWillOpen, publishFindingOpened } from "./operator/findingEvents.js";
import { statfsSync } from "node:fs";
import { AutonomySupervisor } from "./operator/supervisor.js";
import { summarizeDigest } from "./operator/digestLine.js";
import { recoverMissedPublications } from "./publishing/recoverSchedule.js";
import { setEmbeddingRegistry } from "./retrieval/embeddings.js";
import { registerRetrievalRoutes } from "./api/retrieval.js";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { AppConfig } from "./lib/config.js";
import { AppError } from "./lib/errors.js";
import type { AuthActor } from "./auth/actor.js";
import { installAuth } from "./auth/install.js";
import { trustedOrigins } from "./auth/origins.js";
import { openDatabase } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { createProjectService } from "./services/projectService.js";
import { registerDashboardRoutes } from "./api/dashboard.js";
import { registerHealthRoutes } from "./api/health.js";
import { registerProjectRoutes } from "./api/projects.js";
import { registerStageTimeoutRoutes } from "./api/stageTimeouts.js";
import { registerOverdueRoutes } from "./api/overdue.js";
import { registerPipelineRoutes } from "./api/pipeline.js";
import { registerLlmRoutes } from "./api/llm.js";
import { registerLlmRelayRoutes } from "./api/llmRelay.js";
import { registerStorageSettingsRoutes } from "./api/storageSettings.js";
import { LlmRelay } from "./providers/llm/relay.js";
import { registerCapabilityProbeRoutes } from "./api/capabilityProbe.js";
import { registerScriptRoutes } from "./api/script.js";
import { registerRecommendationRoutes } from "./api/recommendations.js";
import { registerBudgetRoutes } from "./api/budget.js";
import { PipelineEventBus } from "./jobs/eventBus.js";
import { JobRepository } from "./jobs/jobRepository.js";
import { projectDir } from "./storage/paths.js";
import { BlobStore } from "./storage/blobStore.js";
import { FileGc } from "./storage/fileGc.js";
import { writeDiskPressure } from "./storage/diskPressure.js";
import { StorageSettingsStore } from "./storage/settings.js";
import { recordStorageHealth, storageHealth } from "./storage/health.js";
import { JobWorker } from "./jobs/worker.js";
import { ResourceGovernor, createSystemSampler } from "./jobs/resourceGovernor.js";
import { registerResourceRoutes } from "./api/resources.js";
import { registerAdminDbStatsRoutes } from "./api/adminDbStats.js";
import { flushAuditQueue } from "./auth/auditLog.js";
import { autonomyBudgetStatus, heldAutonomyUsd } from "./operator/autonomyBudget.js";
import { readDrain } from "./operator/autopilot.js";
import { ensureStageTimeoutPlan } from "./pipeline/stageTimeoutPlan.js";
import { createStockExecutors } from "./pipeline/stockExecutors.js";
import { PipelineOrchestrator } from "./pipeline/orchestrator.js";
import { LlmProviderRegistry } from "./providers/llm/registry.js";
import { applyNewInstallGatewayDefault, getLlmGatewaySettings } from "./providers/llm/gatewaySettings.js";
import { getLlmVisionMarks } from "./providers/llm/settings.js";
import { attachLlmQuota } from "./providers/llm/quota.js";
import { omniRouteBaseUrl } from "./providers/llm/omnirouteCatalog.js";
import { OmniRouteQuotaSync } from "./services/omnirouteQuotaSync.js";
import { estimateLlmCost } from "./providers/llm/pricing.js";
import { ScriptService } from "./services/scriptService.js";
import { SceneService } from "./services/sceneService.js";
import { registerSceneRoutes } from "./api/scenes.js";
import { VisualService } from "./services/visualService.js";
import { registerVisualRoutes } from "./api/visuals.js";
import { registerWebImageSettingsRoutes } from "./api/webImageSettings.js";
import { registerImageSourcesSettingsRoutes } from "./api/imageSourcesSettings.js";
import { MAX_IMAGE_BYTES } from "./services/imageStore.js";
import { UsageService } from "./services/usageService.js";
import { registerUsageRoutes } from "./api/usage.js";
import { registerVoiceRoutes } from "./api/voice.js";
import { registerTtsSettingsRoutes } from "./api/ttsSettings.js";
import { connectionsSummary, platformAccountsSummary, registerConnectionRoutes } from "./api/connections.js";
import { registerSubtitleRoutes } from "./api/subtitles.js";
import { TtsProviderRegistry } from "./providers/tts/registry.js";
import { VoiceExecutor } from "./stages/voice/voiceExecutor.js";
import { registerMusicRoutes } from "./api/music.js";
import { MusicService } from "./services/musicService.js";
import { TimelineService } from "./services/timelineService.js";
import { registerTimelineRoutes } from "./api/timeline.js";
import { registerPreviewRoutes } from "./api/preview.js";
import { PreviewService } from "./preview/service.js";
import { resolveSubtitleFontFile } from "./services/thumbnailService.js";
import { generateEditPlanRaw } from "./edit/generateEditPlan.js";
import { registerMotionRoutes } from "./api/motion.js";
import { RenderService } from "./services/renderService.js";
import { RenderExecutor } from "./stages/render/renderExecutor.js";
import { registerRenderRoutes } from "./api/render.js";
import { registerNodeRoutes } from "./api/nodes.js";
import { ProjectRunService } from "./node/runService.js";
import { ProjectPlacement, resolveProjectStageNeeds } from "./node/projectPlacement.js";
import { RunTransportService } from "./node/runTransport.js";
import { ArtifactService } from "./node/artifactService.js";
import { LeaseService, providerNeedsKey } from "./node/leaseService.js";
import { LeaseSecretService, ProjectLeaseSecrets } from "./node/leaseSecrets.js";
import { MediaFetchService, parseMediaScope } from "./node/mediaFetch.js";
import { NodeService } from "./node/nodeService.js";
import { localMayTake } from "./node/placement.js";
import { ThumbnailService } from "./services/thumbnailService.js";
import { registerThumbnailRoutes } from "./api/thumbnails.js";
import { ClipService } from "./services/clipService.js";
import { registerClipRoutes } from "./api/clips.js";
import { ClipExecutor } from "./stages/clip/clipExecutor.js";
import { MetadataService } from "./services/metadataService.js";
import { registerMetadataRoutes } from "./api/metadata.js";
import { ReviewService } from "./review/service.js";
import { setReviewHooks } from "./review/hooks.js";
import { registerReviewRoutes } from "./api/review.js";
import { AudioStore, MAX_AUDIO_BYTES } from "./services/audioStore.js";
import { createMusicProviders } from "./providers/music/registry.js";
import { probeDurationSec } from "./media/ffmpeg.js";
import { GuidelineService } from "./guidelines/service.js";
import { registerGuidelineRoutes } from "./api/guidelines.js";
import { registerOriginalityRoutes } from "./api/originality.js";
import { AutoReportService } from "./services/autoReportService.js";
import { registerAutoReportRoutes } from "./api/autoReport.js";
import { createProfileService } from "./services/profileService.js";
import { registerProfileRoutes } from "./api/profiles.js";
import { registerStyleRoutes } from "./api/style.js";
import { TokenVault } from "./publishing/tokenVault.js";
import { SecretStore } from "./settings/secrets.js";
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
import { handleMissionCommand } from "./missions/telegramCommands.js";
import { OperatorService } from "./operator/service.js";
import { collectOperatorEvents, dispatchOperatorEvents } from "./operator/events.js";
import { registerOperatorRoutes } from "./api/operator.js";
import { createProposalRunner } from "./operator/proposalRunner.js";
import { resolveProposalDraft, type ProposalDraftOption } from "./operator/proposalWiring.js";
import { registerFleetRoutes } from "./api/fleet.js";
import { registerMissionRoutes } from "./api/missions.js";
import { configureFleetRelay } from "./fleet/service.js";
import { ResearchHub } from "./research/runtime.js";
import { registerResearchRoutes } from "./api/research.js";
import { AgentStageService } from "./agents/stageService.js";
import { createMusicAdapter, createResearchAdapter, createScriptAdapter, createVisualSearchAdapter } from "./agents/stageAdapters/index.js";
import { AgentMusicToolkit } from "./agents/musicToolkit.js";
import { AgentResearchToolkit } from "./agents/researchToolkit.js";
import { AgentScriptToolkit } from "./agents/scriptToolkit.js";
import { LlmCache } from "./providers/llm/cache.js";
import { AgentVisualToolkit } from "./agents/visualToolkit.js";
import { registerAgentStageRoutes } from "./api/agentStages.js";
import { registerSeededStandingOrder } from "./operator/extensions.js";
import { runAsActor } from "./auth/requestContext.js";
import { systemActorFor } from "./auth/workspaces.js";
import { registerSkillReportRoutes } from "./api/skillReports.js";
import { KnowledgeService } from "./knowledge/service.js";
import { ChangeInbox } from "./knowledge/changeInbox.js";
import { setExternalHttpObserver } from "./knowledge/httpSignal.js";
import { registerKnowledgeRoutes } from "./api/knowledge.js";
import { createDetectorRuntime } from "./knowledge/detectorRuntime.js";
import { StatusPoller } from "./knowledge/statusPoller.js";
import { deliverChangeAlerts } from "./knowledge/changeAlerts.js";
import { advanceMissions } from "./missions/checkpoints.js";
import { deliverMissionNotices } from "./missions/delivery.js";
import { localMeasure } from "./missions/measure.js";
import { resolveMetaCredentials } from "./publishing/metaGraph.js";
import { DriftMonitor } from "./knowledge/driftMonitor.js";
import { knowledgeWatchModel } from "./knowledge/watchModel.js";
import { registerTikTokHealthWebhook } from "./knowledge/tiktokWebhook.js";
import { registerRegistryRoutes } from "./api/registry.js";
import { registerAutonomyRoutes } from "./api/autonomy.js";
import { registerWebhookRoutes } from "./api/webhooks.js";
import { registerAgentEventRoutes } from "./api/agentEvents.js";
import { bindWebhookVault, enqueueWebhookDeliveries } from "./events/webhooks.js";
import { subscribeAgentEvents } from "./events/agentBus.js";
import { registerAssistantRoutes } from "./api/assistant.js";
import { createFetchers } from "./analytics/registry.js";
import { AnalyticsSyncService } from "./analytics/syncService.js";
import { registerAnalyticsRoutes } from "./api/analytics.js";
import { FinanceService } from "./finance/financeService.js";
import { registerFinanceRoutes } from "./api/finance.js";
import { ensureDefaultRates } from "./finance/currencySettings.js";
import { LearningService } from "./learning/learningService.js";
import { registerLearningRoutes } from "./api/learning.js";
import { registerStageLessonRoutes } from "./api/stageLessons.js";
import { registerPromptVariantRoutes } from "./api/promptVariants.js";
import { CommentInboxService } from "./comments/inboxService.js";
import { registerCommentRoutes } from "./api/comments.js";
import { createTrendService } from "./trends/trendService.js";
import { registerTrendRoutes } from "./api/trends.js";
import { createTranslationService } from "./translations/translationService.js";
import { registerTranslationRoutes } from "./api/translations.js";
import { registerHelpRoutes } from "./api/help.js";
import { registerProviderIntelRoutes } from "./api/providerIntel.js";
import { providerIntelExportRoot } from "./providerIntel/paths.js";
import { registerProviderIntelExtensions } from "./providerIntel/register.js";
import { setProviderIntel } from "./providerIntel/runtime.js";
import { ProviderIntelService } from "./providerIntel/service.js";
import { ProviderIntelExtractSchema, customSecretId, MAILBOX_EVENT_TYPES } from "@vg/shared";
import { managementOrigin } from "./services/omnirouteQuotaSync.js";
import { generateStructured } from "./providers/llm/structured.js";
import { pruneStageFeedback } from "./learning/stageFeedback.js";

export function buildApp({ config, testActor, proposalDraft, tasksRoot }: { config: AppConfig; testActor?: AuthActor; proposalDraft?: ProposalDraftOption; tasksRoot?: string }) {
  registerProviderIntelExtensions();
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

  const database = openDatabase(config.DATABASE_PATH, { logger: server.log });
  database.checkpointManager.start(30_000);
  try {
    migrateDatabase(database.db, server.log, database.sqlite);
  } catch (error) {
    database.sqlite.close();
    throw error;
  }
  installAuth(server, { config, sqlite: database.sqlite, db: database.db, testActor });
  // Keys saved in the app (Kết nối) overlay `.env` values before any provider reads them.
  const tokenVault = new TokenVault(database.sqlite, config.DATA_DIR, config.TOKEN_ENCRYPTION_KEY);
  const secretStore = new SecretStore(config, tokenVault, database.sqlite);
  try {
    secretStore.apply();
  } catch (error) {
    server.log.warn({ err: error instanceof Error ? error.message : String(error) }, "Could not apply saved connections");
  }
  initializeRetrieval(database.sqlite,server.log);
  const profileService = createProfileService(database.db,id=>enqueueIndex(database.sqlite,{scope:"profile",profileId:id}));
  const storageSettings = new StorageSettingsStore(database.sqlite, tokenVault);
  const blobs = new BlobStore(database.sqlite, () => storageSettings.location(), () => {
    recordStorageHealth(database.sqlite, [], new Date(), "failed");
    server.log.warn("Không xác minh được bản sao tệp ở kho S3.");
  }, () => new Date(), () => !storageHealth(database.sqlite).suspendedUntil);
  const fileGc = new FileGc(database.sqlite, config.DATA_DIR, undefined, undefined,
    () => storageSettings.location(), (work) => blobs.mutate(work));
  const projectService = createProjectService(database.db, config, server.log, database.sqlite, profileService, fileGc);
  const knowledge = new KnowledgeService(database.sqlite);
  setExternalHttpObserver((note) => {
    new ChangeInbox(database.sqlite).observe(note);
  });
  const guidelineService = new GuidelineService(database.sqlite, knowledge);
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
  llmProviders.setConnectionLoader(
    () => secretStore.llmSettings(),
    (slug) => secretStore.resolve(customSecretId(slug)),
  );
  llmProviders.reload();
  secretStore.onChange(() => llmProviders.reload());
  llmProviders.setGatewaySettingsLoader(() => getLlmGatewaySettings(database.sqlite));
  llmProviders.setVisionMarkLoader(() => getLlmVisionMarks(database.sqlite).models);
  const renderService = new RenderService(database.sqlite, config, timelineService, undefined, undefined, llmProviders, autoReportService);
  const thumbnailService = new ThumbnailService(database.sqlite, config, timelineService, undefined, llmProviders);
  const clipService = new ClipService(database.sqlite, config, jobRepository, llmProviders, thumbnailService);
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
  const scriptService = new ScriptService(database.sqlite, jobRepository, orchestrator, config, llmProviders);
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
  setReviewHooks({
    loadProject: (projectId) => projectService.getProject(projectId),
    applyRawProposal: (project, proposal, source) => reviewService.applyRawProposal(project, proposal, source),
    undoTimeline: (projectId) => reviewService.undoTimeline(projectId),
  });
  ttsProviders.bind(tokenVault, database.sqlite);
  const youtubePublisher = new YouTubePublisher({
    knowledge,
    config,
    vault: tokenVault,
    sqlite: database.sqlite,
  });
  const tiktokPublisher = new TikTokPublisher({
    config,
    knowledge,
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
    thumbnails: thumbnailService,
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
  assistantService.setClips(clipService);
  const researchHub = new ResearchHub(database.sqlite, llmProviders, config);
  assistantService.setResearch(researchHub);
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
  const quotaSync = new OmniRouteQuotaSync({
    sqlite: database.sqlite,
    vault: tokenVault,
    baseUrl: omniRouteBaseUrl(config),
    apiKey: config.OMNIROUTE_API_KEY,
    logger: server.log,
  });
  let stopQuotaSync = () => {};
  attachLlmQuota(llmProviders, {
    sqlite: database.sqlite,
    refreshLive: () => quotaSync.refresh(false),
    spendToday: (dateKey) => {
      try {
        return usageService.getAutomationSpend(dateKey, llmProviders.quota?.policyFor(null).timeZone ?? "UTC").dailyUsd;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    },
    costOf: (provider, model, inputTokens, outputTokens) => {
      try {
        return estimateLlmCost(config, provider, model, { inputTokens, outputTokens });
      } catch {
        return 0;
      }
    },
    notifyPaid: (message) => {
      void notificationService.notify({
        kind: "automation_warning",
        profile: "LLM",
        message,
      });
    },
  });
  publishTicker.setNotifications(notificationService);
  const analyticsFetchers = createFetchers({
    knowledge,
    youtubeQuota: youtubePublisher.quota,
    logger: server.log,
  });
  const analyticsSyncService = new AnalyticsSyncService({
    sqlite: database.sqlite,
    vault: tokenVault,
    registry: publisherRegistry,
    fetchers: analyticsFetchers,
    logger: server.log,
    notifications: notificationService,
    youtubeQuota: youtubePublisher.quota,
  });
  publishTicker.setAnalytics(analyticsSyncService);
  assistantService.setAnalytics(analyticsSyncService);
  const commentInbox = new CommentInboxService({
    sqlite: database.sqlite,
    vault: tokenVault,
    registry: publisherRegistry,
    llm: llmProviders,
    notifications: notificationService,
    youtubeQuota: youtubePublisher.quota,
    config,
    logger: server.log,
  });
  publishTicker.setComments(commentInbox);
  assistantService.setComments(commentInbox);
  const trendService = createTrendService({
    sqlite: database.sqlite,
    profiles: profileService,
    llm: llmProviders,
    vault: tokenVault,
  });
  const translationService = createTranslationService({
    sqlite: database.sqlite,
    config,
    profiles: profileService,
    llm: llmProviders,
    tts: ttsProviders,
    vault: tokenVault,
  });
  assistantService.setTrends(trendService);
  assistantService.setTranslations(translationService);
  ensureDefaultRates(database.sqlite, config.USD_VND_RATE);
  const financeService = new FinanceService({
    sqlite: database.sqlite,
    vault: tokenVault,
    registry: publisherRegistry,
    usage: usageService,
    config,
    logger: server.log,
    notifications: notificationService,
    llm: llmProviders,
  });
  publishTicker.setFinance(financeService);
  assistantService.setFinance(financeService);
  const learningService = new LearningService({
    sqlite: database.sqlite,
    llm: llmProviders,
    notifications: notificationService,
    logger: server.log,
    updateYoutubeTitle: async (input) => {
      await youtubePublisher.updateTitle(
        input.accountId,
        input.videoId,
        input.title,
        input.signal ?? AbortSignal.timeout(30_000),
      );
    },
  });
  publishTicker.setLearning(learningService);
  assistantService.setLearning(learningService);
  const apiHost = config.HOST === "0.0.0.0" || config.HOST === "::" ? "127.0.0.1" : config.HOST;
  const wakeHolder: { wake: (reason: string, prompt: string) => { status: string } } = {
    wake: () => ({ status: "refused" }),
  };
  const providerIntelService = new ProviderIntelService({
    sqlite: database.sqlite,
    logger: server.log,
    exportRoot: providerIntelExportRoot(config.DATA_DIR),
    vault: tokenVault,
    omnirouteOrigin: managementOrigin(omniRouteBaseUrl(config)),
    omnirouteApiKey: config.OMNIROUTE_API_KEY ?? null,
    wake: (reason, prompt) => wakeHolder.wake(reason, prompt),
    notify: (event) => notificationService.notify(event),
    createPending: (tool, args, summary) => assistantService.createCallerPending("Đánh giá model", tool, args, summary),
    allowAutoExtract: config.LLM_ENABLE_MOCK,
    extractPageText: async (pageText) => {
      const fallbackId = config.LLM_DEFAULT_PROVIDER;
      const provider = llmProviders.get("mock") ?? (fallbackId ? llmProviders.get(fallbackId) : undefined);
      if (!provider) return [];
      const generated = await generateStructured({
        provider,
        model: provider.defaultModel || config.LLM_DEFAULT_MODEL || "mock-v1",
        system: "Chỉ trả field có quote nằm nguyên trong pageText.",
        prompt: JSON.stringify({ pageText: pageText.slice(0, 12_000) }),
        schema: ProviderIntelExtractSchema,
        schemaName: "ProviderIntelExtract",
        schemaVersion: "1",
        maxOutputTokens: 800,
        signal: AbortSignal.timeout(20_000),
        task: "providerIntelExtract",
      });
      return generated.value.fields;
    },
  });
  setProviderIntel(providerIntelService);
  registerSeededStandingOrder({ id: "seed-research-weekly", title: "Rà lại tri thức mỗi tuần", enabled: false, moduleId: "self-improvement", cron: "0 9 * * 1",
    prompt: "Đọc list_stale_knowledge, chọn tối đa 3 mục quan trọng và gọi run_research với skill research-knowledge-refresh, knowledgeId, subject là ID mục và trigger schedule. Dùng ngân sách hiện tại, không tự duyệt đề xuất." });
  registerSeededStandingOrder({ id: "seed-stage-learning-weekly", title: "Chắt lọc bài học theo bước mỗi tuần", enabled: false, moduleId: "stage-learning", cron: "0 8 * * 1",
    prompt: "Với từng kênh có phản hồi mới, gọi list_stage_feedback theo từng bước. Chỉ đề xuất khi có ít nhất 5 dòng mới: gọi propose_stage_note với tối đa 5 bài học, mỗi bài dẫn evidenceIds là ID thật trong kết quả. Không gọi decide_stage_note; người dùng tự duyệt. Trả lời tiếng Việt: kênh nào, bước nào, đề xuất bao nhiêu." });
  const operatorService = new OperatorService({
    llmProviders,
    sqlite: database.sqlite,
    dataDir: config.DATA_DIR,
    apiUrl: `http://${apiHost}:${config.PORT}`,
    assistant: assistantService,
    logger: server.log,
  });
  researchHub.setRepoSkills(() => operatorService.repoSkillSummaries().map(({ name }) => operatorService.readRepoSkill(name)));
  wakeHolder.wake = (reason, prompt) => {
    if (process.env.VITEST) return { status: "refused" };
    return operatorService.wakeOperator(reason, prompt);
  };
  operatorService.setTelegramClient(() => telegramPoller.createClient());
  installAssistantTelegramHandlers(telegramPoller, assistantService, {
    sqlite: database.sqlite,
    operator: operatorService,
    mission: (args) => handleMissionCommand(database.sqlite, args),
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
  setAutomationNotify((event) => {
    void notificationService.notify(event);
  });
  setAutomationPausedNotify(() => {
    void notificationService.notify({ kind: "automation_paused" });
  });
  const renderExecutor = new RenderExecutor(renderService, thumbnailService, clipService);
  const nodeService = new NodeService(database.sqlite, config, jobRepository, orchestrator);
  const projectRuns = new ProjectRunService(database.sqlite, orchestrator, undefined, config.NODE_PROJECT_RUN_LEASE_SEC * 1000);
  nodeService.projectRuns = projectRuns;
  const runTransport = new RunTransportService(database.sqlite, config, projectRuns, orchestrator,
    (run, checkpoint) => { if (checkpoint.state === "DONE") orchestrator.publishStageCompletion(run.projectId, checkpoint.stage); });
  const projectSecrets = new ProjectLeaseSecrets(database.sqlite, (key) =>
    isSecretId(key) ? secretStore.resolve(key) ?? null : tokenVault.loadSecret(key));
  const projectNeeds = (project: Parameters<typeof resolveProjectStageNeeds>[2]) =>
    resolveProjectStageNeeds(database.sqlite, llmProviders, project, ttsProviders.planVoice(project).provider);
  runTransport.lend = (run, scopes, publicKey) => {
    const project = jobRepository.getProject(run.projectId);
    const node = nodeService.list().find(({ id }) => id === run.nodeId);
    if (!project || !node) return [];
    const needs = projectNeeds(project);
    const excluded = new Set(run.stopBefore.flatMap((stage) => [stage, ...dependentStages(stage)]));
    const allowed = new Set(STAGE_ORDER.slice(STAGE_ORDER.indexOf(run.fromStage))
      .filter((stage) => !excluded.has(stage)).flatMap((stage) => needs?.[stage] ?? []));
    const requested = scopes.filter((scope) => node.capabilities.includes(`borrow:${scope}`) && node.desiredConfig.capabilities.includes(`borrow:${scope}`));
    return projectSecrets.seal(run, requested, allowed, publicKey);
  };
  const projectPlacement = new ProjectPlacement({
    db: database.sqlite, orchestrator, runs: projectRuns, nodes: nodeService,
    commands: runTransport.commands,
    eligible: () => !readDrain(database.sqlite).draining,
    needs: projectNeeds,
    canLend: (scope) => projectSecrets.canLend(scope),
    budget: (project, at) => {
      const { scopes } = autonomyBudgetStatus(database.sqlite, usageService, project.profileId ?? undefined, at);
      const remaining = scopes.flatMap(({ limits, spend }) => (["dailyUsd", "monthlyUsd"] as const)
        .flatMap((key) => limits[key] === null ? [] : [Math.max(0, limits[key] - spend[key] - heldAutonomyUsd())]));
      return Math.min(Number.MAX_SAFE_INTEGER, ...remaining);
    },
  });
  orchestrator.setProjectPlacement(projectPlacement);
  runTransport.onAccepted = (run) => {
    try { projectPlacement.noteAccepted(run); }
    catch (error) { server.log.warn({ err: error }, "Could not refresh worker input baseline"); }
  };
  runTransport.onBoundary = (id) => {
    try { orchestrator.resumePlacedProject(id); }
    catch (error) { server.log.warn({ err: error }, "Could not resume project after worker boundary"); }
  };
  assistantService.setNodes(nodeService);
  const voiceExecutor = new VoiceExecutor(database.sqlite, ttsProviders, config);
  const leaseSecrets = new LeaseSecretService(database.sqlite, () => config.NODE_LEASE_SEC, (key) => tokenVault.loadSecret(key));
  const mediaFetch = new MediaFetchService(jobRepository, config.DATA_DIR);
  const leaseService = new LeaseService(
    database.sqlite,
    config,
    jobRepository,
    orchestrator,
    nodeService,
    renderService,
    new ArtifactService(database.sqlite),
    (project, signal, aspectRatio, render, reused) => renderExecutor.afterRender(project, signal, aspectRatio ?? undefined, render, reused),
    () => new Date(),
    server.log,
    {
      secrets: leaseSecrets,
      voice: voiceExecutor,
      planProvider: (project) => ttsProviders.planVoice(project).provider,
      media: mediaFetch,
    },
    blobs,
  );
  const worker = new JobWorker(
    jobRepository,
    orchestrator,
    createStockExecutors({
      sqlite: database.sqlite, config, llm: llmProviders, visual: visualService, voice: voiceExecutor, music: musicService,
      timeline: timelineService, guidelines: guidelineService, metadata: metadataService, autoReport: autoReportService,
      render: renderExecutor, clip: new ClipExecutor(clipService),
    }).set("PUBLISH", new PublishExecutor(publishService)),
    config,
    server.log,
    () => new Date(),
    (project, signal) => ensureStageTimeoutPlan({
      project,
      sqlite: database.sqlite,
      registry: llmProviders,
      signal,
      log: (message) => server.log.warn(message),
    }),
    usageService,
  );
  let agentVisuals!: AgentVisualToolkit;
  const visualAdapter = createVisualSearchAdapter({
    visuals: {
      context: (job) => agentVisuals.context(job),
      validateComplete: (job) => agentVisuals.validateComplete(job),
    },
    visualService,
  });
  let agentResearch!: AgentResearchToolkit;
  const researchAdapter = createResearchAdapter({
    research: {
      context: (job) => agentResearch.context(job),
      validateComplete: (job) => agentResearch.validateComplete(job),
    },
  });
  let agentMusic!: AgentMusicToolkit;
  const musicAdapter = createMusicAdapter({
    music: {
      context: (job) => agentMusic.context(job),
      validateComplete: (job) => agentMusic.validateComplete(job),
      prepareComplete: (job) => agentMusic.prepareComplete(job),
    },
  });
  let agentScript!: AgentScriptToolkit;
  const scriptAdapter = createScriptAdapter({
    script: {
      context: (job) => agentScript.context(job),
      validateComplete: (job) => agentScript.validateComplete(job),
    },
  });
  const agentStages: AgentStageService = new AgentStageService({ repository: jobRepository, orchestrator, adapters: [visualAdapter, researchAdapter, musicAdapter, scriptAdapter] });
  agentVisuals = new AgentVisualToolkit(jobRepository, agentStages, visualService, config);
  agentResearch = new AgentResearchToolkit(jobRepository, agentStages, config.WEB_IMAGE_DOMAIN_DENYLIST);
  agentScript = new AgentScriptToolkit(jobRepository, agentStages, orchestrator, llmProviders, config, new LlmCache(database.sqlite, config.LLM_CACHE_ENABLED));
  orchestrator.setQueuedJobHandler((job) => { agentStages.beforeLocal(job); });
  worker.setAgentStages(agentStages);
  agentMusic = new AgentMusicToolkit(jobRepository, agentStages, musicService, new AudioStore(config.DATA_DIR, config.IMAGE_SEARCH_USER_AGENT), probeDurationSec, config.DATA_DIR, config.WEB_IMAGE_DOMAIN_DENYLIST, autoReportService);
  assistantService.setAgentStages(agentStages, agentVisuals, agentResearch, agentMusic, agentScript);
  registerAgentStageRoutes(server, database.sqlite, agentStages, agentVisuals);
  let nextFileGcSweep = 0;
  let fileGcSweep: Promise<void> | undefined;
  worker.setSweep(() => {
    nodeService.sweep();
    leaseService.cleanupFinishedUploads();
    projectPlacement.sweep((error) => server.log.warn({ err: error }, "Could not resume placed project"));
    if (!fileGcSweep && Date.now() >= nextFileGcSweep) {
      nextFileGcSweep = Date.now() + 86_400_000;
      fileGcSweep = (async () => {
        await fileGc.runBlobs({ purge: true });
        fileGc.run({ purge: true });
        // TASK-148a: drop stage feedback past its 180-day retention window.
        pruneStageFeedback(database.sqlite);
      })().catch((error) => {
        nextFileGcSweep = Date.now() + 60 * 60_000;
        server.log.warn({ err: error }, "Could not collect orphaned project files");
      }).finally(() => { fileGcSweep = undefined; });
    }
  });
  worker.setOverdue({
    sqlite: database.sqlite,
    registry: llmProviders,
    config,
    workDir: (projectId) => projectDir(config.DATA_DIR, projectId),
  });
  let nextPressureSweep = 0;
  let storagePressure = false;
  const governor = new ResourceGovernor({
    sqlite: database.sqlite,
    sampler: createSystemSampler(config.DATA_DIR),
    workerCap: config.WORKER_CONCURRENCY,
    onChange: () => worker.onGovernorChange(),
    onDiskSample: (freePercent, now) => {
      if (freePercent === null) return;
      try {
        if (freePercent >= 15) {
          if (storagePressure) writeDiskPressure(database.sqlite, null);
          storagePressure = false;
          nextPressureSweep = 0;
          return;
        }
        if (now.getTime() < nextPressureSweep) return;
        storagePressure = true;
        nextPressureSweep = now.getTime() + 5 * 60_000;
        fileGc.run({ purge: true, ephemeralOnly: true });
        writeDiskPressure(database.sqlite, { freePercent, at: now.toISOString(), projects: fileGc.largestProjects() });
      } catch (error) {
        server.log.warn({ err: error }, "Could not handle low disk space");
      }
    },
    budgetStopped: (profileId, at) => autonomyBudgetStatus(database.sqlite, usageService, profileId, at).state === "stop",
  });
  worker.setGovernor(governor);
  leaseService.setDiskGuard((stage) => governor.diskBlocks(stage));
  registerResourceRoutes(server, database.sqlite, governor);
  registerAdminDbStatsRoutes(server, database.sqlite, database.checkpointManager);
  const previewService = new PreviewService({
    sqlite: database.sqlite,
    dataDir: config.DATA_DIR,
    getProject: (id) => projectService.getProject(id),
    timeline: (id) => timelineService.get(id).timeline ?? null,
    governor,
    fontFile: () => { try { return resolveSubtitleFontFile(); } catch { return null; } },
  });
  assistantService.setPreview(previewService);
  registerPreviewRoutes(server, previewService);
  worker.setPlacement((job, now) => localMayTake(database.sqlite, nodeService, job, now, (candidate) => {
    if (candidate.stage === "MEDIA_FETCH") return parseMediaScope(candidate.scope) ? { capability: "media_fetch" } : null;
    const project = jobRepository.getProject(candidate.projectId);
    if (!project) return null;
    const provider = ttsProviders.planVoice(project).provider;
    if (providerNeedsKey(provider) && leaseSecrets.blockedReason(provider)) return null;
    return { capability: `tts:${provider}` };
  }));
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
  server.decorate("vgOperator", {
    service: operatorService,
  });
  server.decorate("vgProviderIntel", providerIntelService);
  registerProviderIntelRoutes(server, providerIntelService, { sqlite: database.sqlite, registry: llmProviders, config });

  const allowedOrigins = new Set(trustedOrigins(config));
  server.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(null, false);
    },
  });
  registerHealthRoutes(server, database.sqlite, config.RENDER_CONCURRENCY, config.EDGE_TTS_PATH, config.VG_MCP_HEALTH_URL);
  registerHelpRoutes(server);
  registerProjectRoutes(server, projectService);
  registerStageTimeoutRoutes(server, { sqlite: database.sqlite, registry: llmProviders, jobs: jobRepository });
  registerOverdueRoutes(server, { sqlite: database.sqlite, orchestrator });
  registerProfileRoutes(server, profileService, database.sqlite);
  registerStyleRoutes(server, database.sqlite, { registry: llmProviders, config });
  registerAutomationRoutes(server, {
    topics: topicService,
    automation: automationService,
    sqlite: database.sqlite,
  });
  registerOAuthRoutes(server, { publish: publishService, registry: publisherRegistry, oauthState });
  registerPublicationRoutes(server, { publish: publishService, vault: tokenVault });
  registerAnalyticsRoutes(server, { analytics: analyticsSyncService });
  registerCommentRoutes(server, commentInbox);
  registerFinanceRoutes(server, { finance: financeService });
  registerLearningRoutes(server, learningService);
  registerStageLessonRoutes(server, database.sqlite);
  registerPromptVariantRoutes(server, database.sqlite);
  registerRecommendationRoutes(server);
  registerBudgetRoutes(server, projectService, jobRepository, config, llmProviders);
  registerDashboardRoutes(server, projectService, automationService, trendService);
  registerTrendRoutes(server, trendService);
  registerTranslationRoutes(server, translationService);
  registerUsageRoutes(server, usageService, projectService);
  registerPipelineRoutes(server, projectService, jobRepository, orchestrator, events, sceneService);
  registerLlmRoutes(server, llmProviders, database.sqlite, projectService, profileService, fetch, quotaSync);
  const llmRelay = new LlmRelay({
    sqlite: database.sqlite,
    config,
    catalog: llmProviders.omnirouteCatalog,
    quota: () => llmProviders.quota,
    verifyApiKey: (key) => server.vgAuth.verifyApiKey(key),
    authenticateNode: (token) => nodeService.authenticate(token),
    recordJobUsage: (jobId, usage) => orchestrator.recordUsage(jobId, usage, { allowTerminal: true }),
  });
  llmRelay.recoverPending();
  configureFleetRelay(database.sqlite, llmRelay);
  registerLlmRelayRoutes(server, llmRelay, [config.OMNIROUTE_API_KEY]);
  registerStorageSettingsRoutes(server, database.sqlite, storageSettings, fileGc);
  registerScriptRoutes(server, scriptService, projectService, config, guidelineService, database.sqlite);
  registerGuidelineRoutes(server, database.sqlite, projectService, guidelineService, llmProviders, config);
  registerOriginalityRoutes(server, database.sqlite);
  registerSceneRoutes(server, sceneService, database.sqlite);
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
  registerOperatorRoutes(server, operatorService, database.sqlite, resolveProposalDraft(proposalDraft, () => createProposalRunner({ registry: llmProviders, sqlite: database.sqlite })), tasksRoot);
  registerMissionRoutes(server, database.sqlite);
  registerFleetRoutes(server, database.sqlite, Object.entries(config).filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key) && typeof value === "string").map(([, value]) => value as string));
  registerResearchRoutes(server, database.sqlite, researchHub);
  registerSkillReportRoutes(server, database.sqlite, config);
  registerRegistryRoutes(server, assistantService, operatorService);
  registerKnowledgeRoutes(server, knowledge, config.CORS_ORIGIN, database.sqlite);
  registerTikTokHealthWebhook(server, database.sqlite, accountId => {
    const account = database.sqlite.prepare("SELECT profile_id FROM platform_accounts WHERE id = ?").get(accountId) as { profile_id: string } | undefined;
    const credentials = account ? tokenVault.loadAppCredentials(accountId, account.profile_id, "tiktok") : null;
    return credentials ?? (config.TIKTOK_CLIENT_KEY && config.TIKTOK_CLIENT_SECRET
      ? { clientId: config.TIKTOK_CLIENT_KEY, clientSecret: config.TIKTOK_CLIENT_SECRET } : null);
  });
  registerAutonomyRoutes(server, database.sqlite, config.CORS_ORIGIN);
  bindWebhookVault(tokenVault);
  const unsubscribeEvents = subscribeAgentEvents((event) => {
    // Mailbox events reach webhooks only through per-subscription routing (129a step 2), never the generic fan-out.
    if (MAILBOX_EVENT_TYPES.includes(event.type)) return;
    try {
      enqueueWebhookDeliveries(database.sqlite, event);
    } catch {
      // A closed test database must not fail the stage that emitted the event.
    }
  });
  server.addHook("onClose", async () => unsubscribeEvents());
  registerWebhookRoutes(server, database.sqlite, tokenVault);
  server.get("/api/profiles/:id/visual-copyright", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { visualCopyrightMode } = await import("./services/visualPolicy.js");
    return { allowCopyrightedStills: visualCopyrightMode(database.sqlite, id) };
  });
  server.put("/api/profiles/:id/visual-copyright", async (request) => {
    if (request.actor?.kind !== "user") throw new AppError(403, "VISUAL_COPYRIGHT_USER_ONLY", "Chỉ người dùng được đổi chế độ ảnh có bản quyền.");
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ allowCopyrightedStills: z.enum(["off", "commentary"]) }).parse(request.body);
    const { setVisualCopyrightMode } = await import("./services/visualPolicy.js");
    setVisualCopyrightMode(database.sqlite, id, body.allowCopyrightedStills);
    return { allowCopyrightedStills: body.allowCopyrightedStills };
  });
  server.get("/api/profiles/:id/visual-quality", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { visualQuality } = await import("./services/visualPolicy.js");
    return { quality: visualQuality(database.sqlite, id) };
  });
  server.put("/api/profiles/:id/visual-quality", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ quality: z.enum(["budget", "best"]) }).parse(request.body);
    const { setVisualQuality } = await import("./services/visualPolicy.js");
    setVisualQuality(database.sqlite, id, body.quality);
    return { quality: body.quality };
  });
  server.post("/api/profiles/visual-quality", async (request) => {
    const body = z.object({ quality: z.enum(["budget", "best"]) }).parse(request.body);
    const { setAllProfilesVisualQuality } = await import("./services/visualPolicy.js");
    return { updated: setAllProfilesVisualQuality(database.sqlite, body.quality), quality: body.quality };
  });
  registerAgentEventRoutes(server, database.sqlite);
  registerCapabilityProbeRoutes(server, database.sqlite, llmProviders.omnirouteCatalog);
  llmProviders.omnirouteCatalog.onDiff = (diff) => {
    if (!diff.removed.length && !diff.added.length && !diff.capabilityChanges.length) return;
    const now = new Date().toISOString();
    const summary = diff.removed.length
      ? `Model đã rời catalog: ${diff.removed.join(", ")}`
      : diff.added.length
        ? `Model mới: ${diff.added.join(", ")}`
        : `Khả năng model đổi: ${diff.capabilityChanges.join(", ")}`;
    database.sqlite.prepare(`INSERT INTO notification_log (id, at, kind, subject_key, channel, status, message, error)
      VALUES (?, ?, 'catalog', 'omniroute-catalog', 'log', 'sent', ?, NULL)`).run(randomUUID(), now, summary);
    const routeRows = database.sqlite.prepare("SELECT llm FROM profiles").all() as Array<{ llm: string }>;
    const gateway = database.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'llm.gateway'").get() as { value: string } | undefined;
    const routeText = `${routeRows.map((row) => row.llm).join("\n")}\n${gateway?.value ?? ""}`;
    const removedOnRoute = diff.removed.filter((id) => routeText.includes(id));
    if (!removedOnRoute.length) return;
    const findingKey = `model_removed:${removedOnRoute.sort().join(",")}`;
    const opens = findingWillOpen(database.sqlite, findingKey);
    database.sqlite.prepare(`INSERT INTO supervisor_findings
      (id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
      VALUES (?, 'model_removed', 'info', ?, ?, ?, ?, 'open')
      ON CONFLICT(dedupe_key) DO UPDATE SET detail = excluded.detail, last_seen_at = excluded.last_seen_at, status = 'open'`)
      .run(randomUUID(), findingKey, JSON.stringify({ summary, added: diff.added, removed: removedOnRoute }), now, now);
    if (opens) publishFindingOpened(database.sqlite, { summary: `Model bị gỡ khỏi route: ${removedOnRoute.join(", ")}`, profileId: null });
  };
  llmProviders.omnirouteCatalog.startBackgroundSync();
  registerVoiceRoutes(server, ttsProviders, database.sqlite, projectService, jobRepository, config);
  registerTtsSettingsRoutes(server, database.sqlite, config, tokenVault, ttsProviders);
  const connectionDeps = {
    store: secretStore,
    registry: llmProviders,
    sqlite: database.sqlite,
    config,
    oauthState,
    publish: publishService,
    vault: tokenVault,
    tts: ttsProviders,
  };
  registerConnectionRoutes(server, connectionDeps);
  assistantService.setConnections({
    overview: () => connectionsSummary(connectionDeps),
    accounts: () => platformAccountsSummary(connectionDeps),
  });
  registerSubtitleRoutes(server, database.sqlite, jobRepository, config);
  registerMusicRoutes(server, musicService, projectService, jobRepository);
  registerTimelineRoutes(server, timelineService, projectService, (project, timeline) => generateEditPlanRaw({
    registry: llmProviders,
    sqlite: database.sqlite,
    project,
    timeline,
  }));
  registerMotionRoutes(server, { dataDir: config.DATA_DIR });
  registerRenderRoutes(server, renderService, projectService, database.sqlite, autoReportService, orchestrator);
  registerNodeRoutes(server, database.sqlite, config, nodeService, leaseService, leaseSecrets, runTransport);
  registerThumbnailRoutes(server, thumbnailService, projectService);
  registerClipRoutes(server, clipService);
  server.decorate("vgClips", clipService);
  setEmbeddingRegistry(database.sqlite,llmProviders,config);
  registerRetrievalRoutes(server,database.sqlite);
  registerMetadataRoutes(server, metadataService, projectService, database.sqlite);
  registerAutoReportRoutes(server, autoReportService, projectService);
  registerReviewRoutes(server, reviewService, projectService);

  let stopOperatorTick = (): void => undefined;
  const supervisor = new AutonomySupervisor({
    repository: jobRepository, usage: usageService, stageTimeoutMs: config.STAGE_TIMEOUT_MS, logger: server.log,
    diskFreeBytes: () => {
      const stats = statfsSync(config.DATA_DIR);
      return stats.bavail * stats.bsize;
    },
    tempRoot: config.DATA_DIR,
    llmFailovers: () => llmProviders.failover.recentFailovers().length,
    worker: { readySince: (now) => worker.readySince(now), lastClaimAt: () => worker.lastClaimAt(), nudge: () => worker.nudge() },
    governor: { starved: (now) => governor.starved(now) },
    notify: (finding) => orchestrator.notifyBudgetFinding(finding),
    suggestTopics: (profileId) => {
      void topicService.suggestTopics(profileId, { count: 3 }).catch((error) => {
        server.log.warn({ err: error, profileId }, "Topic suggestion from the supervisor failed");
      });
    },
    summarize: (facts) => summarizeDigest(llmProviders, database.sqlite, facts),
  });
  let stopIntel = (): void => undefined;
  let operatorDelivery: Promise<void> | undefined;
  const detectorAbort = new AbortController();
  const statusPoller = new StatusPoller({ db: database.sqlite, vault: tokenVault, registry: publisherRegistry, quota: youtubePublisher.quota,
    metaCredentials: accountId => resolveMetaCredentials({ config, vault: tokenVault, sqlite: database.sqlite }, accountId) });
  const detectorScheduler = createDetectorRuntime(database.sqlite, {
    signal: detectorAbort.signal,
    llm: knowledgeWatchModel(database.sqlite, llmProviders, detectorAbort.signal),
    research: async () => {
      const spaces = database.sqlite.prepare("SELECT id FROM organization").all() as Array<{ id: string }>;
      for (const space of spaces) await runAsActor(systemActorFor(database.sqlite, space.id), () => researchHub.tick(detectorAbort.signal));
    },
    health: () => statusPoller.poll(detectorAbort.signal),
    drift: async () => { new DriftMonitor(database.sqlite, () => new Date(), `http://${apiHost.includes(":") ? `[${apiHost}]` : apiHost}:${config.PORT}/api/knowledge/metrics`).run(); },
    audit: result => server.log.info(result, "knowledge detector run"),
  });
  let detectorTick: Promise<void> | undefined;
  // TASK-129c slice 2b: one overlapping tick at most; advanceMissions also guards this in-process.
  let missionTick: Promise<void> | undefined;
  server.addHook("onReady", async () => {
    stopQuotaSync = quotaSync.start();
    if (config.OMNIROUTE_API_KEY) {
      void llmProviders.omnirouteCatalog.getModels().then((models) => {
        if (applyNewInstallGatewayDefault(database.sqlite, { hasKey: true, modelCount: models.length })) server.log.info("LLM gateway mode set to 'only' for this new install");
      }).catch(() => undefined);
    }
    stopIntel = providerIntelService.startScheduler();
    if (config.WORKER_ENABLED) supervisor.recordStartup((lastHeartbeat, now) => ({
      operator: operatorService.recoverSchedules(lastHeartbeat, now),
      publications: recoverMissedPublications(database.sqlite, lastHeartbeat, now),
    }));
    await leaseService.recoverFinalizing();
    await worker.start();
    if (config.WORKER_ENABLED) governor.start();
    collectOperatorEvents(database.sqlite);
    if (config.WORKER_ENABLED) {
      supervisor.start();
      publishTicker.start();
      telegramPoller.start();
      const timer = setInterval(() => {
        detectorTick ??= detectorScheduler.tick().then(() => deliverChangeAlerts(database.sqlite, event => notificationService.notify(event))).catch(error => {
          server.log.error({ err: error }, "knowledge detectors failed");
        }).finally(() => { detectorTick = undefined; });
        // Missions: checkpoints and reminders. Off with WORKER_ENABLED=false, like the other scheduled work here.
        missionTick ??= advanceMissions(database.sqlite, new Date(), localMeasure(database.sqlite))
          .then((fired) => deliverMissionNotices(database.sqlite, notificationService, fired, new Date(), notificationService.webBaseUrl()))
          .catch((error) => {
            server.log.error({ err: error }, "mission tick failed");
          })
          .finally(() => { missionTick = undefined; });
        try {
          collectOperatorEvents(database.sqlite);
          operatorDelivery ??= dispatchOperatorEvents(database.sqlite, {
            wake: (input) => operatorService.wakeForEvent(input),
            telegram: (message) => operatorService.notifyEventTelegram(message),
          }).catch((error) => {
            server.log.error({ err: error }, "operator event delivery failed");
          }).finally(() => { operatorDelivery = undefined; });
        } catch (error) {
          server.log.error({ err: error }, "operator event collection failed");
        }
        try {
          operatorService.tick();
        } catch (error) {
          server.log.error({ err: error }, "operator tick failed");
        }
      }, 30_000);
      stopOperatorTick = () => clearInterval(timer);
    }
  });
  server.addHook("onClose", async () => {
    detectorAbort.abort();
    supervisor.stop();
    governor.stop();
    stopIntel();
    stopOperatorTick();
    await detectorTick;
    await missionTick;
    await operatorDelivery;
    stopQuotaSync();
    await telegramPoller.stop();
    await publishTicker.stop();
    await worker.stop();
    await fileGcSweep;
    await blobs.drain();
    database.checkpointManager.stop();
    llmRelay.stop();
    orchestrator.stop();
    flushAuditQueue(database.sqlite);
    database.checkpointManager.checkpoint("TRUNCATE");
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
