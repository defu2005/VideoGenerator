import { ApiRequestError } from "./apiClient";

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const isClientError = error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
  return failureCount < 2 && !isClientError;
}

export function queryRetryDelay(attemptIndex: number): number {
  return Math.min(1_000 * 2 ** attemptIndex, 30_000);
}
