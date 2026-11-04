import {
  AccountConnectionDetailSchema,
  ApiErrorSchema,
  CreatePublicationsBodySchema,
  CreatePublicationsResponseSchema,
  ListPublicationsQuerySchema,
  PlatformAppCredentialsInputSchema,
  PublicationListResponseSchema,
  PublicationSchema,
} from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { PublishService } from "../publishing/publishService.js";
import type { TokenVault } from "../publishing/tokenVault.js";

const ProjectParams = z.object({ id: z.string().uuid() }).strict();
const PublicationParams = z.object({ id: z.string().uuid() }).strict();
const AccountParams = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
}).strict();

const ErrorResponses = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  500: ApiErrorSchema,
};

export function registerPublicationRoutes(
  app: FastifyInstance,
  deps: {
    publish: PublishService;
    vault: TokenVault;
  },
): void {
  app.get("/api/projects/:id/publications", {
    schema: {
      params: ProjectParams,
      response: { 200: PublicationListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProjectParams.parse(request.params);
    return { items: deps.publish.listForProject(id) };
  });

  app.post("/api/projects/:id/publications", {
    schema: {
      params: ProjectParams,
      body: CreatePublicationsBodySchema,
      response: { 201: CreatePublicationsResponseSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const { id } = ProjectParams.parse(request.params);
    const body = CreatePublicationsBodySchema.parse(request.body);
    const items = await deps.publish.createForProject(id, body);
    return reply.code(201).send({ items });
  });

  app.get("/api/publications", {
    schema: {
      querystring: ListPublicationsQuerySchema,
      response: { 200: PublicationListResponseSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const query = ListPublicationsQuerySchema.parse(request.query);
    return deps.publish.listGlobal(query);
  });

  app.post("/api/publications/:id/cancel", {
    schema: {
      params: PublicationParams,
      response: { 200: PublicationSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = PublicationParams.parse(request.params);
    return deps.publish.cancel(id);
  });

  app.post("/api/publications/:id/retry", {
    schema: {
      params: PublicationParams,
      response: { 200: PublicationSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = PublicationParams.parse(request.params);
    return deps.publish.retry(id);
  });

  app.delete("/api/profiles/:id/accounts/:accountId/connection", {
    schema: {
      params: AccountParams,
      response: {
        200: z.object({ ok: z.literal(true) }).strict(),
        ...ErrorResponses,
      },
    },
  }, async (request) => {
    const { id, accountId } = AccountParams.parse(request.params);
    await deps.publish.disconnect(id, accountId, AbortSignal.timeout(15_000));
    return { ok: true as const };
  });

  app.get("/api/profiles/:id/accounts/:accountId/connection", {
    schema: {
      params: AccountParams,
      response: { 200: AccountConnectionDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id, accountId } = AccountParams.parse(request.params);
    const account = deps.publish.requireAccount(accountId);
    if (account.profile_id !== id) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    return deps.publish.connectionDetail(accountId);
  });

  app.post("/api/profiles/:id/accounts/:accountId/connection/check", {
    schema: {
      params: AccountParams,
      response: { 200: AccountConnectionDetailSchema, ...ErrorResponses },
    },
  }, async (request) => {
    const { id, accountId } = AccountParams.parse(request.params);
    const account = deps.publish.requireAccount(accountId);
    if (account.profile_id !== id) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    await deps.publish.checkConnection(accountId, AbortSignal.timeout(30_000));
    return deps.publish.connectionDetail(accountId);
  });

  app.put("/api/profiles/:id/accounts/:accountId/app-credentials", {
    schema: {
      params: AccountParams,
      body: PlatformAppCredentialsInputSchema,
      response: {
        200: z.object({
          configured: z.literal(true),
          idHint: z.string(),
        }).strict(),
        ...ErrorResponses,
      },
    },
  }, async (request) => {
    const { id, accountId } = AccountParams.parse(request.params);
    const body = PlatformAppCredentialsInputSchema.parse(request.body);
    const account = deps.publish.requireAccount(accountId);
    if (account.profile_id !== id) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    const { idHint } = deps.vault.storeAppCredentials({
      accountId,
      platform: account.platform,
      credentials: { clientId: body.clientId, clientSecret: body.clientSecret },
    });
    return { configured: true as const, idHint };
  });

  app.delete("/api/profiles/:id/accounts/:accountId/app-credentials", {
    schema: {
      params: AccountParams,
      response: {
        200: z.object({ ok: z.literal(true) }).strict(),
        ...ErrorResponses,
      },
    },
  }, async (request) => {
    const { id, accountId } = AccountParams.parse(request.params);
    const account = deps.publish.requireAccount(accountId);
    if (account.profile_id !== id) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Platform account not found");
    deps.vault.deleteAppCredentials(accountId);
    return { ok: true as const };
  });
}
