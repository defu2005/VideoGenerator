import {
  ApiErrorSchema,
  CreateProjectInputSchema,
  RecommendBriefResponseSchema,
  recommendBrief,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";

export function registerRecommendationRoutes(app: FastifyInstance): void {
  app.post("/api/recommendations", {
    schema: {
      body: CreateProjectInputSchema,
      response: { 200: RecommendBriefResponseSchema, 400: ApiErrorSchema, 500: ApiErrorSchema },
    },
  }, async (request) => {
    const input = CreateProjectInputSchema.parse(request.body);
    const supplied = {
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.style === undefined ? {} : { style: input.style }),
      ...(input.tone === undefined ? {} : { tone: input.tone }),
      ...(input.audience === undefined ? {} : { audience: input.audience }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.targetDurationSec === undefined ? {} : { targetDurationSec: input.targetDurationSec }),
      ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
      ...(input.wordsPerMinute === undefined ? {} : { wordsPerMinute: input.wordsPerMinute }),
      ...(input.sceneDurationSec === undefined ? {} : { sceneDurationSec: input.sceneDurationSec }),
      ...(input.visualStyle === undefined ? {} : { visualStyle: input.visualStyle }),
      ...(input.subtitles === undefined ? {} : { subtitles: input.subtitles }),
      ...(input.music === undefined ? {} : { music: input.music }),
      ...(input.userSet === undefined ? {} : { userSet: input.userSet }),
      ...input.settings,
    };
    const userSet = [...new Set([
      ...(supplied.userSet ?? []),
      ...(input.title === undefined ? [] : ["title"]),
      ...Object.keys(supplied).filter((field) => field !== "userSet" && field !== "subtitles" && field !== "music" && field !== "guidelines"),
      ...Object.keys(supplied.subtitles ?? {}).map((field) => `subtitles.${field}`),
      ...Object.keys(supplied.music ?? {}).map((field) => `music.${field}`),
    ])];
    const { guidelines: ignoredGuidelines, ...briefSupplied } = supplied;
    void ignoredGuidelines;
    return recommendBrief({
      ...input,
      settings: { ...briefSupplied, userSet },
    });
  });
}
