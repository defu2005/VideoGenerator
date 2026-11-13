import { PROTECTED_PROJECT_ID, isPublishStage } from "@vg/shared";
import type { StageContext, StageExecutor, StageResult } from "../../pipeline/stageExecutor.js";
import { StageError } from "../../pipeline/stageExecutor.js";
import type { PublishService } from "../../publishing/publishService.js";
import { YoutubeQuotaExceededError } from "../../publishing/youtubePublisher.js";

/** PUBLISH side-job: uploads via PublisherRegistry. Scope = publicationId. */
export class PublishExecutor implements StageExecutor {
  readonly stage = "PUBLISH" as const;

  constructor(private readonly publish: PublishService) {}

  async run(context: StageContext): Promise<StageResult> {
    if (context.project.id === PROTECTED_PROJECT_ID) {
      throw new StageError("Dự án này được bảo vệ, không thể đăng tự động.", "PROTECTED_PROJECT", false);
    }
    if (!isPublishStage(context.job.stage)) {
      throw new StageError("Not a publish job", "INVALID_JOB", false);
    }
    const publicationId = context.job.scope;
    if (!publicationId) {
      throw new StageError("PUBLISH job missing publication id in scope", "INVALID_JOB", false);
    }

    const checkpoint = this.publish.require(publicationId);
    if (checkpoint.status === "PUBLISHED") {
      return { message: `Đã đăng: ${checkpoint.externalUrl ?? publicationId}` };
    }
    if (checkpoint.status === "UPLOADING") {
      const message = "Chưa rõ bài đã đăng hay chưa. Kiểm tra trên nền tảng trước khi thử lại.";
      this.publish.markFailed(publicationId, message);
      throw new StageError(message, "PUBLISH_OUTCOME_UNKNOWN", false);
    }
    if (checkpoint.status === "FAILED" || checkpoint.status === "CANCELLED") {
      throw new StageError(checkpoint.lastError ?? "Lượt đăng đã kết thúc.", "PUBLISH_INACTIVE", false);
    }
    if (checkpoint.externalId || checkpoint.publishedAt) {
      if (this.publish.reconcilePublishedCheckpoint(publicationId)) {
        return { message: `Đã đăng: ${checkpoint.externalUrl ?? publicationId}` };
      }
      const message = "Lượt đăng có dấu tải lên trước đó. Kiểm tra trên nền tảng trước khi thử lại.";
      this.publish.markFailed(publicationId, message);
      throw new StageError(message, "PUBLISH_OUTCOME_UNKNOWN", false);
    }

    context.reportProgress(1, "Chuẩn bị đăng");
    let uploadStarted = false;
    try {
      const prepared = await this.publish.prepareUpload(publicationId, context.signal);
      context.signal.throwIfAborted();
      if (!this.publish.markUploading(publicationId)) {
        throw new StageError("Trạng thái lượt đăng đã thay đổi.", "PUBLISH_INACTIVE", false);
      }
      uploadStarted = true;
      const result = await prepared.publisher.upload(
        { ...prepared.input, projectId: context.project.id },
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
      if (context.signal.aborted || error instanceof StageError) throw error;
      if ((error as { code?: string }).code === "YOUTUBE_CLAIM") {
        this.publish.recordPlatformClaim(publicationId, (error as { reason?: string }).reason ?? "claim");
        const message = error instanceof Error ? error.message : "YouTube từ chối video.";
        this.publish.markFailed(publicationId, message);
        throw new StageError(message, "YOUTUBE_CLAIM", false);
      }
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

      if (uploadStarted && status !== 429) {
        const uncertain = "Chưa rõ bài đã đăng hay chưa. Kiểm tra trên nền tảng trước khi thử lại.";
        this.publish.markFailed(publicationId, uncertain);
        throw new StageError(uncertain, "PUBLISH_OUTCOME_UNKNOWN", false);
      }
      const retryable = retryableFlag ?? (status === 429 || (typeof status === "number" && status >= 500) || status === undefined);
      const willRetry = retryable && context.job.attempt < context.job.maxAttempts;
      if (willRetry && uploadStarted) {
        this.publish.markWaitingForRetry(publicationId, message);
      } else if (!willRetry) {
        this.publish.markFailed(publicationId, message);
      }
      throw new StageError(message, "PUBLISH_UPLOAD_FAILED", retryable);
    }
  }
}
