import { PlatformIdSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import type { OAuthStateStore } from "../publishing/oauthState.js";
import type { PublishService } from "../publishing/publishService.js";
import type { PublisherRegistry } from "../publishing/registry.js";

const StartQuerySchema = z.object({
  accountId: z.string().uuid(),
}).strict();

const CallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
}).passthrough();

export function registerOAuthRoutes(
  app: FastifyInstance,
  deps: {
    publish: PublishService;
    registry: PublisherRegistry;
    oauthState: OAuthStateStore;
  },
): void {
  app.get("/api/oauth/:platform/start", async (request, reply) => {
    const platform = PlatformIdSchema.parse((request.params as { platform: string }).platform);
    const { accountId } = StartQuerySchema.parse(request.query);
    const account = deps.publish.requireAccount(accountId);
    if (account.platform !== platform) {
      throw new AppError(400, "PLATFORM_MISMATCH", "Account platform does not match OAuth path");
    }
    const publisher = deps.registry.get(platform);
    if (!publisher) {
      throw new AppError(400, "PUBLISHER_UNAVAILABLE", `Publisher for ${platform} is not available`);
    }
    const redirectUri = deps.publish.oauthRedirectUri(platform);
    const { state, codeChallenge } = deps.oauthState.create({
      accountId,
      platform,
      redirectUri,
      // TikTok docs: code_challenge = lowercase hex of SHA-256(verifier).
      ...(platform === "tiktok" ? { challengeEncoding: "hex" as const } : {}),
    });
    const authUrl = publisher.oauth.buildAuthUrl({
      accountId,
      redirectUri,
      state,
      codeChallenge,
    });
    return reply.redirect(authUrl);
  });

  app.get("/api/oauth/:platform/callback", async (request, reply) => {
    const platform = PlatformIdSchema.parse((request.params as { platform: string }).platform);
    const query = CallbackQuerySchema.parse(request.query);
    if (query.error) {
      throw new AppError(400, "OAUTH_DENIED", query.error_description ?? query.error);
    }
    if (!query.state || !query.code) {
      throw new AppError(400, "OAUTH_INVALID", "Missing code or state");
    }
    const pending = deps.oauthState.take(query.state);
    if (!pending || pending.platform !== platform) {
      throw new AppError(400, "OAUTH_INVALID_STATE", "Invalid or expired OAuth state");
    }
    const publisher = deps.registry.require(platform);
    const tokens = await publisher.oauth.exchangeCode(
      {
        code: query.code,
        redirectUri: pending.redirectUri,
        codeVerifier: pending.codeVerifier,
        accountId: pending.accountId,
      },
      AbortSignal.timeout(30_000),
    );
    const identity = await publisher.oauth.fetchIdentity(tokens, AbortSignal.timeout(30_000));
    const { profileId } = deps.publish.applyOAuthSuccess({
      accountId: pending.accountId,
      tokens,
      identity,
    });
    const profileUrl = deps.publish.webProfileUrl(profileId);
    if (platform === "facebook_reels" || platform === "instagram_reels") {
      const url = new URL(profileUrl);
      url.searchParams.set("metaPick", pending.accountId);
      return reply.redirect(url.toString());
    }
    return reply.redirect(profileUrl);
  });
}
