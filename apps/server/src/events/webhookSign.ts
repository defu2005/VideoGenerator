import { createHmac, timingSafeEqual } from "node:crypto";

/** Standard Webhooks v1. Secret is base64, with an optional `whsec_` prefix. */
export function signWebhook(id: string, timestamp: string, body: string, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

export function webhookSignatureMatches(id: string, timestamp: string, body: string, secret: string, header: string): boolean {
  const expected = signWebhook(id, timestamp, body, secret);
  const left = Buffer.from(expected);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}
