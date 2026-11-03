import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./apiClient";
import { queryRetryDelay, shouldRetryQuery } from "./queryRetry";

describe("query retries", () => {
  it("retries at most twice and does not retry 4xx responses", () => {
    expect(shouldRetryQuery(0, new Error("network error"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("network error"))).toBe(true);
    expect(shouldRetryQuery(2, new Error("network error"))).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError(404, "NOT_FOUND", "Missing"))).toBe(false);
    expect(shouldRetryQuery(0, new ApiRequestError(503, "UNAVAILABLE", "Try later"))).toBe(true);
  });

  it("uses exponential retry delays capped at 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 5].map(queryRetryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
  });
});
