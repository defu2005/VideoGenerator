import { describe, expect, it } from "vitest";
import { pipelinePollingDelay } from "./pipelinePolling";

describe("pipeline polling fallback", () => {
  it("backs off exponentially and caps the interval at 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 5].map(pipelinePollingDelay)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000,
    ]);
  });
});
