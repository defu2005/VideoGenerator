import type { AppConfig } from "../../lib/config.js";
import { parseRetryDelay, sleepWithAbort } from "./retry.js";
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
      const providerError = await errorFromFailedResponse(response);
      if (!providerError.retryable || attempt === 1) throw providerError;
      await sleepWithAbort(parseRetryDelay(response.headers.get("retry-after")) || 250, input.signal);
      lastError = providerError;
    } catch (error) {
      if (input.signal?.aborted) throw input.signal.reason ?? error;
      const timedOut = error instanceof DOMException
        && error.name === "AbortError"
        && String(controller.signal.reason).toLowerCase().includes("timed out");
      if (timedOut) {
        const timeoutError = new ImageProviderError("Image provider request timed out", undefined, true);
        if (attempt === 1) throw timeoutError;
        lastError = timeoutError;
        await sleepWithAbort(250, input.signal);
        continue;
      }
      lastError = error;
      const retryable = !(error instanceof ImageProviderError) || error.retryable;
      if (!retryable || attempt === 1) throw error;
      await sleepWithAbort(250, input.signal);
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

/** Cloudflare (or similar) bot challenge — non-retryable; caller should circuit-break the provider. */
export class ImageProviderBlockedError extends ImageProviderError {
  constructor(message: string, status: number | undefined = 403) {
    super(message, status, false);
    this.name = "ImageProviderBlockedError";
  }
}

async function errorFromFailedResponse(response: Response): Promise<ImageProviderError> {
  const cfMitigated = Boolean(response.headers.get("cf-mitigated"));
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }
  const cloudflareChallenge = (response.status === 403 || response.status === 429)
    && (cfMitigated || bodyText.includes("challenges.cloudflare.com"));
  if (cloudflareChallenge) {
    return new ImageProviderBlockedError(
      `Image provider blocked by Cloudflare (HTTP ${response.status})`,
      response.status,
    );
  }
  const retryable = retryableStatus(response.status);
  return new ImageProviderError(`Image provider returned HTTP ${response.status}`, response.status, retryable);
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function imageSearchHeaders(config: AppConfig): HeadersInit {
  return { "User-Agent": config.IMAGE_SEARCH_USER_AGENT };
}
