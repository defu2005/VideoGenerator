import type { AppConfig } from "../../lib/config.js";
import type { FetchJson } from "./types.js";

export async function fetchJsonWithRetry(input: {
  url: URL;
  init?: RequestInit;
  config: AppConfig;
  fetchImpl?: FetchJson;
  signal?: AbortSignal;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("Image search timed out")), input.config.IMAGE_SEARCH_TIMEOUT_MS);
    try {
      const response = await fetchImpl(input.url, {
        ...input.init,
        signal: controller.signal,
      });
      if (response.ok) return await response.json() as unknown;
      if (!retryableStatus(response.status) || attempt === 1) {
        throw new ImageProviderError(`Image provider returned HTTP ${response.status}`, response.status, false);
      }
      await sleep(retryDelay(response.headers.get("retry-after")), input.signal);
      lastError = new ImageProviderError(`Image provider returned HTTP ${response.status}`, response.status, true);
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      const timedOut = error instanceof DOMException
        && error.name === "AbortError"
        && String(controller.signal.reason).toLowerCase().includes("timed out");
      if (timedOut) {
        const timeoutError = new ImageProviderError("Image provider request timed out", undefined, true);
        if (attempt === 1) throw timeoutError;
        lastError = timeoutError;
        await sleep(250, input.signal);
        continue;
      }
      lastError = error;
      const retryable = !(error instanceof ImageProviderError) || error.retryable;
      if (!retryable || attempt === 1) throw error;
      await sleep(250, input.signal);
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Image provider request failed");
}

export class ImageProviderError extends Error {
  constructor(message: string, public readonly status: number | undefined, public readonly retryable: boolean) {
    super(message);
    this.name = "ImageProviderError";
  }
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelay(value: string | null): number {
  if (!value) return 250;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 250 : Math.max(0, date - Date.now());
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Request aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function imageSearchHeaders(config: AppConfig): HeadersInit {
  return { "User-Agent": config.IMAGE_SEARCH_USER_AGENT };
}
