import { execFile } from "node:child_process";
import { statfsSync } from "node:fs";
import os from "node:os";
import type Database from "better-sqlite3";
import { PROTECTED_PROJECT_ID, ProfileAutomationSchema, type PipelineStage } from "@vg/shared";
import { z } from "zod";
import { publishAgentEvent } from "../events/agentBus.js";
import { effectiveAutonomy } from "../operator/autonomy.js";

/**
 * TASK-129b: resource governor. Each pipeline stage belongs to one class; the
 * governor keeps a slot limit per class and moves it with AIMD (+1 while the
 * machine has headroom, halve when it is over target). The worker asks for a
 * class slot instead of using one fixed number. It never starts a topic.
 */
export const STAGE_CLASSES = ["cpu", "gpu", "io", "llm"] as const;
export type StageClass = (typeof STAGE_CLASSES)[number];

export const STAGE_CLASS_LABELS_VI: Record<StageClass, string> = {
  cpu: "Dựng và xử lý (CPU)",
  gpu: "GPU",
  io: "Tải và đăng (mạng, đĩa)",
  llm: "Gọi AI",
};

// TASK-128: the `agent` class (duty-agent sessions) is added when that task lands.
const CLASS_OF_STAGE: Partial<Record<PipelineStage, StageClass>> = {
  RENDER: "cpu", CLIP: "cpu", TIMELINE: "cpu", SUBTITLE: "cpu",
  TOPIC: "llm", RESEARCH: "llm", SCRIPT: "llm", SCENE_PLAN: "llm", VISUAL_REVIEW: "llm", MUSIC_REVIEW: "llm", ASSISTANT: "llm",
  VISUAL_SEARCH: "io", MEDIA_FETCH: "io", MUSIC_SEARCH: "io", PUBLISH: "io", VOICE: "io",
};

export function stageClassOf(stage: PipelineStage | string, voiceClass: StageClass = "io"): StageClass {
  if (stage === "VOICE") return voiceClass;
  return CLASS_OF_STAGE[stage as PipelineStage] ?? "io";
}

export type LoadSample = {
  cpuPct: number;
  ramPct: number;
  diskFreeBytes: number | null;
  gpuPct: number | null;
};
export type LoadSampler = () => LoadSample | Promise<LoadSample>;

export const GOVERNOR_SETTINGS_KEY = "governor.settings";
export const SAMPLE_INTERVAL_MS = 5_000;
export const STARVED_AFTER_MS = 15 * 60_000;
export const IDLE_AFTER_MS = 10 * 60_000;
const IDLE_REPEAT_MS = 60 * 60_000;
export const TARGETS = { cpuPct: 85, ramPct: 85, gpuPct: 90, diskFreeBytes: 5 * 1024 ** 3 } as const;
/** Headroom needed before a limit may grow, so it does not flap around the target. */
const HEADROOM = 5;

const ClassRange = z.object({ min: z.number().int().min(1).max(64), max: z.number().int().min(1).max(64) });
export const GovernorSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  classes: z.object({
    cpu: ClassRange.optional(), gpu: ClassRange.optional(), io: ClassRange.optional(), llm: ClassRange.optional(),
  }).default({}),
});
export type GovernorSettings = { enabled: boolean; classes: Record<StageClass, { min: number; max: number }> };

export function defaultGovernorSettings(cores = os.cpus().length || 2): GovernorSettings {
  return {
    enabled: true,
    // TASK-127: the llm cap is fixed here; the provider-aware cap comes with that task.
    classes: { cpu: { min: 1, max: Math.max(1, cores) }, gpu: { min: 1, max: 2 }, io: { min: 2, max: 16 }, llm: { min: 2, max: 8 } },
  };
}

