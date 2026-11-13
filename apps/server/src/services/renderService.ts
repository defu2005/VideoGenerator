import { createHash, randomUUID } from "node:crypto";
import { recheckOriginalitySafely } from "../originality/recheckSafely.js";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import {
  RenderVisionBatchSchema,
  VideoMetadataDraftSchema,
  aspectsNeededFromAccounts,
  buildCreditsText,
  buildFinalPlan,
  calloutAssLines,
  sfxForEffect,
  buildMetadataText,
  buildSceneClipPlan,
  CLIP_OUTPUT_ARGS,
  concatListText,
  missingRenderAspects,
  normalizeAssTimes,
  splitCue,
  parseBlackdetect,
  parseProgressSeconds,
  COMPOSE_RENDER_VERSION,
  RENDER_FORMAT_VERSION,
  RenderReportSchema,
  resolveBudget,
  resolveStyle,
  resolveEditEngine,
  renderTargetFor,
  subtitleLayoutForAspect,
  toAss,
  VERTICAL_DURATION_WARN_SEC,
  wrapLines,
  type AspectRatio,
  type ComposePlan,
  type ExecuteReport,
  type RenderBundle,
  type CreditsAsset,
  type JobUsage,
  type Project,
  type ProjectRender,
  type Render,
  type RenderIssue,
  type RenderReport,
  type RenderVariantAspect,
  type RenderVersion,
  type SubtitleCue,
  type Timeline,
  type TimelineScene,
  type VideoMetadataDraft,
} from "@vg/shared";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { probeMedia, runFfmpeg, type FfmpegRunOptions, type MediaProbe } from "../media/ffmpeg.js";
import { StageError } from "../pipeline/stageExecutor.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import { getRenderSettings } from "../settings/render.js";
import { renderMotionGraphic } from "../media/motion.js";
import { projectDir } from "../storage/paths.js";
import type { TimelineService } from "./timelineService.js";
import { footageCreditLines, footageLicences, prepareComposePlan, previewRenderEstimate, probeFreezeBlack, readComposePlan, renderSceneClip } from "./composeBridge.js";
import { llmChoiceAnswers, prepareGraphicStyle } from "../compose/render/graphicStyle.js";
import { recordFinishedLookSafely } from "../style/recordSafely.js";
import { executeRender } from "../render/executeRender.js";
import { readAppVersion } from "../render/appVersion.js";
import type { ExecuteIo, PreparedRender } from "../render/types.js";
import { StyleService } from "../style/service.js";

export type MediaTools = {
  ffmpeg: (args: string[], options: FfmpegRunOptions) => Promise<{ stdout: string; stderr: string }>;
  probe: (file: string, signal?: AbortSignal) => Promise<MediaProbe>;
};

export const defaultMediaTools: MediaTools = { ffmpeg: runFfmpeg, probe: probeMedia };

export type RenderProgress = (pct: number, message: string) => void;

const DURATION_TOLERANCE_SEC = 0.2;
const BASE_ARGS = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error"];
const RECENT_READ_MS = 60_000;

type RenderRow = {
  id: string;
  project_id: string;
  input_hash: string;
  status: "DONE" | "FAILED";
  output_path: string;
  credits_path: string | null;
  srt_path: string | null;
  duration_sec: number;
  size_bytes: number;
  width: number;
  height: number;
  report: string;
  created_at: string;
  version: number;
  note: string | null;
  pinned: number | boolean;
  deleted_at: string | null;
  review_thread_id: string | null;
  metadata_snapshot: string | null;
  aspect_ratio: "16:9" | "9:16" | "1:1" | null;
  variant_of: string | null;
};

/** Prepare output that never leaves the control plane. */
export type LocalPrepared = { resolvePath: (path: string) => string; croppedPaths: Set<string> };

export type RenderOptions = {
  /** When set and different from the project default, only the frame size / ASS layout change. */
  aspectRatio?: RenderVariantAspect;
};

function shotSeconds(plan: ComposePlan | null): Record<string, number> {
  const shotSec: Record<string, number> = {};
  if (!plan) return shotSec;
  for (const scene of plan.scenes) {
    for (const shot of scene.shots) shotSec[shot.id] = Math.max(0, shot.endSec - shot.startSec);
  }
  return shotSec;
}

function kindShareFor(timeline: Timeline, plan: ComposePlan | null): Record<string, number> {
  if (plan) {
    const share: Record<string, number> = {};
    for (const [kind, value] of Object.entries(plan.stats.kindShare)) {
      if (typeof value === "number" && value > 0) share[kind] = value;
    }
    return share;
  }
  const weights: Record<string, number> = {};
  let total = 0;
  for (const scene of timeline.scenes) {
    const kind = scene.visuals[0]?.kind ?? "still";
    weights[kind] = (weights[kind] ?? 0) + scene.durationSec;
    total += scene.durationSec;
  }
  if (total <= 0) return {};
  const share: Record<string, number> = {};
  for (const [kind, sec] of Object.entries(weights)) share[kind] = sec / total;
  return share;
}

function aspectFromTarget(target: { width: number; height: number }): AspectRatio {
  if (target.width === target.height) return "1:1";
  if (target.height > target.width) return "9:16";
  return "16:9";
}

/** Absolute-timed cues from an SRT file (newline-joined text kept as multi-line). */
function parseSrtCues(text: string): SubtitleCue[] {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n\n+/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.length > 0);
    if (lines.length < 2) continue;
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const match = timing.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/,
    );
    if (!match) continue;
    const toSec = (h: string, m: string, s: string, ms: string) =>
      Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    const startSec = toSec(match[1], match[2], match[3], match[4]);
    const endSec = toSec(match[5], match[6], match[7], match[8]);
    const textStart = lines.indexOf(timing) + 1;
    const cueText = lines.slice(textStart).join("\n").trim();
    if (!cueText) continue;
    cues.push({ startSec, endSec, text: cueText, index: cues.length });
  }
  return cues;
}

type LicenseJson = {
  name?: string | null;
  url?: string | null;
  author?: string | null;
  attributionText?: string | null;
};

const sha = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function parseLicense(raw: string | null): LicenseJson {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as LicenseJson;
  } catch {
    return {};
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isBusyError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EBUSY" || code === "EPERM";
}

function isVersionPath(outputPath: string): boolean {
  return /[/\\]versions[/\\]/.test(outputPath);
}

/** Idempotent: assign version 1..n by created_at for rows still at 0. */
export function backfillRenderVersions(sqlite: Database.Database): void {
  const projects = sqlite.prepare(
    "SELECT DISTINCT project_id FROM renders WHERE version = 0",
  ).all() as Array<{ project_id: string }>;
  const update = sqlite.prepare("UPDATE renders SET version = ? WHERE id = ?");
  for (const { project_id } of projects) {
    const rows = sqlite.prepare(
      "SELECT id FROM renders WHERE project_id = ? ORDER BY created_at ASC, rowid ASC",
    ).all(project_id) as Array<{ id: string }>;
    let next = 1;
    for (const row of rows) {
      update.run(next, row.id);
      next += 1;
    }
  }
}

