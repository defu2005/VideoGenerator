import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { COMMERCIAL_OK, LICENSE_KINDS, type Job, type LicenseMetadata, type Project } from "@vg/shared";
import { AppError } from "../lib/errors.js";
import type { TrustedAgent } from "../supervision/identity.js";
import type { JobRepository } from "../jobs/jobRepository.js";
import { isDeniedHost, parseDomainDenylist } from "../providers/images/webCrawl.js";
import { projectDir } from "../storage/paths.js";
import type { AutoReportService } from "../services/autoReportService.js";
import { isPrivateLiteralHost } from "./researchToolkit.js";
import type { AgentStageService } from "./stageService.js";
import type { AudioStore } from "../services/audioStore.js";
import type { AgentMusicStoredItem, MusicService } from "../services/musicService.js";

export const MUSIC_MAX_CANDIDATES = 8;
export const MUSIC_HANDOFF_ERRORS: readonly string[] = ["MUSIC_SEARCH_FAILED"];

const httpUrl = z.string().url().max(2000).refine((value) => /^https?:\/\//i.test(value), "phải là http(s)");

/** One candidate from the music scout. Shape is checked here; licence and URLs are checked in screenMusicCandidate. */
export const AgentMusicCandidateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).nullable().optional(),
  sourceUrl: httpUrl,
  downloadUrl: httpUrl,
  licence: z.enum(LICENSE_KINDS),
  licenceUrl: httpUrl,
  licenceName: z.string().trim().max(200).optional(),
  durationSec: z.number().nonnegative().max(7200).nullable().optional(),
  mood: z.string().trim().max(60).optional(),
  reason: z.string().trim().max(300).optional(),
  genres: z.array(z.string().max(60)).max(10).optional(),
  tags: z.array(z.string().max(60)).max(10).optional(),
}).strict();
export type AgentMusicCandidate = z.infer<typeof AgentMusicCandidateSchema>;

export const AgentMusicSubmitSchema = z.object({
  candidates: z.array(z.unknown()).min(1).max(MUSIC_MAX_CANDIDATES),
}).strict();

export type MusicRejection = { index: number; title: string | null; reason: string };

/** Sync gate: licence, URL schemes, private hosts and the denylist. Runs inside the lease. */
export function screenMusicCandidate(raw: unknown, denylist: readonly string[]): { ok: true; candidate: AgentMusicCandidate } | { ok: false; reason: string } {
  const shape = AgentMusicCandidateSchema.safeParse(raw);
  if (!shape.success) {
    return { ok: false, reason: `Sai cấu trúc: ${shape.error.issues.map((issue) => `${issue.path.join(".") || "candidate"} ${issue.message}`).join("; ")}` };
  }
  const candidate = shape.data;
  if (!(COMMERCIAL_OK as readonly string[]).includes(candidate.licence)) {
    return { ok: false, reason: `Giấy phép ${candidate.licence} không được dùng thương mại.` };
  }
  for (const [label, url] of [["sourceUrl", candidate.sourceUrl], ["downloadUrl", candidate.downloadUrl], ["licenceUrl", candidate.licenceUrl]] as const) {
    const host = new URL(url).hostname;
    if (isPrivateLiteralHost(host)) return { ok: false, reason: `${label} trỏ tới máy nội bộ.` };
    if (isDeniedHost(host, denylist)) return { ok: false, reason: `${label} thuộc miền bị chặn.` };
  }
  return { ok: true, candidate };
}

export function itemIdFor(downloadUrl: string): string {
  return createHash("sha256").update(downloadUrl).digest("hex").slice(0, 32);
}

export class AgentMusicToolkit {
  constructor(
    private readonly repository: JobRepository,
    private readonly stages: AgentStageService,
    private readonly music: MusicService,
    private readonly audio: AudioStore,
    private readonly probe: (file: string, signal?: AbortSignal) => Promise<number>,
    private readonly dataDir: string,
    private readonly denylistConfig: string,
    private readonly autoReport?: AutoReportService,
  ) {}

  private get denylist(): string[] { return parseDomainDenylist(this.denylistConfig); }

