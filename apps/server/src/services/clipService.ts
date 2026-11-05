import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  CLIP_DEFAULT_COUNT,
  CLIP_DEFAULT_MAX_SEC,
  CLIP_DEFAULT_MIN_SEC,
  ClipPickSchema,
  ClipProposalSchema,
  OWNERSHIP_LABEL,
  ProfileAutomationSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  SPEECH_HINT,
  STAGE_ORDER,
  VideoMetadataDraftSchema,
  alignCuesToCut,
  buildClipFfmpegArgs,
  clampClipOptions,
  condenseTranscript,
  fallbackClipPicks,
  isVerticalClipAccount,
  parseTranscriptFile,
  platformClipMaxSec,
  reframeSegments,
  resolveBudget,
  sceneWantsBlurFill,
  speechToTextConfigured,
  spreadClipSlots,
  toAss,
  toSrt,
  validateClipPicks,
  type ClipProposal,
  type ClipRange,
  type Project,
  type ReframeMode,
  type SpeechToTextSettings,
  type SubtitleCue,
  type TranscriptSentence,
} from "@vg/shared";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import { runFfmpeg, type FfmpegRunOptions } from "../media/ffmpeg.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmError } from "../providers/llm/types.js";
import {
  getSpeechToTextSettings,
  probeSpeechCli,
  saveSpeechToTextSettings,
  transcribeWithSpeechCli,
} from "../settings/speechToText.js";
import { createProjectDir, projectDir } from "../storage/paths.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { resolveSubtitleFontFile, type ThumbnailService } from "./thumbnailService.js";

type Tools = {
  ffmpeg: (args: string[], options?: FfmpegRunOptions) => Promise<{ stdout: string; stderr: string }>;
};

type SceneInfo = {
  start: number;
  end: number;
  blurFill: boolean;
  focusX?: number;
  narration: string;
};

type ClipOptions = {
  count: number;
  minSec: number;
  maxSec: number;
  reframe: ReframeMode;
  platform?: string;
};

export type ClipProjectView = {
  eligible: boolean;
  reason: string | null;
  renderId: string | null;
  options: ClipOptions;
  proposals: ClipProposal[];
  children: Array<{ id: string; title: string; status: string; stage: string }>;
  jobs: Array<{ id: string; proposalId: string; status: string; progress: number; message: string | null }>;
};

const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv"]);

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

