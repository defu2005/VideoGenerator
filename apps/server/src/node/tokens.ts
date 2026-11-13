import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Only the hash of a token is ever stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const JOIN_TOKEN_PREFIX = "vgj_";
export const NODE_TOKEN_PREFIX = "vgn_";

export function newJoinToken(): string {
  return `${JOIN_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function newNodeToken(): string {
  return `${NODE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
