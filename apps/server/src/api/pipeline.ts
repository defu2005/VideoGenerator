import { PipelineEventSchema, PipelineStageSchema, PipelineStateSchema, JobSchema } from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { PipelineEventBus } from "../jobs/eventBus.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import { requireProject } from "../services/projectService.js";
import type { ProjectService } from "../services/projectService.js";

const ParamsSchema = z.object({ id: z.string().uuid() }).strict();
const StageParamsSchema = z.object({ id: z.string().uuid(), stage: PipelineStageSchema }).strict();
const GateParamsSchema = z.object({ id: z.string().uuid(), gate: PipelineStageSchema }).strict();
const RunBodySchema = z.object({ stage: PipelineStageSchema.optional() }).strict();
const JobsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict();
const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export function registerPipelineRoutes(
  app: FastifyInstance,
  service: ProjectService,
  repository: JobRepository,
  orchestrator: PipelineOrchestrator,
  events: PipelineEventBus,
): void {
  app.get("/api/projects/:id/pipeline", {
    schema: { params: ParamsSchema, response: { 200: PipelineStateSchema, 404: ApiErrorSchema } },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    await requireProject(service, id);
    return orchestrator.getPipeline(id);
  });

  app.post("/api/projects/:id/pipeline/run", {
    schema: {
      params: ParamsSchema,
      body: RunBodySchema,
      response: { 202: PipelineStateSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request, reply) => {
    const { id } = ParamsSchema.parse(request.params);
    const { stage } = RunBodySchema.parse(request.body);
    const pipeline = stage === undefined ? orchestrator.runAll(id) : orchestrator.runStage(id, stage);
    return reply.code(202).send(pipeline);
  });

  app.post("/api/projects/:id/pipeline/gates/:gate/approve", {
    schema: {
      params: GateParamsSchema,
      response: { 200: PipelineStateSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id, gate } = GateParamsSchema.parse(request.params);
    return orchestrator.approveGate(id, gate);
  });

  app.post("/api/projects/:id/pipeline/cancel", {
    schema: {
      params: ParamsSchema,
      response: { 200: PipelineStateSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return orchestrator.cancel(id);
  });

  app.post("/api/projects/:id/pipeline/stages/:stage/retry", {
    schema: {
      params: StageParamsSchema,
      response: { 202: PipelineStateSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
    },
  }, async (request, reply) => {
    const { id, stage } = StageParamsSchema.parse(request.params);
    return reply.code(202).send(orchestrator.retry(id, stage));
  });

  app.get("/api/projects/:id/jobs", {
    schema: {
      params: ParamsSchema,
      querystring: JobsQuerySchema,
      response: { 200: z.array(JobSchema), 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    await requireProject(service, id);
    const { limit } = JobsQuerySchema.parse(request.query);
    return repository.listJobs(id, limit);
  });

  app.get("/api/projects/:id/events", async (request, reply) => {
    const { id } = ParamsSchema.parse(request.params);
    await requireProject(service, id);
    const state = orchestrator.getPipeline(id);
    const response = reply.raw;
    reply.hijack();
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    response.flushHeaders();
    response.write(formatSse("pipeline.snapshot", {
      type: "pipeline.snapshot",
      projectId: id,
      data: state,
      at: new Date().toISOString(),
    }));

    const unsubscribe = events.subscribe(id, (event) => {
      const validated = PipelineEventSchema.parse(event);
      response.write(formatSse(validated.type, validated));
    });
    const heartbeat = setInterval(() => {
      response.write(formatSse("heartbeat", {
        type: "heartbeat",
        projectId: id,
        data: null,
        at: new Date().toISOString(),
      }));
    }, 15_000);
    heartbeat.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    response.on("close", cleanup);
    response.on("error", cleanup);
  });
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
