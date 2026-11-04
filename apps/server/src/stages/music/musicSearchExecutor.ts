import { createHash } from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { StageError, type StageContext, type StageExecutor } from "../../pipeline/stageExecutor.js";
import { AudioDownloadError } from "../../services/audioStore.js";
import type { MusicService } from "../../services/musicService.js";

export class MusicSearchExecutor implements StageExecutor {
  readonly stage = "MUSIC_SEARCH" as const;

  constructor(private readonly music: MusicService) {}

  async run(context: StageContext) {
    const project = context.project;
    if (!project.settings.music.enabled) {
      this.music.selectNone(project, "AGENT");
      return { message: "Nhạc nền đang tắt", outputHash: "music-disabled" };
    }

    context.reportProgress(10, "Đang tìm nhạc nền");
    let outcome;
    try {
      outcome = await this.music.search(project, { signal: context.signal, warn: (message) => context.logger.warn(message) });
    } catch (error) {
      if (error instanceof AudioDownloadError) throw new StageError(error.message, "MUSIC_SEARCH_FAILED", true);
      throw error;
    }
    context.reportProgress(70, `${outcome.candidates.length} bản nhạc`);

    const before = this.music.selectionRow(project.id);
    const userDecided = before?.selected_by === "USER";
    if (!userDecided) this.music.preselectTop(project);

    let approvedNote = "";
    if (project.mode === "AUTO" && !userDecided) {
      const selection = this.music.selectionRow(project.id);
      if (selection?.candidate_id) {
        try {
          await this.music.select(project, selection.candidate_id, "AGENT", context.signal);
          approvedNote = " · đã tự chọn bản đầu";
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          context.logger.warn(`Auto music download failed: ${error.message}`);
          this.music.selectNone(project, "AGENT");
          approvedNote = " · tải nhạc lỗi, bỏ nhạc nền";
        }
      } else {
        this.music.selectNone(project, "AGENT");
        approvedNote = " · không có bản phù hợp, bỏ nhạc nền";
      }
    }

    const after = this.music.selectionRow(project.id);
    const outputHash = createHash("sha256")
      .update(`${after?.search_hash ?? ""}\u0000${after?.candidate_id ?? ""}\u0000${after?.status ?? ""}`)
      .digest("hex");
    const failed = outcome.failedProviders.length ? ` · lỗi: ${outcome.failedProviders.join(", ")}` : "";
    return {
      message: `"${outcome.query}" · ${outcome.candidates.length} bản${outcome.reused ? " (dùng lại)" : ""}${failed}${approvedNote}`,
      outputHash,
    };
  }
}