const SFX_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "sfx");

function sfxCues(sqlite: Database.Database, projectId: string, timeline: Timeline): { name: string; startSec: number }[] {
  const points = timeline.editPlan?.emphasis ?? [];
  if (points.length === 0) return [];
  const rows = sqlite.prepare("SELECT scene_id AS sceneId, words FROM voice_tracks WHERE project_id = ?")
    .all(projectId) as Array<{ sceneId: string; words: unknown }>;
  const wordsOf = new Map<string, Array<{ startSec: number }>>();
  for (const row of rows) {
    const raw = typeof row.words === "string" ? JSON.parse(row.words) as unknown : row.words;
    if (!Array.isArray(raw)) continue;
    wordsOf.set(row.sceneId, raw.filter((item): item is { startSec: number } =>
      Boolean(item) && typeof item === "object" && typeof (item as { startSec?: unknown }).startSec === "number"));
  }
  const cues: { name: string; startSec: number }[] = [];
  for (const point of points) {
    const scene = timeline.scenes.find((item) => item.sceneId === point.sceneId);
    const word = wordsOf.get(point.sceneId)?.[point.wordIndexStart];
    if (!scene || !word) continue;
    for (const effect of point.effects) {
      const id = sfxForEffect(effect);
      if (!id) continue;
      const name = `${id}.wav`;
      if (!existsSync(join(SFX_DIR, name))) continue;
      cues.push({ name, startSec: scene.startSec + word.startSec });
    }
  }
  return cues;
}

