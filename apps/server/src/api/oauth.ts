import { PlatformIdSchema } from "@vg/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { oauthFailureMessage, oauthResultHtml } from "../publishing/oauthResult.js";
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
    if (account.connection === "ERROR") deps.publish.setConnection(accountId, "NOT_CONNECTED", null);
    return reply.redirect(authUrl);
  });

  // The query can contain authorization codes and platform error details.
  app.get("/api/oauth/:platform/callback", { logLevel: "silent" }, async (request, reply) => {
    const platform = PlatformIdSchema.safeParse((request.params as { platform: string }).platform);
    const parsed = CallbackQuerySchema.safeParse(request.query);
    const query = parsed.success ? parsed.data : undefined;
    const state = platform.success && query?.state ? deps.oauthState.take(query.state) : null;
    const pending = state && platform.success && state.platform === platform.data ? state : null;
    const accountsUrl = new URL("/accounts", deps.publish.webProfileUrl("")).href;
    const result = (title: string, message: string, editAppUrl?: string) => reply
      .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .type("text/html; charset=utf-8")
      .send(oauthResultHtml(title, message, accountsUrl, editAppUrl));
    const fail = (code: string, description = "") => {
      const message = oauthFailureMessage(code, description, pending?.redirectUri
        ?? (platform.success ? deps.publish.oauthRedirectUri(platform.data) : ""));
      if (pending) deps.publish.setConnection(pending.accountId, "ERROR", message);
      const editAppUrl = pending ? new URL(accountsUrl) : new URL("/settings/connections#platforms", accountsUrl);
      if (pending) editAppUrl.searchParams.set("editApp", pending.accountId);
      return result("Chưa kết nối được", message,
        code === "invalid_client" || code === "unauthorized_client" ? editAppUrl.href : undefined);
    };
    if (query?.error) return fail(query.error, query.error_description);
    if (!platform.success || !query?.code || !pending) return fail("invalid_state");
    try {
      const publisher = deps.registry.require(platform.data);
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
      if (platform.data === "facebook_reels" || platform.data === "instagram_reels") {
        const url = new URL(profileUrl);
        url.searchParams.set("metaPick", pending.accountId);
        return reply.redirect(url.toString());
      }
      if (platform.data === "mock") return reply.redirect(profileUrl);
      return result(`Đã kết nối ${identity.displayName}${identity.handle ? ` (${identity.handle})` : ""}`,
        "Bạn có thể đóng tab này và quay lại app.");
    } catch (error) {
      const code = error instanceof Error && "oauthCode" in error ? String(error.oauthCode)
        : error instanceof Error && "code" in error ? String(error.code) : "oauth_error";
      return fail(code);
    }
  });
}
