import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ApiErrorSchema } from "@vg/shared";
import { readGuideMarkdown, searchGuide } from "../help/loadGuide.js";

const PageParamsSchema = z.object({
  page: z.string().min(1).max(80),
}).strict();

const SearchQuerySchema = z.object({
  q: z.string().max(200).default(""),
}).strict();

const HelpPageSchema = z.object({
  page: z.string(),
  markdown: z.string(),
}).strict();

const HelpSearchSchema = z.object({
  query: z.string(),
  sections: z.array(z.object({
    page: z.string(),
    anchor: z.string(),
    title: z.string(),
    text: z.string(),
    href: z.string(),
  }).strict()),
}).strict();

export function registerHelpRoutes(app: FastifyInstance): void {
  app.get("/api/help/search", {
    schema: {
      querystring: SearchQuerySchema,
      response: { 200: HelpSearchSchema, 500: ApiErrorSchema },
    },
  }, async (request) => {
    const { q } = SearchQuerySchema.parse(request.query);
    return searchGuide(q);
  });

  app.get("/api/help/:page", {
    schema: {
      params: PageParamsSchema,
      response: {
        200: HelpPageSchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        500: ApiErrorSchema,
      },
    },
  }, async (request) => {
    const { page } = PageParamsSchema.parse(request.params);
    return { page, markdown: readGuideMarkdown(page) };
  });
}
