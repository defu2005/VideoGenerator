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

export function buildApp({ config }: { config: AppConfig }) {
  const server = Fastify({
    logger: { level: config.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

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
  const orchestrator = new PipelineOrchestrator(jobRepository, config, server.log);
  const llmProviders = new LlmProviderRegistry(config);
  const scriptService = new ScriptService(database.sqlite, jobRepository, orchestrator, config);
  const sceneService = new SceneService(database.sqlite, jobRepository);
  const visualService = new VisualService(database.sqlite, jobRepository, config, server.log);
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
  registerPipelineRoutes(server, projectService, jobRepository, orchestrator, events, sceneService);
  registerLlmRoutes(server, llmProviders, database.sqlite, projectService);
  registerScriptRoutes(server, scriptService, projectService, config);
  registerSceneRoutes(server, sceneService);
  registerVisualRoutes(server, visualService, jobRepository);

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