export function readGovernorSettings(db: Database.Database, cores?: number): GovernorSettings {
  const base = defaultGovernorSettings(cores);
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(GOVERNOR_SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return base;
  try {
    const parsed = GovernorSettingsSchema.safeParse(JSON.parse(row.value));
    if (!parsed.success) return base;
    const classes = { ...base.classes };
    for (const cls of STAGE_CLASSES) {
      const range = parsed.data.classes[cls];
      if (range) classes[cls] = { min: Math.min(range.min, range.max), max: Math.max(range.min, range.max) };
    }
    return { enabled: parsed.data.enabled, classes };
  } catch {
    return base;
  }
}

export function writeGovernorSettings(db: Database.Database, input: unknown, now = new Date(), cores?: number): GovernorSettings {
  const parsed = GovernorSettingsSchema.parse(input);
  const base = defaultGovernorSettings(cores);
  const classes = { ...base.classes };
  for (const cls of STAGE_CLASSES) {
    const range = parsed.classes[cls];
    if (!range) continue;
    if (range.min > range.max) throw new Error(`Lớp ${cls}: tối thiểu không được lớn hơn tối đa.`);
    classes[cls] = range;
  }
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(GOVERNOR_SETTINGS_KEY, JSON.stringify({ enabled: parsed.enabled, classes }), now.toISOString());
  return { enabled: parsed.enabled, classes };
}

/** Default sampler: CPU from os.cpus() time deltas (works on Windows), RAM, free disk, optional nvidia-smi. */
export function createSystemSampler(dataDir: string): LoadSampler {
  let prev = cpuTimes();
  let gpuAvailable = true;
  return async () => {
    const next = cpuTimes();
    const idle = next.idle - prev.idle;
    const total = next.total - prev.total;
    prev = next;
    const cpuPct = total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
    const ramPct = os.totalmem() > 0 ? (1 - os.freemem() / os.totalmem()) * 100 : 0;
    let diskFreeBytes: number | null = null;
    try {
      const stat = statfsSync(dataDir);
      diskFreeBytes = Number(stat.bavail) * Number(stat.bsize);
    } catch { /* keep null: unknown disk does not throttle */ }
    let gpuPct: number | null = null;
    if (gpuAvailable) {
      gpuPct = await readGpuPct();
      if (gpuPct === null) gpuAvailable = false;
    }
    return { cpuPct, ramPct, diskFreeBytes, gpuPct };
  };
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function readGpuPct(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      execFile("nvidia-smi", ["--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"], { timeout: 2_000, windowsHide: true }, (error, stdout) => {
        if (error) return resolve(null);
        const values = String(stdout).split(/\r?\n/).map((line) => Number(line.trim())).filter((n) => Number.isFinite(n));
        resolve(values.length ? Math.max(...values) : null);
      });
    } catch {
      resolve(null);
    }
  });
}

export type ClassStatus = {
  class: StageClass;
  labelVi: string;
  limit: number;
  min: number;
  max: number;
  running: number;
  waiting: number;
  oldestWaitMs: number | null;
};

export type GovernorStatus = {
  enabled: boolean;
  workerCap: number;
  sample: (LoadSample & { at: string }) | null;
  /** Names of the targets the machine is over right now (Vietnamese). */
  overVi: string[];
  classes: ClassStatus[];
};

export type StarvedClass = { class: StageClass; waiting: number; oldestWaitMs: number; limit: number; running: number };
export type IdleProfile = { profileId: string; profileName: string; approvedTopics: number };

export type GovernorOptions = {
  sqlite: Database.Database;
  sampler: LoadSampler;
  /** Upper bound for every class (WORKER_CONCURRENCY). */
  workerCap: number;
  now?: () => Date;
  cores?: number;
  /** Called when a limit changes so the worker can look for work again. */
  onChange?: () => void;
  /** Budget gate for capacity_idle: true when the profile may not spend more today. */
  budgetStopped?: (profileId: string, now: Date) => boolean;
  voiceClass?: () => StageClass;
  publish?: typeof publishAgentEvent;
};

export class ResourceGovernor {
  private readonly now: () => Date;
  private readonly publish: typeof publishAgentEvent;
  private readonly limits: Record<StageClass, number>;
  private readonly runningByJob = new Map<string, StageClass>();
  private timer: NodeJS.Timeout | undefined;
  private sample: (LoadSample & { at: string }) | null = null;
  private lastCooldownActive = false;
  private idleSince: number | null = null;
  private readonly idleAsked = new Map<string, number>();
  private sampling = false;

  constructor(private readonly options: GovernorOptions) {
    this.now = options.now ?? (() => new Date());
    this.publish = options.publish ?? publishAgentEvent;
    const settings = this.settings();
    this.limits = { cpu: settings.classes.cpu.min, gpu: settings.classes.gpu.min, io: settings.classes.io.min, llm: settings.classes.llm.min };
  }

  settings(): GovernorSettings {
    return readGovernorSettings(this.options.sqlite, this.options.cores);
  }

  private bounds(cls: StageClass, settings = this.settings()): { min: number; max: number } {
    const cap = Math.max(1, this.options.workerCap);
    const range = settings.classes[cls];
    const max = Math.min(range.max, cap);
    return { min: Math.min(range.min, max), max };
  }

  classOf(stage: PipelineStage | string): StageClass {
    return stageClassOf(stage, this.options.voiceClass?.() ?? "io");
  }

  /** True when a job of this class may start now. Disabled governor: only the worker cap applies. */
  hasSlot(cls: StageClass): boolean {
    if (!this.settings().enabled) return true;
    return this.runningIn(cls) < this.limitOf(cls);
  }

