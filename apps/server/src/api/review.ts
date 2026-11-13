import {
  ApiErrorSchema,
  ReviewApplyResultSchema,
  ReviewEstimateSchema,
  ReviewGetResponseSchema,
  ReviewMessageSchema,
  ReviewProposalSchema,
  ReviewSendSchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import type { Project } from "@vg/shared";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { ReviewService } from "../review/service.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const ApplyParams = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  index: z.coerce.number().int().nonnegative(),
}).strict();
const EstimateQuery = z.object({
  text: z.string().max(4000).optional(),
}).strict();
const Errors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  502: ApiErrorSchema,
};

export function registerReviewRoutes(
  app: FastifyInstance,
  review: ReviewService,
  projectService: { getProject: (id: string) => Promise<Project | undefined> },
): void {
  async function requireProject(id: string): Promise<Project> {
    const project = await projectService.getProject(id);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  app.get("/api/projects/:id/review", {
    schema: {
      params: ProjectParams,
      querystring: EstimateQuery,
      response: { 200: ReviewGetResponseSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const query = EstimateQuery.parse(request.query);
    const project = await requireProject(id);
    return review.get(project, query.text);
  });

  app.get("/api/projects/:id/review/estimate", {
    schema: {
      params: ProjectParams,
      querystring: z.object({ text: z.string().max(4000).default("") }).strict(),
      response: { 200: ReviewEstimateSchema, 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const { text } = z.object({ text: z.string().max(4000).default("") }).strict().parse(request.query);
    const project = await requireProject(id);
    return review.estimate(project, text);
  });

  app.get("/api/projects/:id/review/context", {
    schema: { params: ProjectParams, response: { 404: ApiErrorSchema } },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await requireProject(id);
    const built = review.getContextDocument(project);
    return { contextHash: built.contextHash, document: built.document };
  });

  app.post("/api/projects/:id/review/messages", {
    schema: {
      params: ProjectParams,
      body: ReviewSendSchema,
      response: { 200: ReviewMessageSchema, ...Errors },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const body = ReviewSendSchema.parse(request.body);
    const project = await requireProject(id);
    return review.send(project, body.text, {
      attachImages: body.attachImages,
      logger: request.log,
    });
  });

  app.post("/api/projects/:id/review/proposals/:messageId/:index/apply", {
    schema: {
      params: ApplyParams,
      response: { 200: ReviewApplyResultSchema, ...Errors },
    },
  }, async (request) => {
    const { id, messageId, index } = ApplyParams.parse(request.params);
    const project = await requireProject(id);
    return review.applyProposal(project, messageId, index);
  });

  app.post("/api/projects/:id/review/apply", {
    schema: {
      params: ProjectParams,
      body: z.object({
        proposal: ReviewProposalSchema,
        source: z.enum(["mcp", "assistant"]).optional(),
      }).strict(),
      response: { 200: ReviewApplyResultSchema, ...Errors },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const { proposal, source } = z.object({
      proposal: ReviewProposalSchema,
      source: z.enum(["mcp", "assistant"]).optional(),
    }).strict().parse(request.body);
    const project = await requireProject(id);
    return review.applyRawProposal(project, proposal, source ?? "mcp");
  });

  app.post("/api/projects/:id/review/undo", {
    schema: { params: ProjectParams, response: { 404: ApiErrorSchema, 409: ApiErrorSchema } },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    await requireProject(id);
    return review.undoTimeline(id);
  });

  app.delete("/api/projects/:id/review", {
    schema: {
      params: ProjectParams,
      response: { 200: z.object({ ok: z.literal(true) }).strict(), 404: ApiErrorSchema },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    const project = await requireProject(id);
    review.reset(project);
    return { ok: true as const };
  });
}