  private projectOf(job: Job): Project {
    const project = this.repository.getProject(job.projectId);
    if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    return project;
  }

  /** Marker written into music_candidates.input_hash; identifies the rows one lease stored. */
  private markerFor(jobId: string): string | null {
    const lease = this.repository.getExecutionLease(jobId);
    return lease ? `agent:${lease.leaseId}` : null;
  }

  context(job: Job) {
    const project = this.projectOf(job);
    return {
      projectId: project.id,
      topic: project.topic,
      music: { enabled: project.settings.music.enabled, query: this.music.input(project).query },
      requirements: {
        maxCandidates: MUSIC_MAX_CANDIDATES,
        allowedLicences: [...COMMERCIAL_OK],
        rule: "Chỉ đề xuất nhạc có giấy phép thương mại trong allowedLicences, tải được qua downloadUrl http(s) công khai. App tải, kiểm và lưu; agent không chọn bản cuối cùng.",
      },
    };
  }

  /**
   * Four steps. (1) A fenced screen: shape, licence, URLs, duplicates, and the per-lease cap of 8 across all submits.
   * (2) Heartbeat to renew the lease. (3) Downloads outside the lease, since the lease is synchronous.
   * (4) A fenced insert. If the lease is lost during downloads, step 4 throws LEASE_LOST and writes no rows.
   * Downloaded files are content-addressed, so orphans are harmless.
   */
  async submit(agent: TrustedAgent, jobId: string, leaseId: string, input: unknown) {
    const screened = this.stages.withLease(agent, jobId, leaseId, (job) => {
      const project = this.projectOf(job);
      if (!project.settings.music.enabled) throw new AppError(409, "MUSIC_DISABLED", "Nhạc nền đang tắt.");
      const shape = AgentMusicSubmitSchema.safeParse(input);
      if (!shape.success) {
        throw new AppError(422, "MUSIC_AGENT_INVALID", "Danh sách bản nhạc sai cấu trúc.", { problems: shape.error.issues.map((issue) => issue.message) });
      }
      const marker = `agent:${leaseId}`;
      const alreadyStored = new Set(this.music.agentRowsFor(project.id, marker).map((row) => row.provider_item_id));
      const accepted: Array<{ index: number; candidate: AgentMusicCandidate; itemId: string }> = [];
      const rejected: MusicRejection[] = [];
      const seenUrls = new Set<string>();
      shape.data.candidates.forEach((raw, index) => {
        const result = screenMusicCandidate(raw, this.denylist);
        const title = typeof (raw as { title?: unknown })?.title === "string" ? (raw as { title: string }).title : null;
        if (!result.ok) { rejected.push({ index, title, reason: result.reason }); return; }
        const itemId = itemIdFor(result.candidate.downloadUrl);
        if (seenUrls.has(itemId)) { rejected.push({ index, title, reason: "Trùng downloadUrl với bản khác trong cùng lượt nộp." }); return; }
        seenUrls.add(itemId);
        if (alreadyStored.has(itemId)) { rejected.push({ index, title, reason: "Bản này đã được lưu trong lượt này." }); return; }
        accepted.push({ index, candidate: result.candidate, itemId });
      });
      if (alreadyStored.size + accepted.length > MUSIC_MAX_CANDIDATES) {
        throw new AppError(422, "MUSIC_AGENT_INVALID", `Lượt này tối đa ${MUSIC_MAX_CANDIDATES} bản nhạc.`,
          { problems: [`Đã lưu ${alreadyStored.size} bản, nộp thêm ${accepted.length} bản.`] });
      }
      return { projectId: project.id, accepted, rejected, marker };
    });

    // Renew the lease before downloads (fenced; throws LEASE_LOST if it was already lost).
    if (screened.accepted.length) this.stages.heartbeat(agent, jobId, leaseId, undefined, "Đang tải nhạc");

    const downloads = await Promise.allSettled(screened.accepted.map(({ candidate }) =>
      this.audio.download(screened.projectId, candidate.downloadUrl).then(async (stored) => {
        const absolute = join(projectDir(this.dataDir, screened.projectId), stored.localPath);
        const probed = await this.probe(absolute).catch(() => 0);
        return { stored, durationSec: probed > 0 ? Math.round(probed * 10) / 10 : (candidate.durationSec ?? null) };
      }),
    ));

    const items: AgentMusicStoredItem[] = [];
    const rejected = [...screened.rejected];
    downloads.forEach((result, slot) => {
      const { index, candidate, itemId } = screened.accepted[slot];
      if (result.status === "rejected") {
        const why = result.reason instanceof Error ? result.reason.message : String(result.reason);
        rejected.push({ index, title: candidate.title, reason: `Không tải được: ${why}` });
        return;
      }
      const license: LicenseMetadata = {
        kind: candidate.licence,
        name: candidate.licenceName ?? candidate.licence,
        url: candidate.licenceUrl,
        author: candidate.artist ?? null,
        authorUrl: null,
        attributionRequired: candidate.licence !== "CC0" && candidate.licence !== "PUBLIC_DOMAIN",
        attributionText: candidate.artist ? `${candidate.title} — ${candidate.artist}` : candidate.title,
        // The agent's licence claim is not verified against the source, so the app records no evidence.
        evidence: "none",
      };
      items.push({
        itemId,
        title: candidate.title,
        artist: candidate.artist ?? null,
        sourceUrl: candidate.sourceUrl,
        audioUrl: candidate.downloadUrl,
        durationSec: result.value.durationSec,
        genres: candidate.genres ?? [],
        tags: candidate.tags ?? [],
        license,
        score: Math.max(0, 1 - index * 0.01),
        localPath: result.value.stored.localPath,
      });
    });

    const stored = this.stages.withLease(agent, jobId, leaseId, (job) => {
      if (items.length) this.music.addAgentCandidates(this.projectOf(job), items, screened.marker);
      return { stored: items.length, rejected };
    });
    return { projectId: screened.projectId, stored: stored.stored, rejected: stored.rejected };
  }

