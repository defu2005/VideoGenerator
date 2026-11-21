import { AppError } from "../lib/errors.js";
import { ImageDownloadError } from "../services/imageStore.js";

export function downloadError(error: unknown): AppError {
  const reason = error instanceof Error ? error.message : String(error);
  return new AppError(422, "IMAGE_DOWNLOAD_FAILED", reason);
}

export const NON_RETRYABLE_DOWNLOAD_STATUSES = new Set([401, 403, 404, 410]);

export function isNonRetryableHttpStatus(status: number | undefined): boolean {
  return status != null && NON_RETRYABLE_DOWNLOAD_STATUSES.has(status);
}

export function isRetryableDownloadError(error: unknown): boolean {
  if (error instanceof ImageDownloadError) {
    if (isNonRetryableHttpStatus(error.status)) return false;
    return error.retryable;
  }
  if (error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED") {
    const details = error.details as { retryable?: boolean; status?: number } | undefined;
    if (isNonRetryableHttpStatus(details?.status)) return false;
    return details?.retryable === true;
  }
  return false;
}

export function isImageDownloadFailedError(error: unknown): boolean {
  if (error instanceof ImageDownloadError) return true;
  return error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED";
}

export function downloadFailureStatus(error: unknown): number | null {
  if (error instanceof ImageDownloadError) return error.status ?? null;
  if (error instanceof AppError && error.code === "IMAGE_DOWNLOAD_FAILED") {
    const status = (error.details as { status?: number } | undefined)?.status;
    return status ?? null;
  }
  return null;
}
