import { LlmError } from "./types.js";
import { isDailyQuotaMessage } from "@vg/shared";

export async function fetchLlmJson(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("LLM request timed out", "TimeoutError")), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch {
      if (controller.signal.aborted) {
        throw new LlmError("LLM request timed out or was aborted", "LLM_TIMEOUT", true);
      }
      throw new LlmError("LLM provider network request failed", "LLM_UNAVAILABLE", true);
    }

    if (!response.ok) {
      const status = response.status;
      const body = await response.text().catch(() => "");
      const retryAfterMs = parseRetryAfterMs(response.headers, Date.now());
      if (status === 401 || status === 403) throw new LlmError("LLM provider authentication failed", "LLM_AUTH", false, status);
      if (status === 429) {
        const quota = isQuotaBody(body);
        if (quota) {
          throw new LlmError(body.slice(0, 300) || "LLM quota exhausted", "LLM_QUOTA_EXHAUSTED", false, status, undefined, retryAfterMs);
        }
        throw new LlmError("LLM provider rate limit exceeded", "LLM_RATE_LIMIT", true, status, undefined, retryAfterMs);
      }
      if (status === 400) throw new LlmError("LLM provider rejected the request", "LLM_BAD_REQUEST", false, status);
      if (status >= 500) throw new LlmError("LLM provider is unavailable", "LLM_UNAVAILABLE", true, status);
      throw new LlmError(`LLM provider request failed with status ${status}`, "LLM_BAD_REQUEST", false, status);
    }

    try {
      return await response.json() as unknown;
    } catch {
      if (controller.signal.aborted) {
        throw new LlmError("LLM request timed out or was aborted", "LLM_TIMEOUT", true);
      }
      throw new LlmError("LLM provider returned malformed JSON", "LLM_UNAVAILABLE", true, response.status);
    }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseRetryAfterMs(headers: Headers, nowMs: number): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  }
  for (const name of ["x-ratelimit-reset", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]) {
    const raw = headers.get(name);
    if (!raw) continue;
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    if (num > 1_000_000_000) return Math.max(0, num * 1000 - nowMs);
    return Math.max(0, num * 1000);
  }
  return undefined;
}

function isQuotaBody(body: string): boolean {
  return isDailyQuotaMessage(body) || /quota|resource_exhausted|exhausted/i.test(body);
}
