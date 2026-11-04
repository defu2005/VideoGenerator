import { createHash, randomBytes } from "node:crypto";

export type OAuthPending = {
  accountId: string;
  platform: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

const TTL_MS = 10 * 60 * 1000;

/** In-memory PKCE + state store with 10-minute TTL. */
export class OAuthStateStore {
  private readonly pending = new Map<string, OAuthPending>();

  create(input: {
    accountId: string;
    platform: string;
    redirectUri: string;
    /** TikTok Login Kit desktop requires hex(SHA-256(verifier)); Google uses base64url. */
    challengeEncoding?: "base64url" | "hex";
  }): {
    state: string;
    codeVerifier: string;
    codeChallenge: string;
  } {
    this.sweep();
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(codeVerifier);
    const codeChallenge = input.challengeEncoding === "hex"
      ? hash.digest("hex")
      : hash.digest("base64url");
    this.pending.set(state, {
      accountId: input.accountId,
      platform: input.platform,
      codeVerifier,
      redirectUri: input.redirectUri,
      createdAt: Date.now(),
    });
    return { state, codeVerifier, codeChallenge };
  }

  take(state: string): OAuthPending | null {
    this.sweep();
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (Date.now() - entry.createdAt > TTL_MS) return null;
    return entry;
  }

  private sweep(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [key, value] of this.pending) {
      if (value.createdAt < cutoff) this.pending.delete(key);
    }
  }
}