  /** Complete needs at least one agent candidate stored with a local file by THIS lease, unless music is disabled. */
  validateComplete(job: Job): void {
    const project = this.projectOf(job);
    if (!project.settings.music.enabled) return;
    const marker = this.markerFor(job.id);
    if (!marker || !this.music.agentRowsFor(project.id, marker).length) {
      throw new AppError(422, "MUSIC_AGENT_INVALID", "Chưa có bản nhạc nào được tải và lưu từ lượt này.", { problems: ["Chưa có bản nhạc agent nào được lưu."] });
    }
  }

  /**
   * App-side post-step before completion. The agent path skips MusicSearchExecutor, so the AUTO pick
   * the executor makes must happen here, with the same reports. Outside the fence (select may download).
   */
  async prepareComplete(job: Job): Promise<void> {
    const project = this.projectOf(job);
    if (!project.settings.music.enabled || project.mode !== "AUTO") return;
    if (this.music.selectionRow(project.id)?.selected_by === "USER") return;
    this.autoReport?.clearStage(project.id, "MUSIC_REVIEW");
    const current = this.music.selectionRow(project.id);
    if (current?.candidate_id) {
      try {
        await this.music.select(project, current.candidate_id, "AGENT");
        this.autoReport?.add(project.id, { stage: "MUSIC_REVIEW", code: "MUSIC_AUTO_PICKED", severity: "INFO",
          message: "AUTO đã chọn bản nhạc xếp hạng cao nhất.", data: { candidateId: current.candidate_id } });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        this.music.selectNone(project, "AGENT");
        this.autoReport?.add(project.id, { stage: "MUSIC_REVIEW", code: "MUSIC_NONE", severity: "WARN",
          message: "Không dùng nhạc — tải bản chọn thất bại.", data: { reason: error.message } });
      }
    } else {
      this.music.selectNone(project, "AGENT");
      this.autoReport?.add(project.id, { stage: "MUSIC_REVIEW", code: "MUSIC_NONE", severity: "WARN",
        message: "Không dùng nhạc — không có bản ứng viên phù hợp.", data: null });
    }
  }
}
