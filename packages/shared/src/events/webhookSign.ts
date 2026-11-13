export const WEBHOOK_RETRY_MS = [5_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 5 * 3_600_000, 10 * 3_600_000];

export function webhookRetryDelayMs(attempt: number): number | null {
  return WEBHOOK_RETRY_MS[attempt] ?? null;
}

const PRIVATE_HOST = /^(10\.|127\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

export function webhookUrlAllowed(raw: string, allowPrivate = false): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (url.protocol === "http:") return loopback;
  if (url.protocol !== "https:") return false;
  if (!allowPrivate && (PRIVATE_HOST.test(host) || host.endsWith(".local"))) return false;
  return true;
}
