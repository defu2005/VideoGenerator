import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { jobErrorFromCaught } from "../src/jobs/worker.js";
import { ImageDownloadError } from "../src/services/imageStore.js";
import { StageError } from "../src/pipeline/stageExecutor.js";

describe("jobErrorFromCaught", () => {
  it("marks 401/403/404/410 image downloads as non-retryable", () => {
    for (const status of [401, 403, 404, 410]) {
      expect(jobErrorFromCaught(new ImageDownloadError(`HTTP ${status}`, status, false))).toMatchObject({
        code: "IMAGE_DOWNLOAD_FAILED",
        retryable: false,
      });
      expect(jobErrorFromCaught(new AppError(422, "IMAGE_DOWNLOAD_FAILED", `HTTP ${status}`, {
        retryable: false,
        status,
      }))).toMatchObject({
        code: "IMAGE_DOWNLOAD_FAILED",
        retryable: false,
      });
    }
  });

  it("keeps StageError retryability and defaults unknown errors to retryable", () => {
    expect(jobErrorFromCaught(new StageError("boom", "X", false))).toMatchObject({
      code: "X",
      retryable: false,
    });
    expect(jobErrorFromCaught(new Error("other"))).toMatchObject({
      code: "STAGE_EXECUTION_FAILED",
      retryable: true,
    });
  });
});
