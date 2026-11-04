import { randomUUID } from "node:crypto";
import type { PublishInput, PublishResult, TokenSet } from "@vg/shared";
import type { Publisher } from "./types.js";

export type MockPublisherBehavior = {
  /** Simulate HTTP status on upload; cleared after one use when set via once*. */
  uploadStatus?: number;
  refreshFail?: boolean;
  revokeCalled?: boolean;
};

/**
 * Test-only publisher. No network. "Uploads" by returning a fake URL.
 * Controllable via `behavior` for retry / auth failure tests.
 */
export class MockPublisher implements Publisher {
  readonly platform = "mock" as const;
  readonly limits = {
    maxDurationSec: 3600,
    maxTitleChars: 100,
    maxDescriptionChars: 5000,
    maxTags: 15,
    supportsScheduledPublishAt: true,
  };

  readonly behavior: MockPublisherBehavior = {};
  private uploadCalls = 0;
  private onceStatuses: number[] = [];

  /** Queue HTTP-like statuses for successive uploads (e.g. [429, 200]). */
  queueUploadStatuses(...statuses: number[]): void {
    this.onceStatuses.push(...statuses);
  }

  get uploadCallCount(): number {
    return this.uploadCalls;
  }

  readonly oauth = {
    buildAuthUrl: (input: {
      accountId: string;
      redirectUri: string;
      state: string;
      codeChallenge: string;
    }): string => {
      const url = new URL("https://mock.local/oauth/authorize");
      url.searchParams.set("client_id", "mock-client");
      url.searchParams.set("redirect_uri", input.redirectUri);
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("account_id", input.accountId);
      return url.toString();
    },

    exchangeCode: async (
      input: { code: string; redirectUri: string; codeVerifier: string; accountId: string },
      _signal: AbortSignal,
    ): Promise<TokenSet> => {
      void _signal;
      void input.accountId;
      if (!input.code || input.code === "bad") {
        throw Object.assign(new Error("Invalid authorization code"), { status: 400 });
      }
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      return {
        accessToken: `mock-access-${input.code}`,
        refreshToken: `mock-refresh-${input.codeVerifier.slice(0, 8)}`,
        expiresAt,
        scopes: ["mock.upload", "mock.identity"],
        tokenType: "Bearer",
      };
    },

    refresh: async (tokens: TokenSet, _signal: AbortSignal, _accountId?: string): Promise<TokenSet> => {
      void _signal;
      void _accountId;
      if (this.behavior.refreshFail) {
        throw Object.assign(new Error("refresh failed"), { status: 401 });
      }
      if (!tokens.refreshToken) {
        throw Object.assign(new Error("no refresh token"), { status: 400 });
      }
      return {
        accessToken: `mock-access-refreshed-${randomUUID().slice(0, 8)}`,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: tokens.scopes,
        tokenType: "Bearer",
      };
    },

    revoke: async (_tokens: TokenSet, _signal: AbortSignal, _accountId?: string): Promise<void> => {
      void _tokens;
      void _signal;
      void _accountId;
      this.behavior.revokeCalled = true;
    },

    fetchIdentity: async (tokens: TokenSet, _signal: AbortSignal): Promise<{
      displayName: string;
      handle?: string;
      externalId: string;
    }> => {
      void _signal;
      if (!tokens.accessToken) {
        throw Object.assign(new Error("missing token"), { status: 401 });
      }
      return {
        displayName: "Mock Channel",
        handle: "@mock_channel",
        externalId: "mock-ext-1",
      };
    },
  };

  async upload(
    input: PublishInput,
    tokens: TokenSet,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ): Promise<PublishResult> {
    if (signal.aborted) throw new Error("aborted");
    this.uploadCalls += 1;
    const status = this.onceStatuses.shift() ?? this.behavior.uploadStatus ?? 200;
    onProgress(10);
    if (status === 429) {
      throw Object.assign(new Error("Too many requests"), { status: 429, retryable: true });
    }
    if (status === 401 || status === 403) {
      throw Object.assign(new Error("Unauthorized"), { status, retryable: false });
    }
    if (status >= 500) {
      throw Object.assign(new Error(`Upstream ${status}`), { status, retryable: true });
    }
    if (status >= 400) {
      throw Object.assign(new Error(`Bad request ${status}`), { status, retryable: false });
    }
    if (!tokens.accessToken) {
      throw Object.assign(new Error("missing access token"), { status: 401, retryable: false });
    }
    onProgress(50);
    const externalId = `mock-video-${randomUUID().slice(0, 8)}`;
    onProgress(100);
    return {
      externalId,
      externalUrl: `https://mock.local/watch/${externalId}?title=${encodeURIComponent(input.title.slice(0, 40))}`,
      warnings: [],
    };
  }
}
