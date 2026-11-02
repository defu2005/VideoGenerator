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

export function buildApp({ config }: { config: AppConfig }) {
  const server = Fastify({
    logger: { level: config.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  const database = openDatabase(config.DATABASE_PATH);
  migrateDatabase(database.db);
  const projectService = createProjectService(database.db, config, server.log);

  server.register(cors, { origin: config.CORS_ORIGIN });
  registerHealthRoutes(server, database.sqlite);
  registerProjectRoutes(server, projectService);
  registerDashboardRoutes(server, projectService);

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

  server.addHook("onClose", async () => {
    database.sqlite.close();
  });

  return server;
}