  limitOf(cls: StageClass): number {
    const bounds = this.bounds(cls);
    return Math.max(bounds.min, Math.min(bounds.max, this.limits[cls]));
  }

  runningIn(cls: StageClass): number {
    let count = 0;
    for (const value of this.runningByJob.values()) if (value === cls) count += 1;
    return count;
  }

  acquire(jobId: string, cls: StageClass): void {
    this.runningByJob.set(jobId, cls);
  }

  release(jobId: string): void {
    this.runningByJob.delete(jobId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One sampling step: read the load, move the limits (AIMD), maybe ask the duty agent. */
  async tick(): Promise<void> {
    if (this.sampling) return;
    this.sampling = true;
    try {
      const sample = await this.options.sampler();
      const now = this.now();
      this.sample = { ...sample, at: now.toISOString() };
      this.adjust(sample, now);
      this.checkIdle(now);
    } catch {
      /* a failed sample leaves the limits as they are */
    } finally {
      this.sampling = false;
    }
  }

  private over(sample: LoadSample): { cpu: boolean; ram: boolean; gpu: boolean; disk: boolean } {
    return {
      cpu: sample.cpuPct > TARGETS.cpuPct,
      ram: sample.ramPct > TARGETS.ramPct,
      gpu: sample.gpuPct !== null && sample.gpuPct > TARGETS.gpuPct,
      disk: sample.diskFreeBytes !== null && sample.diskFreeBytes < TARGETS.diskFreeBytes,
    };
  }

  private hasHeadroom(sample: LoadSample): boolean {
    return sample.cpuPct < TARGETS.cpuPct - HEADROOM
      && sample.ramPct < TARGETS.ramPct - HEADROOM
      && (sample.gpuPct === null || sample.gpuPct < TARGETS.gpuPct - HEADROOM)
      && (sample.diskFreeBytes === null || sample.diskFreeBytes > TARGETS.diskFreeBytes);
  }

  private llmCooldownActive(now: Date): boolean {
    try {
      return Boolean(this.options.sqlite.prepare("SELECT 1 FROM llm_cooldowns WHERE until > ? LIMIT 1").get(now.toISOString()));
    } catch {
      return false;
    }
  }

  private adjust(sample: LoadSample, now: Date): void {
    const settings = this.settings();
    if (!settings.enabled) return;
    const over = this.over(sample);
    const room = this.hasHeadroom(sample);
    const waiting = this.waitingByClass(now);
    const cooldown = this.llmCooldownActive(now);
    let changed = false;
    for (const cls of STAGE_CLASSES) {
      const { min, max } = this.bounds(cls, settings);
      const current = Math.max(min, Math.min(max, this.limits[cls]));
      let hot: boolean;
      let canGrow = room;
      if (cls === "cpu") hot = over.cpu || over.ram || over.disk;
      else if (cls === "gpu") hot = over.gpu || over.ram || over.disk;
      else if (cls === "io") hot = over.ram || over.disk;
      else {
        // TASK-127: replace this fixed cap with the provider-aware one.
        hot = over.ram || (cooldown && !this.lastCooldownActive);
        canGrow = room && !cooldown;
      }
      let next = current;
      if (hot) next = Math.max(min, Math.floor(current / 2));
      else if (canGrow && current < max && (this.runningIn(cls) >= current || (waiting.get(cls)?.count ?? 0) > 0)) next = current + 1;
      if (next !== this.limits[cls]) changed = true;
      this.limits[cls] = next;
    }
    this.lastCooldownActive = cooldown;
    if (changed) this.options.onChange?.();
  }

  private waitingByClass(now: Date): Map<StageClass, { count: number; oldestMs: number }> {
    const out = new Map<StageClass, { count: number; oldestMs: number }>();
    let rows: { stage: string; created_at: string; run_after: string }[] = [];
    try {
      rows = this.options.sqlite.prepare(
        "SELECT stage, created_at, run_after FROM jobs WHERE status = 'QUEUED' AND run_after <= ? AND project_id != ?",
      ).all(now.toISOString(), PROTECTED_PROJECT_ID) as typeof rows;
    } catch {
      return out;
    }
    for (const row of rows) {
      const cls = this.classOf(row.stage);
      const since = Date.parse(row.run_after > row.created_at ? row.run_after : row.created_at);
      const age = Number.isFinite(since) ? Math.max(0, now.getTime() - since) : 0;
      const entry = out.get(cls) ?? { count: 0, oldestMs: 0 };
      entry.count += 1;
      entry.oldestMs = Math.max(entry.oldestMs, age);
      out.set(cls, entry);
    }
    return out;
  }

  /** Classes whose queued jobs have waited over 15 minutes while every slot is taken. */
  starved(now = this.now()): StarvedClass[] {
    const settings = this.settings();
    const waiting = this.waitingByClass(now);
    const total = this.runningByJob.size;
    const result: StarvedClass[] = [];
    for (const cls of STAGE_CLASSES) {
      const entry = waiting.get(cls);
      if (!entry || entry.oldestMs <= STARVED_AFTER_MS) continue;
      const running = this.runningIn(cls);
      const limit = settings.enabled ? this.limitOf(cls) : Math.max(1, this.options.workerCap);
      const full = settings.enabled ? running >= limit || total >= this.options.workerCap : total >= this.options.workerCap;
      if (full) result.push({ class: cls, waiting: entry.count, oldestWaitMs: entry.oldestMs, limit, running });
    }
    return result;
  }

  status(): GovernorStatus {
    const settings = this.settings();
    const now = this.now();
    const waiting = this.waitingByClass(now);
    const over = this.sample ? this.over(this.sample) : null;
    const overVi: string[] = [];
    if (over?.cpu) overVi.push("CPU");
    if (over?.ram) overVi.push("RAM");
    if (over?.gpu) overVi.push("GPU");
    if (over?.disk) overVi.push("ổ đĩa gần đầy");
    return {
      enabled: settings.enabled,
      workerCap: this.options.workerCap,
      sample: this.sample,
      overVi,
      classes: STAGE_CLASSES.map((cls) => ({
        class: cls,
        labelVi: STAGE_CLASS_LABELS_VI[cls],
        limit: settings.enabled ? this.limitOf(cls) : Math.max(1, this.options.workerCap),
        min: this.bounds(cls, settings).min,
        max: this.bounds(cls, settings).max,
        running: this.runningIn(cls),
        waiting: waiting.get(cls)?.count ?? 0,
        oldestWaitMs: waiting.get(cls)?.oldestMs ?? null,
      })),
    };
  }

  /** True while at least one class could take more work right now. */
  private idleNow(now: Date): boolean {
    if (this.runningByJob.size >= this.options.workerCap) return false;
    const waiting = this.waitingByClass(now);
    if (waiting.size > 0) return false;
    return STAGE_CLASSES.some((cls) => this.hasSlot(cls));
  }

  /**
   * capacity_idle: slots free for 10 minutes and a profile with autopilot on has
   * approved topics left. It only publishes an event for the duty agent. It
   * never starts a topic, and it skips profiles whose budget is spent.
   */
  private checkIdle(now: Date): void {
    if (!this.idleNow(now)) {
      this.idleSince = null;
      return;
    }
    this.idleSince ??= now.getTime();
    if (now.getTime() - this.idleSince < IDLE_AFTER_MS) return;
    for (const profile of this.idleProfiles(now)) {
      const last = this.idleAsked.get(profile.profileId) ?? 0;
      if (now.getTime() - last < IDLE_REPEAT_MS) continue;
      this.idleAsked.set(profile.profileId, now.getTime());
      this.publish({
        type: "capacity_idle",
        link: `/profiles/${profile.profileId}/automation`,
        summary: `Máy đang rảnh hơn 10 phút. Kênh "${profile.profileName}" còn ${profile.approvedTopics} chủ đề đã duyệt. Hỏi agent trực xem có nên đưa chủ đề vào lịch không (không vượt lịch đăng và ngân sách).`,
      });
    }
  }

  idleProfiles(now = this.now()): IdleProfile[] {
    const db = this.options.sqlite;
    let profiles: { id: string; name: string; automation: string | null }[] = [];
    try {
      profiles = db.prepare("SELECT id, name, automation FROM profiles WHERE archived_at IS NULL AND automation IS NOT NULL")
        .all() as typeof profiles;
    } catch {
      return [];
    }
    const out: IdleProfile[] = [];
    for (const profile of profiles) {
      try {
        const { level } = effectiveAutonomy(db, { profileId: profile.id });
        if (level !== "supervised" && level !== "autonomous") continue;
        const automation = ProfileAutomationSchema.safeParse(JSON.parse(profile.automation ?? "null"));
        if (!automation.success || !automation.data.enabled) continue;
        if (this.options.budgetStopped?.(profile.id, now)) continue;
        const { count } = db.prepare("SELECT COUNT(*) AS count FROM profile_topics WHERE profile_id = ? AND status = 'APPROVED'")
          .get(profile.id) as { count: number };
        if (count > 0) out.push({ profileId: profile.id, profileName: profile.name, approvedTopics: count });
      } catch { /* a broken profile row is skipped */ }
    }
    return out;
  }
}
