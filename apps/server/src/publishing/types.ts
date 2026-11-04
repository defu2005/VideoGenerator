import type { PlatformId, PublishInput, PublishResult, TokenSet } from "@vg/shared";

export type { PublishInput, PublishResult, TokenSet };

export type PublisherLimits = {
  maxDurationSec: number;
  maxTitleChars: number;
  maxDescriptionChars: number;
  maxTags: number;
  supportsScheduledPublishAt: boolean;
};

export type PublisherIdentity = {
  displayName: string;
  handle?: string;
  externalId: string;
};

export type PublisherOAuth = {
  buildAuthUrl(input: {
    accountId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;
  exchangeCode(
    input: { code: string; redirectUri: string; codeVerifier: string; accountId: string },
    signal: AbortSignal,
  ): Promise<TokenSet>;
  refresh(tokens: TokenSet, signal: AbortSignal, accountId?: string): Promise<TokenSet>;
  revoke?(tokens: TokenSet, signal: AbortSignal, accountId?: string): Promise<void>;
  fetchIdentity(tokens: TokenSet, signal: AbortSignal): Promise<PublisherIdentity>;
};

export interface Publisher {
  platform: PlatformId;
  oauth: PublisherOAuth;
  upload(
    input: PublishInput,
    tokens: TokenSet,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ): Promise<PublishResult>;
  limits: PublisherLimits;
}