export class RenderService {
  private readonly recentReads = new Map<string, number>();
  private backfilled = false;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly timelines: Pick<TimelineService, "get">,
    private readonly tools: MediaTools = defaultMediaTools,
    private readonly now: () => Date = () => new Date(),
    private readonly llmProviders?: LlmProviderRegistry,
    private readonly autoReport?: import("./autoReportService.js").AutoReportService,
    private readonly composeHooks: {
      plan?: typeof prepareComposePlan;
      renderScene?: typeof renderSceneClip;
    } = {},
  ) {}

  private ensureBackfill(): void {
    if (this.backfilled) return;
    backfillRenderVersions(this.sqlite);
    this.backfilled = true;
  }

  private dir(projectId: string): string {
    return projectDir(this.config.DATA_DIR, projectId);
  }

  renderDir(projectId: string): string {
    return join(this.dir(projectId), "render");
  }

  composePlan(projectId: string) {
    return readComposePlan(this.renderDir(projectId));
  }

  estimate(project: Project) {
    return previewRenderEstimate({ sqlite: this.sqlite, project, dataDir: this.config.DATA_DIR });
  }

  versionDir(projectId: string, renderId: string): string {
    return join(this.renderDir(projectId), "versions", renderId);
  }

  private touchRead(renderId: string): void {
    this.recentReads.set(renderId, Date.now());
  }

  private wasRecentlyRead(renderId: string): boolean {
    const at = this.recentReads.get(renderId);
    return at !== undefined && Date.now() - at < RECENT_READ_MS;
  }

  private resolver(projectId: string) {
    const base = this.dir(projectId);
    return (path: string) => (isAbsolute(path) ? path : join(base, path));
  }

  /** Cache key of one scene clip: everything that changes its pixels. */
  clipHash(scene: TimelineScene, timeline: Timeline, resolvePath: (path: string) => string, scenePlan?: unknown): string {
    return sha({
      v: RENDER_FORMAT_VERSION,
      target: timeline.target,
      frames: scene.durationFrames,
      fadeIn: scene.fadeInSec,
      fadeOut: scene.fadeOutSec,
      compose: scenePlan ?? null,
      visuals: scene.visuals.map((visual) => {
        let file: { size: number; mtime: number } | null = null;
        if (visual.kind === "IMAGE" && visual.path) {
          const absolute = resolvePath(visual.path);
          if (!existsSync(absolute)) {
            throw new StageError(`Ảnh của cảnh ${scene.order + 1} không còn — chạy lại bước Hình ảnh/Timeline.`, "RENDER_VISUAL_MISSING", false);
          }
          const stat = statSync(absolute);
          file = { size: stat.size, mtime: Math.round(stat.mtimeMs) };
        }
        return { kind: visual.kind, path: visual.path, file, motion: visual.motion, start: visual.startSec, end: visual.endSec };
      }),
    }).slice(0, 32);
  }

  private latestRow(projectId: string): RenderRow | undefined {
    this.ensureBackfill();
    return this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).get(projectId) as RenderRow | undefined;
  }

  private rowById(projectId: string, renderId: string): RenderRow | undefined {
    this.ensureBackfill();
    return this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND id = ?",
    ).get(projectId, renderId) as RenderRow | undefined;
  }

  private toRender(row: RenderRow): Render | null {
    const report = RenderReportSchema.safeParse(JSON.parse(row.report));
    if (!report.success) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      inputHash: row.input_hash,
      durationSec: row.duration_sec,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      hasCredits: Boolean(row.credits_path && existsSync(row.credits_path)),
      hasSubtitles: Boolean(row.srt_path && existsSync(row.srt_path)),
      report: report.data,
      createdAt: row.created_at,
      aspectRatio: row.aspect_ratio ?? null,
      variantOf: row.variant_of ?? null,
    };
  }

  private primaryRenderId(projectId: string, projectAspect: AspectRatio): string | null {
    const rows = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC",
    ).all(projectId) as RenderRow[];
    for (const row of rows) {
      const aspect = row.aspect_ratio ?? projectAspect;
      if (aspect === projectAspect) return row.id;
    }
    return rows[0]?.id ?? null;
  }

  private toVersion(row: RenderRow): RenderVersion | null {
    const render = this.toRender(row);
    if (!render) return null;
    return {
      ...render,
      version: row.version,
      note: row.note,
      pinned: Boolean(row.pinned),
      deleted: Boolean(row.deleted_at),
      reviewThreadId: row.review_thread_id,
      hasMetadata: Boolean(row.metadata_snapshot),
    };
  }

  get(projectId: string): ProjectRender {
    const row = this.latestRow(projectId);
    if (!row || !existsSync(row.output_path)) return { render: null };
    return { render: this.toRender(row) };
  }

  list(projectId: string): { renders: RenderVersion[] } {
    this.ensureBackfill();
    const rows = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC, rowid DESC",
    ).all(projectId) as RenderRow[];

    // Hide older legacy TASK-012 rows that share the same overwritten output_path.
    const hidden = new Set<string>();
    const byPath = new Map<string, RenderRow[]>();
    for (const row of rows) {
      if (isVersionPath(row.output_path)) continue;
      const group = byPath.get(row.output_path) ?? [];
      group.push(row);
      byPath.set(row.output_path, group);
    }
    for (const group of byPath.values()) {
      if (group.length < 2) continue;
      for (const row of group.slice(1)) hidden.add(row.id);
    }

    const renders: RenderVersion[] = [];
    for (const row of rows) {
      if (hidden.has(row.id)) continue;
      const version = this.toVersion(row);
      if (version) renders.push(version);
    }
    return { renders };
  }

  getVersion(projectId: string, renderId: string): RenderVersion {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    const version = this.toVersion(row);
    if (!version) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    return version;
  }

  /** Absolute path of a downloadable render file, or null when it does not exist. */
  file(
    projectId: string,
    kind: "video" | "credits" | "subtitles" | "thumb",
    sceneId?: string,
    renderId?: string,
  ): string | null {
    const row = renderId ? this.rowById(projectId, renderId) : this.latestRow(projectId);
    if (!row || row.deleted_at) return null;
    this.touchRead(row.id);
    let path: string | null = null;
    if (kind === "video") path = row.output_path;
    else if (kind === "credits") path = row.credits_path;
    else if (kind === "subtitles") path = row.srt_path;
    else {
      const report = this.toRender(row)?.report;
      if (!sceneId || !report?.thumbnails.includes(sceneId)) return null;
      const versionThumbs = join(this.versionDir(projectId, row.id), "thumbs", `${sceneId}.jpg`);
      const legacyThumbs = join(this.renderDir(projectId), "thumbs", `${sceneId}.jpg`);
      path = existsSync(versionThumbs) ? versionThumbs : legacyThumbs;
    }
    return path && existsSync(path) ? path : null;
  }

  patch(projectId: string, renderId: string, patch: { note?: string | null; pinned?: boolean }): RenderVersion {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    const note = patch.note === undefined ? row.note : patch.note;
    if (note !== null && note.length > 500) {
      throw new AppError(400, "VALIDATION_ERROR", "Ghi chú tối đa 500 ký tự.");
    }
    const pinned = patch.pinned === undefined ? Boolean(row.pinned) : patch.pinned;
    this.sqlite.prepare("UPDATE renders SET note = ?, pinned = ? WHERE id = ?").run(note, pinned ? 1 : 0, renderId);
    return this.getVersion(projectId, renderId);
  }

  deleteVersion(projectId: string, renderId: string): RenderVersion {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    if (row.deleted_at) return this.toVersion(row)!;
    try {
      this.removeVersionFiles(projectId, row);
    } catch (error) {
      if (isBusyError(error)) {
        throw new AppError(409, "RENDER_IN_USE", "Không xoá được vì tệp đang được mở hoặc phát.");
      }
      throw error;
    }
    const deletedAt = this.now().toISOString();
    this.sqlite.prepare("UPDATE renders SET deleted_at = ? WHERE id = ?").run(deletedAt, renderId);
    return this.getVersion(projectId, renderId);
  }

  private removeVersionFiles(projectId: string, row: RenderRow): void {
    const versionFolder = this.versionDir(projectId, row.id);
    if (existsSync(versionFolder)) {
      rmSync(versionFolder, { recursive: true, force: false });
      return;
    }
    // Legacy single-folder rows: only delete files if no other non-deleted row still points at them.
    const stillUsed = this.sqlite.prepare(
      "SELECT COUNT(*) AS n FROM renders WHERE project_id = ? AND id != ? AND deleted_at IS NULL AND (output_path = ? OR credits_path = ? OR srt_path = ?)",
    ).get(projectId, row.id, row.output_path, row.credits_path, row.srt_path) as { n: number };
    if (stillUsed.n > 0) return;
    for (const path of [row.output_path, row.credits_path, row.srt_path]) {
      if (path && existsSync(path)) rmSync(path, { force: false });
    }
  }

  private nextVersionNumber(projectId: string): number {
    const row = this.sqlite.prepare(
      "SELECT COALESCE(MAX(version), 0) AS max_version FROM renders WHERE project_id = ?",
    ).get(projectId) as { max_version: number };
    return Number(row.max_version) + 1;
  }

  private currentReviewThreadId(projectId: string): string | null {
    const row = this.sqlite.prepare(
      "SELECT id FROM review_threads WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(projectId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private currentMetadataSnapshot(projectId: string): VideoMetadataDraft | null {
    const row = this.sqlite.prepare(
      "SELECT draft, edited FROM video_metadata WHERE project_id = ?",
    ).get(projectId) as { draft: string; edited: string | null } | undefined;
    if (!row) return null;
    try {
      const edited = row.edited ? VideoMetadataDraftSchema.safeParse(JSON.parse(row.edited)) : null;
      if (edited?.success) return edited.data;
      const draft = VideoMetadataDraftSchema.safeParse(JSON.parse(row.draft));
      return draft.success ? draft.data : null;
    } catch {
      return null;
    }
  }

  metadataTextForExport(projectId: string, renderId: string, projectTitle: string): string {
    const row = this.rowById(projectId, renderId);
    if (!row) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    let draft: VideoMetadataDraft | null = null;
    if (row.metadata_snapshot) {
      const parsed = VideoMetadataDraftSchema.safeParse(
        typeof row.metadata_snapshot === "string" ? JSON.parse(row.metadata_snapshot) : row.metadata_snapshot,
      );
      if (parsed.success) draft = parsed.data;
    }
    if (!draft) draft = this.currentMetadataSnapshot(projectId);
    if (!draft) {
      draft = {
        titles: [projectTitle],
        description: "",
        tags: [],
        hashtags: [],
        thumbnailText: [],
      };
    }
    const creditsText = row.credits_path && existsSync(row.credits_path)
      ? readFileSync(row.credits_path, "utf8")
      : "";
    return buildMetadataText({
      titles: draft.titles,
      description: draft.description,
      tags: draft.tags,
      hashtags: draft.hashtags,
      creditsText,
    });
  }

  exportPaths(projectId: string, renderId: string): {
    video: string;
    credits: string | null;
    subtitles: string | null;
    report: RenderReport;
    version: number;
  } {
    const row = this.rowById(projectId, renderId);
    if (!row || row.deleted_at) throw new AppError(404, "RENDER_NOT_FOUND", "Không tìm thấy bản render này.");
    if (!existsSync(row.output_path)) throw new AppError(404, "RENDER_FILE_NOT_FOUND", "Tệp render không còn.");
    this.touchRead(row.id);
    const report = RenderReportSchema.parse(JSON.parse(row.report));
    return {
      video: row.output_path,
      credits: row.credits_path && existsSync(row.credits_path) ? row.credits_path : null,
      subtitles: row.srt_path && existsSync(row.srt_path) ? row.srt_path : null,
      report,
      version: row.version,
    };
  }

  private applyRetention(projectId: string): void {
    const keep = getRenderSettings(this.sqlite).keepVersions;
    const rows = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND deleted_at IS NULL AND status = 'DONE' ORDER BY created_at DESC, rowid DESC",
    ).all(projectId) as RenderRow[];
    if (rows.length <= keep) return;
    const newestId = rows[0]?.id;
    const removable = rows.slice(keep).filter((row) => !row.pinned && row.id !== newestId && !this.wasRecentlyRead(row.id));
    for (const row of removable) {
      try {
        this.removeVersionFiles(projectId, row);
        this.sqlite.prepare("UPDATE renders SET deleted_at = ? WHERE id = ?").run(this.now().toISOString(), row.id);
      } catch (error) {
        if (isBusyError(error)) continue;
        throw error;
      }
    }
  }

  /**
   * Build (or rebuild) ASS burn-in text for the given output aspect.
   * Variants re-wrap cues in code — no LLM, no timeline rewrite.
   */
  private assForAspect(
    timeline: Timeline,
    project: Project,
    outputAspect: AspectRatio,
  ): string | null {
    if (!timeline.subtitles) return null;
    if (!existsSync(timeline.subtitles.assPath) && !existsSync(timeline.subtitles.srtPath)) {
      throw new StageError("Tệp phụ đề không còn — chạy lại bước Timeline.", "RENDER_SUBTITLE_MISSING", false);
    }
    const timelineAspect = aspectFromTarget(timeline.target);
    if (outputAspect === timelineAspect && existsSync(timeline.subtitles.assPath)) {
      return normalizeAssTimes(readFileSync(timeline.subtitles.assPath, "utf8"));
    }
    const landscapeMax = Number(project.settings.subtitles?.maxCharsPerLine) > 0
      ? Number(project.settings.subtitles?.maxCharsPerLine)
      : undefined;
    const layout = subtitleLayoutForAspect(outputAspect, landscapeMax);
    let cues: SubtitleCue[] = [];
    if (existsSync(timeline.subtitles.srtPath)) {
      cues = parseSrtCues(readFileSync(timeline.subtitles.srtPath, "utf8"));
    }
    if (!cues.length && existsSync(timeline.subtitles.assPath)) {
      // Fall back to the stored ASS body (same timings); re-style only.
      return normalizeAssTimes(readFileSync(timeline.subtitles.assPath, "utf8"));
    }
    // Narrower lines: split long cues (timed by length) so each shows at most 2 lines.
    const wrapped = cues
      .flatMap((cue) => splitCue(
        { ...cue, text: cue.text.replace(/\n+/g, " ") },
        { aspectRatio: outputAspect, maxCharsPerLine: layout.maxCharsPerLine, maxLines: 2 },
      ))
      .map((cue, index) => ({
        ...cue,
        index,
        text: wrapLines(cue.text, layout.maxCharsPerLine, 2).join("\n"),
      }));
    return toAss(wrapped, {
      aspectRatio: layout.aspectRatio,
      width: layout.width,
      height: layout.height,
      fontSize: project.settings.edit?.fontSize ?? layout.fontSize,
      marginBottom: layout.marginBottom,
      fontName: "Arial",
      ...(project.settings.edit?.highlightColor ? { highlightColor: project.settings.edit.highlightColor } : {}),
    });
  }

  /**
   * Render in three parts: prepare (control plane), execute (here or on a worker), finalize (control plane).
   * This is the one path for both a local run and a remote one.
   */
  async render(
    project: Project,
    signal: AbortSignal,
    onProgress: RenderProgress = () => {},
    options: RenderOptions = {},
  ): Promise<{ render: Render; reused: boolean; usage?: JobUsage }> {
    const prepared = await this.prepare(project, signal, onProgress, options);
    if (prepared.reused) return prepared.reused;
    const { bundle } = prepared.prepared;
    const executed = await executeRender(bundle, this.localExecuteIo(project.id, prepared.prepared, signal, onProgress));
    return this.finalize(project, prepared.prepared, executed.outputPath, executed.report, signal, onProgress);
  }

  /** Execute io for a run on this machine: original paths, crops included, same hashes as before. */
  localExecuteIo(projectId: string, prepared: PreparedRender, signal: AbortSignal, onProgress: RenderProgress): ExecuteIo {
    const local = (prepared as PreparedRender & { local?: LocalPrepared }).local;
    return {
      resolve: local?.resolvePath ?? this.resolver(projectId),
      dataDir: this.config.DATA_DIR,
      renderDir: this.renderDir(projectId),
      versionDir: this.versionDir(projectId, prepared.state.renderId),
      sfxDir: SFX_DIR,
      ffmpeg: this.tools.ffmpeg,
      ...(this.composeHooks.renderScene ? { renderScene: this.composeHooks.renderScene as ExecuteIo["renderScene"] } : {}),
      signal,
      onProgress,
    };
  }

  /** Control-plane part before the heavy work: plan, hashes, bundle. Returns a reusable render when one exists. */
  async prepare(
    project: Project,
    signal: AbortSignal,
    onProgress: RenderProgress = () => {},
    options: RenderOptions = {},
  ): Promise<
    | { reused: { render: Render; reused: true; usage?: JobUsage }; prepared?: undefined }
    | { reused?: undefined; prepared: PreparedRender & { local: LocalPrepared } }
  > {
    this.ensureBackfill();
    const { timeline: baseTimeline, inputHash: timelineHash } = this.timelines.get(project.id);
    if (!baseTimeline || !timelineHash) {
      throw new StageError("Chưa có timeline — chạy bước Timeline trước.", "RENDER_NO_TIMELINE", false);
    }
    const projectAspect = (project.settings.aspectRatio ?? aspectFromTarget(baseTimeline.target)) as AspectRatio;
    const requested = options.aspectRatio;
    const outputAspect: AspectRatio = requested ?? projectAspect;
    const isVariant = Boolean(requested && requested !== projectAspect);
    const storedAspect: AspectRatio | null = isVariant || requested ? outputAspect : null;

    const timeline: Timeline = outputAspect === aspectFromTarget(baseTimeline.target)
      ? baseTimeline
      : { ...baseTimeline, target: renderTargetFor(outputAspect) };

    const startedMs = Date.now();
    const baseResolve = this.resolver(project.id);
    const cropByPath = new Map<string, string>();
    for (const scene of timeline.scenes) {
      for (const visual of scene.visuals) {
        if (visual.kind !== "IMAGE" || !visual.path || !visual.candidateId) continue;
        const crop = this.sqlite.prepare(
          "SELECT output_path FROM visual_crops WHERE candidate_id = ? AND aspect = ?",
        ).get(visual.candidateId, outputAspect) as { output_path: string } | undefined;
        if (crop && existsSync(crop.output_path)) cropByPath.set(visual.path, crop.output_path);
      }
    }
    const resolvePath = (path: string) => cropByPath.get(path) ?? baseResolve(path);
    const croppedPaths = new Set(cropByPath.keys());
    const renderDir = this.renderDir(project.id);
    const clipsDir = join(renderDir, "clips");
    mkdirSync(clipsDir, { recursive: true });

    for (const scene of timeline.scenes) {
      if (scene.voice && !existsSync(resolvePath(scene.voice.path))) {
        throw new StageError(`Tệp giọng đọc của cảnh ${scene.order + 1} không còn — chạy lại bước Giọng đọc.`, "RENDER_VOICE_MISSING", false);
      }
    }
    if (timeline.music && !existsSync(resolvePath(timeline.music.path))) {
      throw new StageError("Tệp nhạc nền không còn — chọn lại nhạc ở tab Nhạc.", "RENDER_MUSIC_MISSING", false);
    }
    const assText = this.assForAspect(baseTimeline, project, outputAspect);
    const composeWarnings: string[] = [];
    let composePlan: ComposePlan | null = null;
    let composeUsage: JobUsage | undefined;
    if (resolveEditEngine(project.settings.edit?.engine) === "compose") {
      const prepared = await (this.composeHooks.plan ?? prepareComposePlan)({
        sqlite: this.sqlite,
        config: this.config,
        project,
        timeline,
        resolvePath,
        renderDir,
        registry: this.llmProviders,
        signal,
      });
      composePlan = prepared.plan;
      composeUsage = prepared.usage;
      composeWarnings.push(...prepared.warnings);
      if (composePlan) writeFileSync(join(renderDir, "compose-plan.json"), JSON.stringify(composePlan));
    }
    const budgetFeatures = resolveBudget(project.settings.budget ?? { mode: "BALANCED" });
    const recipeId = project.settings.format || project.settings.treatment?.formatId || "explainer";
    const brandColor = project.settings.motionGraphics?.brandColor;
    const accentColor = project.settings.motionGraphics?.accentColor;
    const videoStyle = composePlan
      ? prepareGraphicStyle({
        projectId: project.id,
        profileId: project.profileId,
        recipeId,
        brandColor,
        accentColor,
        width: timeline.target.width,
        height: timeline.target.height,
        shots: composePlan.scenes.flatMap((scene) => scene.shots),
        llmChoices: llmChoiceAnswers(composePlan),
        styles: new StyleService(this.sqlite, this.now),
      })
      : undefined;
    const clipHashes = timeline.scenes.map((scene) => {
      const plan = composePlan?.scenes.find((item) => item.sceneId === scene.sceneId) ?? null;
      return this.clipHash(
        scene,
        timeline,
        resolvePath,
        {
          plan,
          composeGraphics: budgetFeatures.composeGraphics,
          graphicGrain: budgetFeatures.graphicGrain,
          projectId: project.id,
          language: project.settings.language,
          brandColor: brandColor ?? null,
          accentColor: accentColor ?? null,
          renderVersion: COMPOSE_RENDER_VERSION,
          styleFingerprint: videoStyle?.fingerprint ?? null,
          styleAxes: plan && videoStyle
            ? plan.shots.map((shot) => ({ id: shot.id, axes: videoStyle.byShot[shot.id]?.axes ?? null }))
            : null,
        },
      );
    });
    const inputHash = sha({
      v: RENDER_FORMAT_VERSION,
      timelineHash,
      aspect: outputAspect,
      ass: assText ? sha(assText) : null,
      clipHashes,
    });

    const reusable = this.sqlite.prepare(
      "SELECT * FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL AND input_hash = ? ORDER BY created_at DESC, rowid DESC",
    ).all(project.id, inputHash) as RenderRow[];
    for (const candidate of reusable) {
      if (!existsSync(candidate.output_path)) continue;
      const render = this.toRender(candidate);
      if (render) {
        recheckOriginalitySafely(this.sqlite, project.id, { id: render.id, plan: composePlan });
        onProgress(100, "Dùng lại bản render trước");
        return { reused: { render, reused: true, ...(composeUsage ? { usage: composeUsage } : {}) } };
      }
    }

    const renderId = randomUUID();
    const wordsByScene: Record<string, Array<{ text: string; startSec: number; endSec: number }>> = {};
    if (assText !== null && timeline.editPlan?.emphasis?.length) {
      const rows = this.sqlite.prepare("SELECT scene_id AS sceneId, words FROM voice_tracks WHERE project_id = ?")
        .all(project.id) as Array<{ sceneId: string; words: unknown }>;
      for (const row of rows) {
        const raw = typeof row.words === "string" ? JSON.parse(row.words) as unknown : row.words;
        if (!Array.isArray(raw)) continue;
        wordsByScene[row.sceneId] = raw.filter((item): item is { text: string; startSec: number; endSec: number } =>
          Boolean(item) && typeof item === "object"
          && typeof (item as { text?: unknown }).text === "string"
          && typeof (item as { startSec?: unknown }).startSec === "number"
          && typeof (item as { endSec?: unknown }).endSec === "number");
      }
    }
    const bundle: RenderBundle = {
      bundleVersion: 1,
      appVersion: readAppVersion(),
      composeRenderVersion: COMPOSE_RENDER_VERSION,
      projectId: project.id,
      profileId: project.profileId ?? null,
      renderId,
      aspect: outputAspect,
      timeline,
      composePlan,
      videoStyle: (videoStyle as RenderBundle["videoStyle"] | undefined) ?? null,
      assText,
      wordsByScene,
      sfx: sfxCues(this.sqlite, project.id, timeline),
      clipHashes,
      croppedNames: [...croppedPaths],
      creditsText: this.creditsText(project, timeline) + footageCreditLines(composePlan),
      recipeId,
      language: project.settings.language ?? null,
      brandColor: brandColor ?? null,
      accentColor: accentColor ?? null,
      composeGraphics: budgetFeatures.composeGraphics,
      graphicGrain: budgetFeatures.graphicGrain,
      hasSrt: Boolean(timeline.subtitles && existsSync(timeline.subtitles.srtPath)),
      files: [],
    };
    return {
      prepared: {
        bundle,
        state: {
          inputHash,
          renderId,
          outputAspect,
          projectAspect,
          isVariant,
          storedAspect,
          composeWarnings,
          composeUsage: composeUsage ?? null,
          startedMs,
        },
        local: { resolvePath, croppedPaths },
      },
    };
  }

  /**
   * Control-plane part after the heavy work: sidecars, checks, report, the renders row, retention.
   * `outputPath` is the finished video in this project's version folder.
   */
  async finalize(
    project: Project,
    prepared: PreparedRender,
    outputPath: string,
    executed: ExecuteReport,
    signal: AbortSignal,
    onProgress: RenderProgress = () => {},
  ): Promise<{ render: Render; reused: boolean; usage?: JobUsage }> {
    const { bundle, state } = prepared;
    const { timeline } = bundle;
    const composePlan = bundle.composePlan as ComposePlan | null;
    const videoStyle = bundle.videoStyle as ReturnType<typeof prepareGraphicStyle> | null;
    const budgetFeatures = { composeGraphics: bundle.composeGraphics, graphicGrain: bundle.graphicGrain };
    const { renderId, inputHash, outputAspect, projectAspect, isVariant, storedAspect } = state;
    const composeWarnings = [...state.composeWarnings, ...executed.composeWarnings];
    const composeUsage = state.composeUsage ?? undefined;
    const versionFolder = this.versionDir(project.id, renderId);
    const thumbsDir = join(versionFolder, "thumbs");
    mkdirSync(thumbsDir, { recursive: true });
    const { clipsReused, clipsRendered, graphicShots, joinWarnings } = executed;

    // 3. Sidecars.
    const creditsPath = join(versionFolder, "credits.txt");
    writeFileSync(creditsPath, bundle.creditsText);
    let srtPath: string | null = null;
    if (timeline.subtitles && existsSync(timeline.subtitles.srtPath)) {
      srtPath = join(versionFolder, "subtitles.srt");
      copyFileSync(timeline.subtitles.srtPath, srtPath);
    }

    // 4. Checks (95–100 %). Issues are reported, never fatal.
    onProgress(95, "Kiểm tra video");
    const report = await this.check(timeline, outputPath, thumbsDir, signal, project, outputAspect);
    for (const message of [...joinWarnings, ...composeWarnings]) {
      report.issues.push({
        code: message.includes("xfade") ? "XFADE_UNAVAILABLE" : message.startsWith("Cảnh") || message.startsWith("Không lập") ? "COMPOSE_FALLBACK" : "GRAPHIC_SKIPPED",
        severity: "WARN",
        sceneId: null,
        message,
      });
    }
    const elapsedSec = Math.round((Date.now() - state.startedMs) / 100) / 10;
    const volume = await this.measureVolume(outputPath, signal);
    const subtitlesInSync = this.subtitlesMatch(project.id, timeline, srtPath, report.durationSec);
    let freezeSegments: number | undefined;
    let blackSegments: number | undefined;
    let freezeAtSec: number[] = [];
    let blackAtSec: number[] = [];
    if (resolveEditEngine(project.settings.edit?.engine) === "compose") {
      try {
        const probed = await probeFreezeBlack(this.tools.ffmpeg, outputPath, signal);
        freezeSegments = probed.freezeSegments;
        blackSegments = probed.blackSegments;
        freezeAtSec = probed.freezeAtSec;
        blackAtSec = probed.blackAtSec;
      } catch (error) {
        freezeSegments = 0;
        blackSegments = 0;
        composeWarnings.push(`Không đo được đoạn đứng hoặc đen: ${error instanceof Error ? error.message : "lỗi"}`);
      }
    }
    const fullReport: RenderReport = {
      ...report,
      clipsReused,
      clipsRendered,
      elapsedSec,
      ...volume,
      subtitlesInSync,
      ...(freezeSegments === undefined ? {} : { freezeSegments, blackSegments, freezeAtSec, blackAtSec }),
      ...(composePlan ? {
        compose: {
          stats: composePlan.stats,
          licences: footageLicences(composePlan),
          warnings: composeWarnings,
          graphicsMode: budgetFeatures.composeGraphics,
          graphicGrain: budgetFeatures.graphicGrain,
          graphicShots: graphicShots as NonNullable<NonNullable<RenderReport["compose"]>["graphicShots"]>,
          ...(videoStyle ? {
            style: {
              packId: videoStyle.packId ?? null,
              packVersion: videoStyle.packVersion ?? null,
              fingerprint: videoStyle.fingerprint,
            },
          } : {}),
        },
      } : {}),
    };

    const metadataSnapshot = this.currentMetadataSnapshot(project.id);
    const version = this.nextVersionNumber(project.id);
    const variantOf = isVariant ? this.primaryRenderId(project.id, projectAspect) : null;
    const row: RenderRow = {
      id: renderId,
      project_id: project.id,
      input_hash: inputHash,
      status: "DONE",
      output_path: outputPath,
      credits_path: creditsPath,
      srt_path: srtPath,
      duration_sec: fullReport.durationSec,
      size_bytes: statSync(outputPath).size,
      width: fullReport.width,
      height: fullReport.height,
      report: JSON.stringify(fullReport),
      created_at: this.now().toISOString(),
      version,
      note: null,
      pinned: 0,
      deleted_at: null,
      review_thread_id: this.currentReviewThreadId(project.id),
      metadata_snapshot: metadataSnapshot ? JSON.stringify(metadataSnapshot) : null,
      aspect_ratio: storedAspect,
      variant_of: variantOf,
    };
    this.sqlite.prepare(`
      INSERT INTO renders (id, project_id, input_hash, status, output_path, credits_path, srt_path,
        duration_sec, size_bytes, width, height, report, created_at,
        version, note, pinned, deleted_at, review_thread_id, metadata_snapshot, aspect_ratio, variant_of)
      VALUES (@id, @project_id, @input_hash, @status, @output_path, @credits_path, @srt_path,
        @duration_sec, @size_bytes, @width, @height, @report, @created_at,
        @version, @note, @pinned, @deleted_at, @review_thread_id, @metadata_snapshot, @aspect_ratio, @variant_of)
    `).run(row);

    recheckOriginalitySafely(this.sqlite, project.id, { id: renderId, plan: composePlan });
    await recordFinishedLookSafely(this.sqlite, {
      projectId: project.id,
      renderId,
      profileId: project.profileId ?? null,
      createdAt: row.created_at,
      style: videoStyle?.resolved ?? resolveStyle({}, { width: fullReport.width, height: fullReport.height }),
      picks: videoStyle?.picks ?? [],
      shotSec: shotSeconds(composePlan),
      kindShare: kindShareFor(timeline, composePlan),
      thumbsDir,
      thumbnailIds: fullReport.thumbnails,
    }, this.now);
    try {
      this.applyRetention(project.id);
    } catch (error) {
      if (!isBusyError(error)) throw error;
    }

    onProgress(100, "Render xong");
    return { render: this.toRender(row)!, reused: false, ...(composeUsage ? { usage: composeUsage } : {}) };
  }

  /** Render every profile-account format that still lacks a finished render. Sequential, no LLM. */
  /** Formats the profile's accounts need that have no finished render yet. */
  planMissingVariants(project: Project): { missing: RenderVariantAspect[]; skipped: RenderVariantAspect[] } {
    if (!project.profileId) {
      throw new AppError(400, "NO_PROFILE", "Dự án chưa gắn hồ sơ — không biết định dạng tài khoản.");
    }
    const accounts = this.sqlite.prepare(
      "SELECT format, enabled FROM platform_accounts WHERE profile_id = ?",
    ).all(project.profileId) as Array<{ format: "landscape" | "vertical"; enabled: number | boolean }>;
    const needed = aspectsNeededFromAccounts(
      accounts.map((row) => ({ format: row.format, enabled: Boolean(row.enabled) })),
    );
    const projectAspect = (project.settings.aspectRatio ?? "16:9") as AspectRatio;
    const existing = this.list(project.id).renders;
    const missing = missingRenderAspects({
      needed,
      projectAspect: projectAspect === "1:1" ? "16:9" : projectAspect,
      existing: existing.map((row) => ({
        aspectRatio: row.aspectRatio ?? null,
        status: row.status,
        deleted: row.deleted,
      })),
    });
    const skipped = needed.filter((aspect) => !missing.includes(aspect));
    return { missing, skipped };
  }

  async renderMissingVariants(
    project: Project,
    signal: AbortSignal,
    onProgress: RenderProgress = () => {},
  ): Promise<{
    queued: RenderVariantAspect[];
    skipped: RenderVariantAspect[];
    renders: Render[];
  }> {
    const { missing, skipped } = this.planMissingVariants(project);
    const renders: Render[] = [];
    for (const aspect of missing) {
      const { render } = await this.render(project, signal, onProgress, { aspectRatio: aspect });
      renders.push(render);
    }
    return { queued: missing, skipped, renders };
  }

  private async check(
    timeline: Timeline,
    outputPath: string,
    thumbsDir: string,
    signal: AbortSignal,
    project?: Project,
    outputAspect?: AspectRatio,
  ): Promise<Omit<RenderReport, "clipsReused" | "clipsRendered" | "elapsedSec">> {
    const issues: RenderIssue[] = [];
    this.warnDuplicateVisuals(project, issues);
    const probe = await this.tools.probe(outputPath, signal);
    const expected = timeline.totalDurationSec;
    if (!probe.hasVideo) issues.push({ code: "NO_VIDEO", severity: "ERROR", sceneId: null, message: "Video không có luồng hình." });
    if (!probe.hasAudio) issues.push({ code: "NO_AUDIO", severity: "ERROR", sceneId: null, message: "Video không có luồng âm thanh." });
    if (Math.abs(probe.durationSec - expected) > DURATION_TOLERANCE_SEC) {
      issues.push({
        code: "DURATION_MISMATCH",
        severity: "ERROR",
        sceneId: null,
        message: `Thời lượng ${probe.durationSec.toFixed(2)}s, timeline ${expected.toFixed(2)}s.`,
      });
    }
    if (probe.hasVideo && (probe.width !== timeline.target.width || probe.height !== timeline.target.height)) {
      issues.push({
        code: "SIZE_MISMATCH",
        severity: "ERROR",
        sceneId: null,
        message: `Kích thước ${probe.width}×${probe.height}, cần ${timeline.target.width}×${timeline.target.height}.`,
      });
    }
    const aspect = outputAspect ?? aspectFromTarget(timeline.target);
    if (aspect === "9:16" && probe.durationSec > VERTICAL_DURATION_WARN_SEC) {
      issues.push({
        code: "VERTICAL_TOO_LONG",
        severity: "WARN",
        sceneId: null,
        message: `Bản dọc dài ${probe.durationSec.toFixed(0)}s (trên ${VERTICAL_DURATION_WARN_SEC}s). TikTok/Reels có thể cắt hoặc từ chối — video không bị cắt tự động.`,
      });
    }

    if (probe.hasVideo) {
      try {
        const { stderr } = await this.tools.ffmpeg([
          "-hide_banner", "-nostdin", "-loglevel", "info", "-i", outputPath,
          "-vf", "blackdetect=d=1:pix_th=0.10", "-an", "-f", "null", "-",
        ], { signal });
        for (const black of parseBlackdetect(stderr)) {
          const scene = timeline.scenes.find((item) => black.startSec < item.endSec && black.endSec > item.startSec) ?? null;
          issues.push({
            code: "BLACK_FRAMES",
            severity: "WARN",
            sceneId: scene?.sceneId ?? null,
            message: `Khung đen ${black.startSec.toFixed(1)}s–${black.endSec.toFixed(1)}s${scene ? ` (cảnh ${scene.order + 1})` : ""}.`,
          });
        }
      } catch (error) {
        if (isAbort(error) || signal.aborted) throw error;
      }
    }

    const thumbnails: string[] = [];
    if (probe.hasVideo) {
      for (const scene of timeline.scenes) {
        const at = Math.max(0, (scene.startSec + scene.endSec) / 2);
        const file = join(thumbsDir, `${scene.sceneId}.jpg`);
        try {
          await this.tools.ffmpeg([
            ...BASE_ARGS, "-ss", at.toFixed(3), "-i", outputPath, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "4", file,
          ], { signal });
          thumbnails.push(scene.sceneId);
        } catch (error) {
          if (isAbort(error) || signal.aborted) throw error;
          issues.push({ code: "THUMBNAIL_FAILED", severity: "WARN", sceneId: scene.sceneId, message: `Không lấy được ảnh xem trước cảnh ${scene.order + 1}.` });
        }
      }
    }

    if (project && resolveBudget(project).renderVerify && this.llmProviders && thumbnails.length) {
      await this.runRenderVision(project, timeline, thumbsDir, thumbnails, issues, signal);
    }

    if (project?.mode === "AUTO" && this.autoReport) {
      this.autoReport.clearStage(project.id, "RENDER");
      for (const issue of issues) {
        if (issue.code !== "FRAME_MISMATCH" && issue.code !== "SUBTITLE_ILLEGIBLE") continue;
        this.autoReport.add(project.id, {
          stage: "RENDER",
          sceneId: issue.sceneId,
          code: "RENDER_VISION_ISSUE",
          severity: "WARN",
          message: issue.message,
          data: { code: issue.code },
        });
      }
    }

    return {
      ok: !issues.some((issue) => issue.severity === "ERROR"),
      expectedDurationSec: expected,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      issues,
      thumbnails,
    };
  }

  private warnDuplicateVisuals(project: Project | undefined, issues: RenderIssue[]): void {
    if (!project) return;
    const rows = this.sqlite.prepare(`SELECT sel.scene_id AS sceneId, sel.selected_by AS selectedBy, c.phash AS phash
      FROM visual_selections sel JOIN visual_candidates c ON c.id = sel.candidate_id
      WHERE sel.project_id = ? AND c.phash IS NOT NULL`).all(project.id) as Array<{ sceneId: string; selectedBy: string; phash: string }>;
    const groups = new Map<string, Array<{ sceneId: string; selectedBy: string }>>();
    for (const row of rows) groups.set(row.phash, [...(groups.get(row.phash) ?? []), row]);
    for (const group of groups.values()) {
      if (group.length < 2 || group.some((row) => row.selectedBy === "USER")) continue;
      issues.push({
        code: "DUPLICATE_VISUAL",
        severity: "WARN",
        sceneId: group[1]?.sceneId ?? null,
        message: `${group.length} cảnh trong video đang dùng cùng một ảnh.`,
      });
    }
  }

  private async runRenderVision(
    project: Project,
    timeline: Timeline,
    thumbsDir: string,
    thumbnails: string[],
    issues: RenderIssue[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.llmProviders) return;
    try {
      const route = this.llmProviders.resolveTask("renderVision", project, getAppLlmSettings(this.sqlite));
      const maxImages = route.provider.capabilities?.maxImagesPerCall ?? 5;
      const frames = thumbnails.map((sceneId) => {
        const scene = timeline.scenes.find((item) => item.sceneId === sceneId);
        return {
          sceneId,
          path: join(thumbsDir, `${sceneId}.jpg`),
          order: scene?.order ?? 0,
        };
      }).filter((frame) => existsSync(frame.path));
      for (let offset = 0; offset < frames.length; offset += maxImages) {
        const batch = frames.slice(offset, offset + maxImages);
        const generated = await generateRoutedStructured({
          registry: this.llmProviders,
          route,
          task: "renderVision",
          system: "Check each rendered mid-frame thumbnail. Return JSON frames[{sceneId, matchesSelection, subtitleLegible, subjectCropOk, notes?}].",
          prompt: JSON.stringify({
            frames: batch.map((frame) => ({ sceneId: frame.sceneId, order: frame.order })),
          }),
          schema: RenderVisionBatchSchema,
          schemaName: "RenderVision",
          schemaVersion: "1",
          maxOutputTokens: 1_500,
          repairAttempts: 0,
          signal,
          cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
          images: batch.map((frame) => ({ path: frame.path, label: frame.sceneId })),
          visionCacheDir: join(this.dir(project.id), "vision-cache"),
        });
        for (const frame of generated.value.frames) {
          if (!frame.matchesSelection || !frame.subjectCropOk) {
            issues.push({
              code: "FRAME_MISMATCH",
              severity: "ERROR",
              sceneId: frame.sceneId,
              message: frame.notes || "Frame giữa scene không khớp ảnh đã chọn hoặc bị cắt lệch.",
            });
          }
          if (!frame.subtitleLegible) {
            issues.push({
              code: "SUBTITLE_ILLEGIBLE",
              severity: "ERROR",
              sceneId: frame.sceneId,
              message: "Phụ đề khó đọc hoặc che chủ thể.",
            });
          }
        }
      }
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw error;
      const message = error instanceof LlmError ? error.message : error instanceof Error ? error.message : String(error);
      issues.push({
        code: "RENDER_VISION_FAILED",
        severity: "WARN",
        sceneId: null,
        message: `Kiểm tra vision sau render thất bại: ${message}`,
      });
    }
  }

  private async measureVolume(outputPath: string, signal: AbortSignal): Promise<{ meanVolumeDb: number | null; maxVolumeDb: number | null }> {
    try {
      const { stderr } = await this.tools.ffmpeg(
        ["-hide_banner", "-i", outputPath, "-af", "volumedetect", "-f", "null", "-"],
        { signal },
      );
      const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?)/.exec(stderr);
      const max = /max_volume:\s*(-?\d+(?:\.\d+)?)/.exec(stderr);
      return { meanVolumeDb: mean ? Number(mean[1]) : null, maxVolumeDb: max ? Number(max[1]) : null };
    } catch {
      return { meanVolumeDb: null, maxVolumeDb: null };
    }
  }

  private subtitlesMatch(projectId: string, timeline: Timeline, srtPath: string | null, durationSec: number): boolean {
    if (!srtPath || !existsSync(srtPath)) return false;
    const cues = parseSrtCues(readFileSync(srtPath, "utf8"));
    const last = cues.at(-1);
    if (!last || Math.abs(durationSec - last.endSec) > 2) return false;
    const rows = this.sqlite.prepare("SELECT scene_id AS sceneId, words FROM voice_tracks WHERE project_id = ?")
      .all(projectId) as Array<{ sceneId: string; words: unknown }>;
    if (rows.length === 0) return false;
    for (const scene of timeline.scenes) {
      const row = rows.find((item) => item.sceneId === scene.sceneId);
      if (!row) return false;
      const raw = typeof row.words === "string" ? JSON.parse(row.words) as unknown : row.words;
      if (!Array.isArray(raw) || raw.length === 0) return false;
    }
    return true;
  }

  /** Credits from the DB metadata of every visual and the music used in the timeline. */
  creditsText(project: Project, timeline: Timeline): string {
    const visualQuery = this.sqlite.prepare("SELECT title, source_url, license FROM visual_candidates WHERE id = ?");
    const scenes = timeline.scenes.map((scene) => ({
      order: scene.order,
      label: scene.label,
      visuals: scene.visuals.filter((visual) => visual.kind === "IMAGE" && visual.candidateId).map((visual): CreditsAsset => {
        const row = visualQuery.get(visual.candidateId) as { title: string; source_url: string; license: string } | undefined;
        const license = parseLicense(row?.license ?? null);
        return {
          title: row?.title ?? visual.candidateId ?? "",
          author: license.author ?? null,
          licenseName: license.name ?? null,
          licenseUrl: license.url ?? null,
          sourceUrl: row?.source_url || null,
          attributionText: license.attributionText ?? null,
        };
      }),
    }));
    let music: (CreditsAsset & { artist?: string | null }) | null = null;
    if (timeline.music) {
      const row = this.sqlite.prepare("SELECT title, artist, source_url, license FROM music_candidates WHERE id = ?")
        .get(timeline.music.candidateId) as { title: string; artist: string | null; source_url: string | null; license: string } | undefined;
      const license = parseLicense(row?.license ?? null);
      music = {
        title: row?.title ?? timeline.music.title,
        artist: row?.artist ?? null,
        author: license.author ?? null,
        licenseName: license.name ?? null,
        licenseUrl: license.url ?? null,
        sourceUrl: row?.source_url ?? null,
        attributionText: license.attributionText ?? null,
      };
    }
    return buildCreditsText({ videoTitle: project.title, scenes, music, licenseSummary: timeline.licenseSummary });
  }
}
