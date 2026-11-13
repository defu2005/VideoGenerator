import {
  ApiErrorSchema,
  ApplyMarketDefaultsSchema,
  MarketCodeSchema,
  PlatformAccountInputSchema,
  PlatformAccountSchema,
  PlatformAccountUpdateSchema,
  ProfileDetailSchema,
  ProfileInputSchema,
  ProfileListQuerySchema,
  ProfileListResponseSchema,
  ProfileUpdateSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { ProfileService } from "../services/profileService.js";
import { AppError } from "../lib/errors.js";
import { touchFromOwner } from "../operator/autopilot.js";
import { getMarketInfo, listResolvedMarkets } from "../knowledge/markets.js";

const ProfileParamsSchema = z.object({ id: z.string().uuid() }).strict();
const AccountParamsSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
}).strict();

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
};

export function registerProfileRoutes(app: FastifyInstance, service: ProfileService, sqlite?: Database.Database): void {
  if (sqlite) {
    app.get("/api/markets", async () => ({ markets: listResolvedMarkets(sqlite) }));
    app.get("/api/markets/:code", async (request) =>
      getMarketInfo(sqlite, z.object({ code: MarketCodeSchema }).parse(request.params).code));
  }
  app.get("/api/profiles/:id/market-defaults", {
    schema: { params: ProfileParamsSchema, querystring: z.object({ code: MarketCodeSchema }).strict() },
  }, async (request) => service.previewMarketDefaults(
    ProfileParamsSchema.parse(request.params).id, z.object({ code: MarketCodeSchema }).parse(request.query).code,
  ));
  app.post("/api/profiles/:id/apply-market-defaults", {
    schema: { params: ProfileParamsSchema, body: ApplyMarketDefaultsSchema, response: { 200: ProfileDetailSchema, ...ErrorResponses } },
  }, async (request) => {
    if (request.headers["x-vg-tool-source"] !== undefined) throw new AppError(403, "OWNER_UI_REQUIRED", "Bạn cần xác nhận các trường mặc định.");
    const { code, fields, previewToken } = ApplyMarketDefaultsSchema.parse(request.body);
    return service.applyMarketDefaults(ProfileParamsSchema.parse(request.params).id, code, fields, previewToken);
  });
  app.get("/api/profiles", {
    schema: {
      querystring: ProfileListQuerySchema,
      response: { 200: ProfileListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => service.listProfiles(ProfileListQuerySchema.parse(request.query)));

  app.post("/api/profiles", {
    schema: {
      body: ProfileInputSchema,
      response: { 201: ProfileDetailSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const profile = await service.createProfile(ProfileInputSchema.parse(request.body));
    return reply.code(201).send(profile);
  });

  app.get("/api/profiles/:id", {
    schema: {
      params: ProfileParamsSchema,
      response: { 200: ProfileDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return service.getDetail(id);
  });

  app.patch("/api/profiles/:id", {
    schema: {
      params: ProfileParamsSchema,
      body: ProfileUpdateSchema,
      response: { 200: ProfileDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const body = ProfileUpdateSchema.parse(request.body);
    if (sqlite) {
      if (body.automation) touchFromOwner(request.headers, sqlite, `profile:${id}:automation`);
      if (body.guidelines) touchFromOwner(request.headers, sqlite, `profile:${id}:guidelines`);
    }
    return service.updateProfile(id, body, request.headers["x-vg-tool-source"] === undefined);
  });

  app.post("/api/profiles/:id/archive", {
    schema: {
      params: ProfileParamsSchema,
      response: { 200: ProfileDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return service.setArchived(id, true);
  });

  app.post("/api/profiles/:id/unarchive", {
    schema: {
      params: ProfileParamsSchema,
      response: { 200: ProfileDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return service.setArchived(id, false);
  });

  app.post("/api/profiles/:id/accounts", {
    schema: {
      params: ProfileParamsSchema,
      body: PlatformAccountInputSchema,
      response: { 201: PlatformAccountSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const account = await service.addAccount(id, PlatformAccountInputSchema.parse(request.body));
    return reply.code(201).send(account);
  });

  app.patch("/api/profiles/:id/accounts/:accountId", {
    schema: {
      params: AccountParamsSchema,
      body: PlatformAccountUpdateSchema,
      response: { 200: PlatformAccountSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id, accountId } = AccountParamsSchema.parse(request.params);
    return service.updateAccount(id, accountId, PlatformAccountUpdateSchema.parse(request.body));
  });

  app.delete("/api/profiles/:id/accounts/:accountId", {
    schema: {
      params: AccountParamsSchema,
      response: { 204: z.null(), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const { id, accountId } = AccountParamsSchema.parse(request.params);
    const { unfinished } = z.object({ unfinished: z.literal("true").optional() }).parse(request.query);
    await service.deleteAccount(id, accountId, unfinished === "true");
    return reply.code(204).send(null);
  });
}

export function assertProfileService(service: ProfileService | undefined): ProfileService {
  if (!service) throw new AppError(500, "INTERNAL_ERROR", "Profile service unavailable");
  return service;
}