export class ClipService {
  private tools: Tools;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly config: AppConfig,
    private readonly jobs: JobRepository,
    private readonly llm?: LlmProviderRegistry,
    private readonly thumbnails?: ThumbnailService,
    tools?: Tools,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.tools = tools ?? { ffmpeg: runFfmpeg };
  }

  setTools(tools: Tools): void {
    this.tools = tools;
  }

  speechSettings(): SpeechToTextSettings {
    return getSpeechToTextSettings(this.sqlite);
  }

  saveSpeechSettings(input: unknown): SpeechToTextSettings {
    const current = this.speechSettings();
    const parsed = SpeechToTextSettingsSchemaSafe(input, current);
    if (parsed.path !== current.path || parsed.tool !== current.tool || parsed.args !== current.args) {
      parsed.detected = false;
    }
    return saveSpeechToTextSettings(this.sqlite, parsed);
  }

  async detectSpeech(input: unknown): Promise<SpeechToTextSettings> {
    const current = this.saveSpeechSettings(input);
    const probe = await probeSpeechCli(current.path, current.args);
    return saveSpeechToTextSettings(this.sqlite, { ...current, detected: probe.ok });
  }

  view(projectId: string): ClipProjectView {
    const project = this.requireProject(projectId);
    const video = this.latestLandscape(projectId);
    const set = this.latestSet(projectId);
    const options = set?.options ?? defaultOptions(project);
    const reason = eligibilityReason(project, video);
    return {
      eligible: reason === null,
      reason,
      renderId: video?.id ?? null,
      options,
      proposals: set?.proposals ?? [],
      children: this.childrenOf(projectId),
      jobs: this.jobsFor(set?.proposals ?? []),
    };
  }

  async propose(projectId: string, input: Partial<ClipOptions>, signal?: AbortSignal): Promise<ClipProjectView> {
    const project = this.requireProject(projectId);
    if (project.kind === "clip") throw new AppError(409, "CLIP_PROJECT", "Không cắt Short từ một clip.");
    const video = this.latestLandscape(projectId);
    const reason = eligibilityReason(project, video);
    if (reason || !video) throw new AppError(409, "CLIP_NOT_READY", reason ?? "Chưa có video ngang.");
    const options = clampClipOptions({
      ...defaultOptions(project),
      ...input,
      platform: project.settings.platform,
    });
    const stored: ClipOptions = { ...options, reframe: input.reframe ?? "center", platform: project.settings.platform };
    const sentences = this.sentencesFor(projectId);
    if (!sentences.length) throw new AppError(409, "CLIP_NO_TRANSCRIPT", "Chưa có lời thoại có mốc thời gian.");
    const scenes = this.scenesFor(projectId);
    const picked = await this.pickClips(project, sentences, scenes.map((scene) => scene.start), stored, signal);
    const proposals = picked.map((clip) => this.proposalFrom(clip, stored.reframe, sentences, scenes));
    const nowIso = this.now().toISOString();
    const id = randomUUID();
    this.sqlite.prepare(
      `INSERT INTO clip_sets (id, project_id, source, external_path, title, ownership_confirmed, options, proposals, status, created_at, updated_at)
       VALUES (?, ?, 'project', NULL, ?, 1, ?, ?, 'proposed', ?, ?)`,
    ).run(id, projectId, project.title, JSON.stringify(stored), JSON.stringify(proposals), nowIso, nowIso);
    return this.view(projectId);
  }

  updateProposals(projectId: string, edits: Array<{ id: string; start?: number; end?: number; hook?: string; title?: string; selected?: boolean }>): ClipProjectView {
    const set = this.requireSet(projectId);
    const sentences = this.sentencesFor(projectId);
    const scenes = this.scenesFor(projectId);
    const next = set.proposals.map((proposal) => {
      const edit = edits.find((item) => item.id === proposal.id);
      if (!edit) return proposal;
      const start = edit.start ?? proposal.start;
      const end = edit.end ?? proposal.end;
      const hook = edit.hook ?? proposal.hook;
      const title = edit.title ?? proposal.title;
      const snapped = validateClipPicks({
        clips: [{ start, end, hook, title, reason: proposal.reason, score: proposal.score }],
        sentences,
        minSec: set.options.minSec,
        maxSec: set.options.maxSec,
        limit: 1,
      });
      if (!snapped.length) {
        throw new AppError(422, "CLIP_RANGE", "Không cắt được đoạn này trong khoảng thời lượng, hoặc đoạn bắt đầu giữa ý.");
      }
      const clip = snapped[0]!;
      return ClipProposalSchema.parse({
        ...proposal,
        ...clip,
        reframe: proposal.reframe,
        snippet: snippet(sentences, clip.start, clip.end),
        selected: edit.selected ?? proposal.selected,
      });
    });
    this.writeProposals(set.id, next, set.status);
    return this.view(projectId);
  }

  exportClips(projectId: string, ids: string[]): ClipProjectView {
    const parent = this.requireProject(projectId);
    const set = this.requireSet(projectId);
    const chosen = set.proposals.filter((proposal) => ids.includes(proposal.id) && proposal.status !== "done");
    if (!chosen.length) throw new AppError(422, "CLIP_NONE", "Chưa chọn clip để xuất.");
    const video = this.latestLandscape(projectId);
    if (!video) throw new AppError(409, "CLIP_NOT_READY", "Chưa có video ngang.");
    const slots = this.slotsFor(parent, chosen.length);
    const proposals = set.proposals.map((proposal) => ({ ...proposal }));
    chosen.forEach((proposal, index) => {
      const childId = proposal.childProjectId ?? randomUUID();
      if (!proposal.childProjectId) this.insertChild(parent, proposal, childId);
      const when = slots[index]?.at.toISOString() ?? "";
      const job = this.jobs.createJob({
        projectId: childId,
        stage: "CLIP",
        maxAttempts: 2,
        previousState: "PENDING",
        scope: `${set.id}|${proposal.id}|${when}`,
      });
      const target = proposals.find((item) => item.id === proposal.id);
      if (target) {
        target.childProjectId = childId;
        target.jobId = job.id;
        target.status = "queued";
        target.selected = true;
        target.error = null;
      }
      void slots[index];
    });
    this.writeProposals(set.id, proposals, "exporting");
    return this.view(projectId);
  }

  async importExternal(input: {
    videoPath: string;
    title?: string;
    transcript?: string;
    transcriptFormat?: "srt" | "vtt" | "plain";
    ownershipConfirmed: boolean;
    profileId?: string;
    count?: number;
    minSec?: number;
    maxSec?: number;
    reframe?: ReframeMode;
  }, signal?: AbortSignal): Promise<{ projectId: string; view: ClipProjectView }> {
    if (!input.ownershipConfirmed) {
      throw new AppError(400, "OWNERSHIP_REQUIRED", `Hãy xác nhận: ${OWNERSHIP_LABEL}`);
    }
    const videoPath = input.videoPath.trim();
    const ext = extname(videoPath).toLowerCase();
    if (!VIDEO_EXT.has(ext)) throw new AppError(422, "CLIP_FILE", "Chỉ nhận mp4, mov hoặc mkv.");
    if (!existsSync(videoPath)) throw new AppError(422, "CLIP_FILE", "Không tìm thấy file video.");
    const size = statSync(videoPath).size;
    if (size > 4 * 1024 * 1024 * 1024) throw new AppError(422, "CLIP_FILE", "Video dài hơn 4 GB.");
    let sentences = input.transcript?.trim()
      ? parseTranscriptFile(input.transcript, input.transcriptFormat)
      : [];
    if (!sentences.length && input.transcript?.trim() && !input.transcript.includes("-->")) {
      throw new AppError(422, "CLIP_TRANSCRIPT", "File phụ đề không đọc được. Dùng SRT hoặc VTT.");
    }
    if (!sentences.length) {
      const speech = this.speechSettings();
      if (!speechToTextConfigured(speech)) throw new AppError(400, "SPEECH_REQUIRED", SPEECH_HINT);
      const work = join(this.config.DATA_DIR, "speech");
      sentences = await transcribeWithSpeechCli(speech, videoPath, work);
      if (!sentences.length) throw new AppError(422, "SPEECH_EMPTY", "Công cụ nhận dạng không trả về phụ đề.");
    }
    const title = (input.title?.trim() || "Video dài đã nhập").slice(0, 200);
    const projectId = randomUUID();
    const nowIso = this.now().toISOString();
    const settings = ProjectSettingsSchema.parse({
      aspectRatio: "16:9",
      platform: "youtube",
      language: "vi",
      targetDurationSec: Math.min(1800, Math.max(30, Math.round(sentences[sentences.length - 1]!.end))),
    });
    this.sqlite.prepare(
      `INSERT INTO projects (
        id, title, description, topic, mode, settings, status, stage, version, profile_id,
        created_at, updated_at, kind, duration_sec
      ) VALUES (?, ?, '', ?, 'MANUAL', ?, 'COMPLETED', 'DONE', 1, ?, ?, ?, 'long', ?)`,
    ).run(
      projectId,
      title,
      title,
      JSON.stringify(settings),
      input.profileId ?? null,
      nowIso,
      nowIso,
      Math.round(sentences[sentences.length - 1]!.end),
    );
    createProjectDir(this.config.DATA_DIR, projectId);
    this.seedStages(projectId, "DONE");
    const renderId = randomUUID();
    this.sqlite.prepare(
      `INSERT INTO renders (
        id, project_id, input_hash, status, output_path, duration_sec, size_bytes, width, height, report, created_at, aspect_ratio
      ) VALUES (?, ?, ?, 'DONE', ?, ?, ?, 1920, 1080, ?, ?, '16:9')`,
    ).run(
      renderId,
      projectId,
      createHash("sha256").update(videoPath).digest("hex"),
      videoPath,
      sentences[sentences.length - 1]!.end,
      size,
      JSON.stringify({ ...reportFor(sentences[sentences.length - 1]!.end), width: 1920, height: 1080 }),
      nowIso,
    );
    const cues = sentences.map((sentence, index) => ({ index, startSec: sentence.start, endSec: sentence.end, text: sentence.text }));
    const srtPath = join(projectDir(this.config.DATA_DIR, projectId), "import.srt");
    writeFileSync(srtPath, toSrt(cues), "utf8");
    this.sqlite.prepare(
      `INSERT INTO subtitle_tracks (id, project_id, cues, srt_path, ass_path, input_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), projectId, JSON.stringify(cues), srtPath, srtPath, "import", nowIso, nowIso);
    await this.propose(projectId, {
      count: input.count,
      minSec: input.minSec,
      maxSec: input.maxSec,
      reframe: input.reframe,
    }, signal);
    return { projectId, view: this.view(projectId) };
  }

  async maybeAutoShorts(project: Project, signal?: AbortSignal): Promise<void> {
    if (project.kind === "clip") return;
    if (project.settings.aspectRatio !== "16:9") return;
    if (!project.profileId) return;
    const row = this.sqlite.prepare("SELECT automation FROM profiles WHERE id = ?").get(project.profileId) as { automation: unknown } | undefined;
    const automation = ProfileAutomationSchema.parse(parseJson(row?.automation, {}));
    if (!automation.autoShorts) return;
    const existing = this.sqlite.prepare("SELECT id FROM projects WHERE parent_project_id = ? LIMIT 1").get(project.id);
    if (existing) return;
    if (!this.latestLandscape(project.id)) return;
    await this.propose(project.id, { count: automation.shortsPerVideo }, signal);
    const set = this.latestSet(project.id);
    const ids = (set?.proposals ?? []).map((proposal) => proposal.id);
    if (ids.length) this.exportClips(project.id, ids);
  }

  async runClip(input: {
    projectId: string;
    scope: string | null;
    signal: AbortSignal;
    reportProgress: (pct: number, message?: string) => void;
  }): Promise<string> {
    const parsed = parseScope(input.scope);
    if (!parsed) throw new AppError(422, "CLIP_SCOPE", "Job clip thiếu phạm vi.");
    const set = this.setById(parsed.setId);
    if (!set?.projectId) throw new AppError(404, "CLIP_SET", "Không tìm thấy đề xuất.");
    const proposal = set.proposals.find((item) => item.id === parsed.proposalId);
    if (!proposal) throw new AppError(404, "CLIP_PROPOSAL", "Không tìm thấy đoạn clip.");
    const parent = this.requireProject(set.projectId);
    const video = this.latestLandscape(parent.id);
    if (!video) throw new AppError(409, "CLIP_NOT_READY", "Video nguồn không còn.");
    const childId = proposal.childProjectId ?? input.projectId;
    input.reportProgress(8, "Chuẩn bị cắt");
    this.markProposal(set.id, proposal.id, { status: "rendering" });
    const dir = join(projectDir(this.config.DATA_DIR, childId), "render");
    mkdirSync(dir, { recursive: true });
    const sentences = this.sentencesFor(parent.id);
    const cues = this.cuesFor(parent.id);
    const aligned = alignCuesToCut(cues, proposal.start, proposal.end);
    const assPath = join(dir, "clip.ass");
    const srtPath = join(dir, "clip.srt");
    writeFileSync(assPath, toAss(aligned, { aspectRatio: "9:16", width: 1080, height: 1920 }), "utf8");
    writeFileSync(srtPath, toSrt(aligned), "utf8");
    const hookPath = join(dir, "hook.txt");
    if (proposal.hook.trim()) writeFileSync(hookPath, proposal.hook.trim(), "utf8");
    const outputPath = join(dir, "clip.mp4");
    const scenes = this.scenesFor(parent.id);
    const segments = reframeSegments({
      clipStart: proposal.start,
      clipEnd: proposal.end,
      mode: proposal.reframe,
      scenes,
    });
    const focusX = segments.find((segment) => segment.mode === "smart")?.focusX;
    let fontFile: string | undefined;
    try { fontFile = resolveSubtitleFontFile(); } catch { fontFile = "C:/Windows/Fonts/arial.ttf"; }
    const plan = buildClipFfmpegArgs({
      inputPath: video.path,
      outputPath,
      clipStart: proposal.start,
      clipEnd: proposal.end,
      mode: segments.length === 1 ? segments[0]!.mode : proposal.reframe,
      focusX,
      segments: segments.length > 1 ? segments : undefined,
      subtitlePath: aligned.length ? assPath : undefined,
      hookTextPath: proposal.hook.trim() ? hookPath : undefined,
      fontFile,
      mediaDurationSec: video.durationSec,
    });
    input.reportProgress(25, "Đang render 9:16");
    await this.tools.ffmpeg(plan.args, { signal: input.signal });
    if (!existsSync(outputPath)) throw new AppError(500, "CLIP_RENDER", "FFmpeg không tạo được file clip.");
    const size = statSync(outputPath).size;
    const nowIso = this.now().toISOString();
    const renderId = randomUUID();
    this.sqlite.prepare(
      `INSERT INTO renders (
        id, project_id, input_hash, status, output_path, srt_path, duration_sec, size_bytes, width, height, report, created_at, aspect_ratio
      ) VALUES (?, ?, ?, 'DONE', ?, ?, ?, ?, 1080, 1920, ?, ?, '9:16')`,
    ).run(
      renderId,
      childId,
      createHash("sha256").update(`${proposal.id}:${proposal.start}:${proposal.end}`).digest("hex"),
      outputPath,
      srtPath,
      plan.durationSec,
      size,
      JSON.stringify(reportFor(plan.durationSec)),
      nowIso,
    );
    this.writeMetadata(parent, proposal, childId, nowIso);
    this.sqlite.prepare(
      "UPDATE projects SET status = 'COMPLETED', stage = 'DONE', duration_sec = ?, updated_at = ? WHERE id = ?",
    ).run(Math.round(plan.durationSec), nowIso, childId);
    this.sqlite.prepare(
      "UPDATE project_stages SET state = 'DONE', progress = 100, message = 'Clip xong', updated_at = ? WHERE project_id = ? AND stage = 'RENDER'",
    ).run(nowIso, childId);
    this.scheduleChild(parent, childId, renderId, parsed.scheduledFor, nowIso);
    if (this.thumbnails) {
      try {
        const child = this.requireProject(childId);
        await this.thumbnails.ensureAuto(child, input.signal);
      } catch (error) {
        if (input.signal.aborted) throw error;
      }
    }
    this.markProposal(set.id, proposal.id, { status: "done", error: null });
    input.reportProgress(100, "Đã xuất clip");
    return `Đã xuất ${proposal.title}`;
  }

  private async pickClips(
    project: Project,
    sentences: TranscriptSentence[],
    sceneStarts: number[],
    options: ClipOptions,
    signal?: AbortSignal,
  ): Promise<ClipRange[]> {
    const features = resolveBudget(project);
    let picked: ClipRange[] = [];
    if (features.clipPick && this.llm) {
      try {
        const route = this.llm.resolveTask("clipPick", project, getAppLlmSettings(this.sqlite));
        const profile = this.profileContext(project.profileId);
        const generated = await generateRoutedStructured({
          registry: this.llm,
          route,
          task: "clipPick",
          system: "Bạn chọn các đoạn dọc 9:16 từ video dài. Chỉ trả JSON đúng schema. start và end là giây, bám mốc câu. hook tối đa 60 ký tự, là chữ hiện ở 2 giây đầu. score từ 0 đến 100.",
          prompt: JSON.stringify({
            title: project.title,
            direction: profile.direction,
            learnedNotes: profile.learnedNotes,
            count: options.count,
            minSec: options.minSec,
            maxSec: options.maxSec,
            platformMaxSec: platformClipMaxSec(project.settings.platform),
            transcript: condenseTranscript(sentences),
            sentences: sentences.slice(0, 400),
          }),
          schema: ClipPickSchema,
          schemaName: "ClipPick",
          schemaVersion: "1",
          maxOutputTokens: route.maxOutputTokens ?? 2048,
          repairAttempts: 1,
          signal: signal ?? new AbortController().signal,
          cache: new LlmCache(this.sqlite, this.config.LLM_CACHE_ENABLED),
        });
        picked = validateClipPicks({
          clips: generated.value.clips,
          sentences,
          minSec: options.minSec,
          maxSec: options.maxSec,
          limit: options.count,
        });
      } catch (error) {
        if (error instanceof LlmError && !error.retryable) picked = [];
        else if (signal?.aborted) throw error;
        else picked = [];
      }
    }
    if (!picked.length) {
      picked = fallbackClipPicks({
        sentences,
        sceneStarts,
        minSec: options.minSec,
        maxSec: options.maxSec,
        count: options.count,
      });
    }
    if (!picked.length) throw new AppError(422, "CLIP_EMPTY", "Không tìm được đoạn nào trong khoảng thời lượng.");
    return picked;
  }

  private proposalFrom(clip: ClipRange, reframe: ReframeMode, sentences: TranscriptSentence[], scenes: SceneInfo[]): ClipProposal {
    const segments = reframeSegments({ clipStart: clip.start, clipEnd: clip.end, mode: reframe, scenes });
    const mode = segments.every((segment) => segment.mode === segments[0]?.mode) ? segments[0]!.mode : reframe;
    return ClipProposalSchema.parse({
      id: randomUUID(),
      ...clip,
      reframe: mode,
      snippet: snippet(sentences, clip.start, clip.end),
      selected: true,
      childProjectId: null,
      jobId: null,
      status: "proposed",
      error: null,
    });
  }

  private insertChild(parent: Project, proposal: ClipProposal, childId: string): void {
    const nowIso = this.now().toISOString();
    const duration = Math.max(1, proposal.end - proposal.start);
    const settings = ProjectSettingsSchema.parse({
      ...parent.settings,
      aspectRatio: "9:16",
      platform: parent.settings.platform === "facebook_reels" ? "facebook_reels" : "youtube_shorts",
      targetDurationSec: Math.min(1800, Math.max(30, Math.round(duration))),
    });
    this.sqlite.prepare(
      `INSERT INTO projects (
        id, title, description, topic, mode, settings, status, stage, version, profile_id,
        created_at, updated_at, kind, parent_project_id, duration_sec
      ) VALUES (?, ?, ?, ?, ?, ?, 'RENDERING', 'RENDER', 1, ?, ?, ?, 'clip', ?, ?)`,
    ).run(
      childId,
      proposal.title.slice(0, 200),
      clipDescription(parent, this.parentUrl(parent.id), this.parentHashtags(parent.id)),
      parent.topic,
      parent.mode,
      JSON.stringify(settings),
      parent.profileId,
      nowIso,
      nowIso,
      parent.id,
      Math.round(duration),
    );
    createProjectDir(this.config.DATA_DIR, childId);
    this.seedStages(childId, "RUNNING");
  }

  private scheduleChild(parent: Project, childId: string, renderId: string, scheduledFor: string | null, nowIso: string): void {
    if (!parent.profileId) return;
    const accounts = this.sqlite.prepare(
      "SELECT id, platform, format, enabled FROM platform_accounts WHERE profile_id = ?",
    ).all(parent.profileId) as Array<{ id: string; platform: string; format: string; enabled: number }>;
    const vertical = accounts.filter((account) => isVerticalClipAccount({
      platform: account.platform,
      format: account.format,
      enabled: Boolean(account.enabled),
    }));
    if (!vertical.length) return;
    for (const account of vertical) {
      this.sqlite.prepare(
        `INSERT INTO publications (
          id, project_id, render_id, account_id, status, visibility_requested, visibility_used,
          scheduled_for, attempts, progress, warnings, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'SCHEDULED', 'public', 'public', ?, 0, 0, '[]', ?, ?)`,
      ).run(randomUUID(), childId, renderId, account.id, scheduledFor || null, nowIso, nowIso);
    }
  }

  private slotsFor(parent: Project, count: number) {
    const automation = this.automationFor(parent.profileId);
    const after = this.parentPublishAt(parent.id);
    const assigned = parent.profileId
      ? (this.sqlite.prepare(
        `SELECT p.scheduled_for AS scheduled_for FROM publications p
         JOIN platform_accounts a ON a.id = p.account_id
         WHERE a.profile_id = ? AND p.scheduled_for IS NOT NULL AND p.status != 'CANCELLED'`,
      ).all(parent.profileId) as Array<{ scheduled_for: string }>).map((row) => row.scheduled_for)
      : [];
    return spreadClipSlots({
      now: this.now(),
      after,
      count,
      automation,
      assignedSlotIsos: assigned,
    });
  }

  private automationFor(profileId: string | null | undefined) {
    if (!profileId) return ProfileAutomationSchema.parse({});
    const row = this.sqlite.prepare("SELECT automation FROM profiles WHERE id = ?").get(profileId) as { automation: unknown } | undefined;
    return ProfileAutomationSchema.parse(parseJson(row?.automation, {}));
  }

  private parentPublishAt(projectId: string): Date | null {
    const rows = this.sqlite.prepare(
      "SELECT scheduled_for, published_at FROM publications WHERE project_id = ? AND status != 'CANCELLED'",
    ).all(projectId) as Array<{ scheduled_for: string | null; published_at: string | null }>;
    let max = 0;
    for (const row of rows) {
      for (const iso of [row.scheduled_for, row.published_at]) {
        const ms = iso ? Date.parse(iso) : NaN;
        if (!Number.isNaN(ms) && ms > max) max = ms;
      }
    }
    return max ? new Date(max) : null;
  }

  private parentUrl(projectId: string): string | null {
    const row = this.sqlite.prepare(
      "SELECT external_url FROM publications WHERE project_id = ? AND status = 'PUBLISHED' AND external_url IS NOT NULL ORDER BY published_at DESC LIMIT 1",
    ).get(projectId) as { external_url: string } | undefined;
    return row?.external_url ?? null;
  }

  private parentHashtags(projectId: string): string[] {
    const row = this.sqlite.prepare("SELECT draft, edited FROM video_metadata WHERE project_id = ?").get(projectId) as { draft: unknown; edited: unknown } | undefined;
    if (!row) return [];
    const edited = parseJson<{ hashtags?: string[] } | null>(row.edited, null);
    const draft = parseJson<{ hashtags?: string[] }>(row.draft, {});
    const tags = edited?.hashtags ?? draft.hashtags ?? [];
    return tags.slice(0, 5);
  }

  private writeMetadata(parent: Project, proposal: ClipProposal, childId: string, nowIso: string): void {
    const hashtags = this.parentHashtags(parent.id);
    const tags = hashtags.map((tag) => tag.replace(/^#/, "")).slice(0, 15);
    const draft = VideoMetadataDraftSchema.parse({
      titles: [proposal.title.slice(0, 100)],
      description: clipDescription(parent, this.parentUrl(parent.id), hashtags).slice(0, 1500),
      tags: tags.length ? tags : [parent.topic.slice(0, 40)],
      hashtags: hashtags.length ? hashtags : ["#shorts"],
      thumbnailText: [(proposal.hook || proposal.title).slice(0, 32)],
    });
    this.sqlite.prepare(
      `INSERT INTO video_metadata (project_id, input_hash, draft, edited, source, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'CODE', ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at`,
    ).run(childId, `clip:${proposal.id}`, JSON.stringify(draft), nowIso, nowIso);
  }

  private sentencesFor(projectId: string): TranscriptSentence[] {
    const cues = this.cuesFor(projectId);
    if (cues.length) {
      return cues.map((cue) => ({ start: cue.startSec, end: cue.endSec, text: cue.text }));
    }
    const scenes = this.sqlite.prepare(
      "SELECT start_sec, est_duration_sec, narration FROM scenes WHERE project_id = ? ORDER BY \"order\"",
    ).all(projectId) as Array<{ start_sec: number; est_duration_sec: number; narration: string }>;
    const sentences: TranscriptSentence[] = [];
    for (const scene of scenes) {
      const parts = scene.narration.split(/(?<=[.!?。！？])\s+/).map((part) => part.trim()).filter(Boolean);
      if (!parts.length) continue;
      const end = scene.start_sec + Math.max(scene.est_duration_sec, 0.5);
      const weight = parts.reduce((sum, part) => sum + part.length, 0) || 1;
      let cursor = scene.start_sec;
      parts.forEach((part, index) => {
        const next = index === parts.length - 1 ? end : cursor + (end - scene.start_sec) * (part.length / weight);
        sentences.push({ start: cursor, end: next, text: part });
        cursor = next;
      });
    }
    return sentences;
  }

  private cuesFor(projectId: string): SubtitleCue[] {
    const sub = this.sqlite.prepare("SELECT cues FROM subtitle_tracks WHERE project_id = ?").get(projectId) as { cues: unknown } | undefined;
    const subtitleCues = parseJson<SubtitleCue[]>(sub?.cues, []);
    if (subtitleCues.length) return subtitleCues;
    const voices = this.sqlite.prepare(
      `SELECT v.cues AS cues FROM voice_tracks v
       JOIN scenes s ON s.id = v.scene_id
       WHERE v.project_id = ? ORDER BY s."order"`,
    ).all(projectId) as Array<{ cues: unknown }>;
    return voices.flatMap((row) => parseJson<SubtitleCue[]>(row.cues, []));
  }

  private scenesFor(projectId: string): SceneInfo[] {
    const rows = this.sqlite.prepare(
      `SELECT s.start_sec, s.est_duration_sec, s.narration, s.visual_notes, s.visual_description, s.label, vs.motion
       FROM scenes s
       LEFT JOIN visual_selections vs ON vs.scene_id = s.id AND vs.slot = 0
       WHERE s.project_id = ? ORDER BY s."order"`,
    ).all(projectId) as Array<{
      start_sec: number;
      est_duration_sec: number;
      narration: string;
      visual_notes: string;
      visual_description: string;
      label: string;
      motion: unknown;
    }>;
    return rows.map((row) => {
      const motion = parseJson<{ from?: { x?: number } } | null>(row.motion, null);
      const focus = motion?.from?.x;
      const text = `${row.label} ${row.visual_notes} ${row.visual_description}`;
      return {
        start: row.start_sec,
        end: row.start_sec + Math.max(row.est_duration_sec, 0.5),
        blurFill: sceneWantsBlurFill(text),
        narration: row.narration,
        ...(typeof focus === "number" ? { focusX: focus } : {}),
      };
    });
  }

  private latestLandscape(projectId: string): { id: string; path: string; durationSec: number } | null {
    const row = this.sqlite.prepare(
      `SELECT id, output_path, duration_sec, width, height, aspect_ratio FROM renders
       WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    ).all(projectId) as Array<{ id: string; output_path: string; duration_sec: number; width: number; height: number; aspect_ratio: string | null }>;
    const match = row.find((item) => (item.aspect_ratio == null || item.aspect_ratio === "16:9") && item.width >= item.height);
    if (!match) return null;
    return { id: match.id, path: match.output_path, durationSec: match.duration_sec };
  }

  private latestSet(projectId: string): { id: string; options: ClipOptions; proposals: ClipProposal[]; status: string } | null {
    const row = this.sqlite.prepare(
      "SELECT * FROM clip_sets WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(projectId) as { id: string; options: unknown; proposals: unknown; status: string } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      options: parseJson<ClipOptions>(row.options, { count: CLIP_DEFAULT_COUNT, minSec: CLIP_DEFAULT_MIN_SEC, maxSec: CLIP_DEFAULT_MAX_SEC, reframe: "center" }),
      proposals: parseJson<ClipProposal[]>(row.proposals, []),
      status: row.status,
    };
  }

  private setById(id: string): { id: string; projectId: string | null; proposals: ClipProposal[] } | null {
    const row = this.sqlite.prepare("SELECT id, project_id, proposals FROM clip_sets WHERE id = ?").get(id) as { id: string; project_id: string | null; proposals: unknown } | undefined;
    if (!row) return null;
    return { id: row.id, projectId: row.project_id, proposals: parseJson<ClipProposal[]>(row.proposals, []) };
  }

  private requireSet(projectId: string): { id: string; options: ClipOptions; proposals: ClipProposal[]; status: string } {
    const set = this.latestSet(projectId);
    if (!set) throw new AppError(404, "CLIP_SET", "Chưa có đề xuất. Bấm Tạo đề xuất trước.");
    return set;
  }

  private writeProposals(setId: string, proposals: ClipProposal[], status: string): void {
    this.sqlite.prepare("UPDATE clip_sets SET proposals = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(proposals), status, this.now().toISOString(), setId);
  }

  private markProposal(setId: string, proposalId: string, patch: Partial<ClipProposal>): void {
    const set = this.setById(setId);
    if (!set) return;
    const proposals = set.proposals.map((proposal) => proposal.id === proposalId ? { ...proposal, ...patch } : proposal);
    const status = proposals.every((proposal) => proposal.status === "done" || proposal.status === "failed") ? "done" : "exporting";
    this.writeProposals(setId, proposals, status);
  }

  private childrenOf(projectId: string): Array<{ id: string; title: string; status: string; stage: string }> {
    return this.sqlite.prepare(
      "SELECT id, title, status, stage FROM projects WHERE parent_project_id = ? ORDER BY created_at",
    ).all(projectId) as Array<{ id: string; title: string; status: string; stage: string }>;
  }

  private jobsFor(proposals: ClipProposal[]): ClipProjectView["jobs"] {
    return proposals.flatMap((proposal) => {
      if (!proposal.jobId) return [];
      const row = this.sqlite.prepare("SELECT id, status, progress, message FROM jobs WHERE id = ?").get(proposal.jobId) as { id: string; status: string; progress: number; message: string | null } | undefined;
      if (!row) return [];
      return [{ id: row.id, proposalId: proposal.id, status: row.status, progress: row.progress, message: row.message }];
    });
  }

  private seedStages(projectId: string, renderState: "DONE" | "RUNNING"): void {
    const nowIso = this.now().toISOString();
    const insert = this.sqlite.prepare(
      "INSERT OR IGNORE INTO project_stages (project_id, stage, state, progress, message, job_id, updated_at, error) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)",
    );
    for (const stage of STAGE_ORDER) {
      if (stage === "RENDER") insert.run(projectId, stage, renderState, renderState === "DONE" ? 100 : 5, nowIso);
      else insert.run(projectId, stage, "SKIPPED", 100, nowIso);
    }
  }

  private profileContext(profileId: string | null | undefined): { direction: string; learnedNotes: string } {
    if (!profileId) return { direction: "", learnedNotes: "" };
    const row = this.sqlite.prepare("SELECT direction, learned_notes FROM profiles WHERE id = ?").get(profileId) as { direction: string; learned_notes: string } | undefined;
    return { direction: row?.direction ?? "", learnedNotes: row?.learned_notes ?? "" };
  }

  private requireProject(id: string): Project {
    const row = this.sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return ProjectSchema.parse({
      id: row.id,
      title: row.title,
      description: row.description,
      topic: row.topic,
      mode: row.mode,
      settings: parseJson(row.settings, {}),
      status: row.status,
      stage: row.stage,
      thumbnailPath: row.thumbnail_path,
      coverPath: row.cover_path ?? null,
      thumbnailMeta: parseJson(row.thumbnail_meta, null),
      durationSec: row.duration_sec,
      version: row.version,
      profileId: row.profile_id ?? null,
      kind: row.kind === "clip" ? "clip" : row.kind === "translation" ? "translation" : "long",
      parentProjectId: row.parent_project_id ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    });
  }
}

function SpeechToTextSettingsSchemaSafe(input: unknown, current: SpeechToTextSettings): SpeechToTextSettings {
  const body = (input && typeof input === "object") ? input as Record<string, unknown> : {};
  return {
    tool: body.tool === null || body.tool === "whisper" || body.tool === "whisper.cpp" || body.tool === "faster-whisper"
      ? body.tool
      : current.tool,
    path: typeof body.path === "string" ? body.path : current.path,
    args: typeof body.args === "string" ? body.args : current.args,
    detected: current.detected,
  };
}

function defaultOptions(project: Project): ClipOptions {
  const clamped = clampClipOptions({ platform: project.settings.platform });
  return { ...clamped, reframe: "center", platform: project.settings.platform };
}

function eligibilityReason(project: Project, video: { id: string } | null): string | null {
  if (project.kind === "clip") return "Dự án này đã là một Short.";
  if (project.settings.aspectRatio !== "16:9") return "Chỉ cắt Short từ video ngang 16:9.";
  if (!video) return "Cần một bản render ngang thành công.";
  return null;
}

function snippet(sentences: TranscriptSentence[], start: number, end: number): string {
  return sentences
    .filter((sentence) => sentence.end > start && sentence.start < end)
    .map((sentence) => sentence.text.trim())
    .join(" ")
    .slice(0, 280);
}

function clipDescription(parent: Project, url: string | null, hashtags: string[]): string {
  const link = url ? `Xem video đầy đủ: ${url}` : `Xem video đầy đủ: ${parent.title}`;
  const tags = hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ");
  return [link, tags].filter(Boolean).join("\n");
}

function reportFor(durationSec: number) {
  return {
    ok: true,
    expectedDurationSec: durationSec,
    durationSec,
    width: 1080,
    height: 1920,
    hasAudio: true,
    issues: [],
    thumbnails: [],
    clipsReused: 0,
    clipsRendered: 1,
    elapsedSec: 0,
  };
}

function parseScope(scope: string | null): { setId: string; proposalId: string; scheduledFor: string | null } | null {
  if (!scope) return null;
  const [setId, proposalId, scheduledFor] = scope.split("|");
  if (!setId || !proposalId) return null;
  return { setId, proposalId, scheduledFor: scheduledFor || null };
}
