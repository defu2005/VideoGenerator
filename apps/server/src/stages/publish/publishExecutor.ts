import { isPublishStage } from "@vg/shared";
import type { StageContext, StageExecutor, StageResult } from "../../pipeline/stageExecutor.js";
import { StageError } from "../../pipeline/stageExecutor.js";
import type { PublishService } from "../../publishing/publishService.js";
import { YoutubeQuotaExceededError } from "../../publishing/youtubePublisher.js";

/** PUBLISH side-job: uploads via PublisherRegistry. Scope = publicationId. */
export class PublishExecutor implements StageExecutor {
  readonly stage = "PUBLISH" as const;

  constructor(private readonly publish: PublishService) {}

  async run(context: StageContext): Promise<StageResult> {
    if (!isPublishStage(context.job.stage)) {
      throw new StageError("Not a publish job", "INVALID_JOB", false);
    }
    const publicationId = context.job.scope;
    if (!publicationId) {
      throw new StageError("PUBLISH job missing publication id in scope", "INVALID_JOB", false);
    }

    context.reportProgress(1, "Chuẩn bị đăng");
    this.publish.markUploading(publicationId);

    try {
      const prepared = await this.publish.prepareUpload(publicationId, context.signal);
      const result = await prepared.publisher.upload(
        prepared.input,
        prepared.tokens,
        context.signal,
        (progress) => {
          this.publish.updateProgress(publicationId, progress);
          context.reportProgress(Math.max(1, Math.min(99, progress)), "Đang tải lên");
        },
      );
      this.publish.markPublished(publicationId, result);
      const warnNote = result.warnings?.length ? ` (${result.warnings.length} cảnh báo)` : "";
      return { message: `Đã đăng: ${result.externalUrl}${warnNote}` };
    } catch (error) {
      if (error instanceof YoutubeQuotaExceededError || (error as { code?: string }).code === "YOUTUBE_QUOTA_EXCEEDED") {
        const rescheduleAt = error instanceof YoutubeQuotaExceededError
          ? error.rescheduleAt
          : (error as { rescheduleAt?: string }).rescheduleAt;
        const message = error instanceof Error ? error.message : String(error);
        if (rescheduleAt) {
          this.publish.rescheduleForQuota(publicationId, rescheduleAt, message);
          return { message: `Hết quota YouTube — lên lịch lại lúc ${rescheduleAt}` };
        }
      }

      const status = (error as { status?: number }).status;
      const retryableFlag = (error as { retryable?: boolean }).retryable;
      const message = error instanceof Error ? error.message : String(error);

      // Auth 401 → reconnect; other 4xx (except 429) → fail permanently
      if (status === 401) {
        const authMessage = message.includes("kết nối") ? message : "Cần kết nối lại tài khoản";
        this.publish.markFailed(publicationId, authMessage);
        throw new StageError(authMessage, "PUBLISH_AUTH_FAILED", false);
      }
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
        this.publish.markFailed(publicationId, message);
        throw new StageError(message, "PUBLISH_VALIDATION_FAILED", false);
      }

      const retryable = retryableFlag ?? (status === 429 || (typeof status === "number" && status >= 500) || status === undefined);
      const willRetry = retryable && context.job.attempt < context.job.maxAttempts;
      if (!willRetry) {
        this.publish.markFailed(publicationId, message);
      }
      throw new StageError(message, "PUBLISH_UPLOAD_FAILED", retryable);
    }
  }
}
