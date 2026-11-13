import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { OVERDUE_NOTICE_AFTER_MS, PROTECTED_PROJECT_ID, ProfileAutomationSchema, enumerateSlots, overdueCheckSpacingMs, resolveStageTimeoutMs, timeoutBriefFromSettings } from "@vg/shared";
import { lastOverdueCheck } from "../jobs/overdueStore.js";
import type { FastifyBaseLogger } from "fastify";
import type { JobRepository } from "../jobs/jobRepository.js";
import type { UsageService } from "../services/usageService.js";
import { buildDigest, cleanupTempCache } from "./autopilot.js";
import { runPlaybooks, setGatewayBypass } from "./playbooks.js";
import { runStandingPlans } from "./planner.js";
import { autonomyBudgetStatus, hasAutonomySpendLimit, recordBudgetFindings } from "./autonomyBudget.js";
import { effectiveAutonomy } from "./autonomy.js";

const MINUTE = 60_000;
const RETENTION = 7 * 24 * 60 * MINUTE;
const MONITORED = ["job_stalled", "job_overdue", "account_attention", "topics_low", "disk_low", "worker_idle", "quota_wait", "slot_at_risk", "resource_starved"] as const;
const ALERTS: Partial<Record<(typeof MONITORED)[number], string>> = {
  job_stalled: "Một job vượt thời gian chạy dự kiến.",
  account_attention: "Một tài khoản nền tảng cần kiểm tra kết nối.",
  disk_low: "Dung lượng trống không đủ cho kế hoạch render.",
};
type Finding = {
  kind: (typeof MONITORED)[number] | "restarted" | "goal_behind" | "gateway_unhealthy" | "llm_failover_storm";
  key: string;
  profileId?: string | null;
  severity: "info" | "warn" | "critical";
  detail: Record<string, unknown>;
};

type SupervisorOptions = {
  repository: JobRepository;
  usage: UsageService;
  stageTimeoutMs: number;
  logger: FastifyBaseLogger;
  now?: () => Date;
  diskFreeBytes?: () => number;
  tempRoot?: string;
  gatewayHealthy?: () => boolean;
  /** TASK-127: LLM failovers in the last 10 minutes (more than 10 raises llm_failover_storm). */
  llmFailovers?: () => number;
  worker?: {
    readySince: (now: Date) => string | null;
    lastClaimAt: () => string | null;
    nudge: () => void;
  };
  /** TASK-129b: classes whose jobs waited over 15 minutes while every slot was taken. */
  governor?: { starved: (now: Date) => { class: string; waiting: number; oldestWaitMs: number; limit: number; running: number }[] };
  notify?: (finding: { id: string; profileId: string | null; message: string }) => void;
  suggestTopics?: (profileId: string) => void;
  summarize?: (facts: string) => Promise<string | null>;
};

export function listSupervisorState(db: Database.Database, profileId?: string) {
  const heartbeat = db.prepare(`SELECT observed_at AS observedAt, running_jobs AS runningJobs,
    queued_jobs AS queuedJobs, finding_count AS findingCount
    FROM supervisor_heartbeats ORDER BY observed_at DESC, id DESC LIMIT 1`).get() as
    { observedAt: string; runningJobs: number; queuedJobs: number; findingCount: number } | undefined;
  const rows = db.prepare(`SELECT id, profile_id AS profileId, kind, severity, detail, first_seen_at AS firstSeenAt,
    last_seen_at AS lastSeenAt, status, resolution FROM supervisor_findings
    WHERE (? IS NULL OR profile_id = ?) AND status != 'resolved'
    ORDER BY last_seen_at DESC, id DESC LIMIT 30`).all(profileId ?? null, profileId ?? null) as {
    id: string; profileId: string | null; kind: string; severity: string; detail: string;
    firstSeenAt: string; lastSeenAt: string; status: string; resolution: string | null;
  }[];
  return { heartbeat: heartbeat ?? null, findings: rows.map(({ detail, ...row }) => ({ ...row, detail: JSON.parse(detail) as unknown })) };
}

export class AutonomySupervisor {
  private timer: NodeJS.Timeout | undefined;
  private readonly db: Database.Database;
  private readonly now: () => Date;

  constructor(private readonly options: SupervisorOptions) {
    this.db = options.repository.sqlite;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.safePass();
    this.timer = setInterval(() => this.safePass(), 2 * MINUTE);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  recordStartup(recoverSchedules?: (lastHeartbeatAt: string, now: Date) => unknown): void {
    const now = this.now();
    const previous = this.db.prepare("SELECT MAX(observed_at) AS at FROM supervisor_heartbeats").get() as { at: string | null };
    const recoverable = this.options.repository.getRunningJobs().filter((job) => job.projectId !== PROTECTED_PROJECT_ID).length;
    if (previous.at || recoverable) {
      this.saveFinding({
        kind: "restarted", key: now.toISOString(), severity: "info",
        detail: { previousHeartbeatAt: previous.at, recoveredJobs: recoverable,
          ...(previous.at && recoverSchedules ? { schedules: recoverSchedules(previous.at, now) } : {}) },
      }, now.toISOString());
    }
  }

  runPass(): void {
    const now = this.now();
    const at = now.toISOString();
    const profiles = this.db.prepare("SELECT id, automation FROM profiles WHERE archived_at IS NULL")
      .all() as { id: string; automation: string | null }[];
    const active = new Set(profiles.filter(({ id }) => {
      const { level } = effectiveAutonomy(this.db, { profileId: id });
      return level === "supervised" || level === "autonomous";
    }).map(({ id }) => id));
    const detected: Finding[] = [];
    const running = this.options.repository.getRunningJobs().filter((job) => job.projectId !== PROTECTED_PROJECT_ID);
    for (const job of running) {
      if (!job.startedAt) continue;
      const project = this.options.repository.getProject(job.projectId);
      if (!project?.profileId || !active.has(project.profileId) || project.archivedAt) continue;
      const timeoutMs = resolveStageTimeoutMs(
        { ...timeoutBriefFromSettings(project.settings, project.topic), stageTimeouts: project.settings.stageTimeouts },
        job.stage, this.options.stageTimeoutMs,
      );
      const mark = this.db.prepare("SELECT overdue_at, overdue_state FROM jobs WHERE id = ?").get(job.id) as
        { overdue_at: string | null; overdue_state: string | null } | undefined;
      if (mark?.overdue_at) {
        // TASK-125: an overdue stage is watched through its checks, not through the clock.
        const last = lastOverdueCheck(this.db, job.id);
        const queuedBehind = (this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'QUEUED' AND stage = ?").get(job.stage) as { n: number }).n;
        const waitingSince = mark.overdue_state === "waiting_decision"
          ? (this.db.prepare("SELECT MIN(at) AS at FROM stage_overdue_checks WHERE job_id = ? AND attempt = ? AND action = 'escalate' AND at >= COALESCE((SELECT MAX(at) FROM stage_overdue_checks WHERE job_id = ? AND attempt = ? AND action = 'wait'), '')", ).get(job.id, job.attempt, job.id, job.attempt) as { at: string | null }).at
          : null;
        const noDecision = waitingSince !== null && now.getTime() - Date.parse(waitingSince) >= OVERDUE_NOTICE_AFTER_MS;
        detected.push({
          kind: "job_overdue", key: `${job.id}:${job.attempt}`, profileId: project.profileId, severity: noDecision ? "critical" : "warn",
          detail: { jobId: job.id, projectId: job.projectId, stage: job.stage, state: mark.overdue_state, overdueAt: mark.overdue_at,
            lastCheck: last ? { at: last.at, action: last.action, reason: last.reason, source: last.source } : null, queuedBehind },
        });
        // No check for 2 x the check interval: the checker itself is stuck.
        if (last && now.getTime() - Date.parse(last.at) > 2 * overdueCheckSpacingMs(last.checkNo)) detected.push({
          kind: "job_stalled", key: `${job.id}:${job.attempt}`, profileId: project.profileId, severity: "critical",
          detail: { jobId: job.id, projectId: job.projectId, stage: job.stage, startedAt: job.startedAt, timeoutMs, lastCheckAt: last.at },
        });
      } else if (now.getTime() - Date.parse(job.startedAt) > timeoutMs * 1.5) detected.push({
        kind: "job_stalled", key: `${job.id}:${job.attempt}`, profileId: project.profileId, severity: "critical",
        detail: { jobId: job.id, projectId: job.projectId, stage: job.stage, startedAt: job.startedAt, timeoutMs },
      });
    }
    const accounts = this.db.prepare(`SELECT a.id, a.profile_id, a.platform, a.connection, c.expires_at
      FROM platform_accounts a LEFT JOIN platform_credentials c ON c.account_id = a.id WHERE a.enabled = 1`)
      .all() as { id: string; profile_id: string; platform: string; connection: string; expires_at: string | null }[];
    const expiryHorizon = new Date(now.getTime() + 48 * 60 * MINUTE).toISOString();
    for (const account of accounts) {
      if (!active.has(account.profile_id)) continue;
      // YouTube access tokens are routinely short-lived and refreshed by the publisher.
      const expiring = account.platform !== "youtube" && account.expires_at && account.expires_at <= expiryHorizon;
      if (expiring || ["ERROR", "NOT_CONNECTED", "EXPIRED"].includes(account.connection)) detected.push({
        kind: "account_attention", key: account.id, profileId: account.profile_id, severity: "warn",
        detail: { accountId: account.id, platform: account.platform, connection: account.connection, expiresAt: account.expires_at,
          ...(account.platform === "youtube" ? { note: "Ứng dụng YouTube ở chế độ Testing có thể cần kết nối lại sau 7 ngày." } : {}) },
      });
    }
    for (const profile of profiles) {
      if (!active.has(profile.id) || !profile.automation) continue;
      const automation = ProfileAutomationSchema.safeParse(JSON.parse(profile.automation));
      if (!automation.success || !automation.data.enabled) continue;
      const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM profile_topics WHERE profile_id = ? AND status = 'APPROVED'")
        .get(profile.id) as { count: number };
      const target = automation.data.videosPerDay * 3;
      if (count < target) detected.push({ kind: "topics_low", key: profile.id, profileId: profile.id, severity: "warn",
        detail: { approvedTopics: count, target } });
      const leadMs = automation.data.leadTimeHours * 60 * MINUTE;
      const horizon = now.getTime() + leadMs;
      const ready = this.db.prepare(`SELECT 1 FROM profile_topics t JOIN projects p ON p.id = t.project_id
        JOIN renders r ON r.project_id = p.id WHERE t.profile_id = ? AND t.scheduled_for = ?
          AND p.profile_id = ? AND p.id <> ? AND p.archived_at IS NULL AND r.status = 'DONE' AND r.deleted_at IS NULL LIMIT 1`);
      let slots: ReturnType<typeof enumerateSlots>;
      try {
        slots = enumerateSlots(now, automation.data, Math.ceil(leadMs / (24 * 60 * MINUTE)) + 1);
      } catch (error) {
        this.options.logger.warn({ err: error, profileId: profile.id }, "Supervisor could not enumerate publish slots");
        continue;
      }
      for (const slot of slots) {
        if (slot.at.getTime() < now.getTime() || slot.at.getTime() > horizon) continue;
        const publishAt = slot.at.toISOString();
        if (!ready.get(profile.id, publishAt, profile.id, PROTECTED_PROJECT_ID)) detected.push({
          kind: "slot_at_risk", key: `${profile.id}:${publishAt}`, profileId: profile.id, severity: "warn",
          detail: { publishAt, localDate: slot.localDate, timezone: automation.data.timezone },
        });
      }
    }
    const quotaWaits = this.db.prepare(`SELECT j.id, j.project_id, j.stage, j.run_after, p.profile_id
      FROM jobs j JOIN projects p ON p.id = j.project_id
      WHERE j.status = 'QUEUED' AND p.archived_at IS NULL AND j.project_id <> ?
        AND j.run_after > ? AND json_extract(j.error, '$.code') = 'LLM_QUOTA_WAIT'`)
      .all(PROTECTED_PROJECT_ID, at) as { id: string; project_id: string; stage: string; run_after: string; profile_id: string }[];
    for (const job of quotaWaits) {
      if (!active.has(job.profile_id)) continue;
      detected.push({ kind: "quota_wait", key: job.id, profileId: job.profile_id, severity: "warn",
        detail: { jobId: job.id, projectId: job.project_id, stage: job.stage, retryAt: job.run_after } });
    }
    const cooldowns = this.db.prepare("SELECT provider, model, until FROM llm_cooldowns WHERE until > ?")
      .all(at) as { provider: string; model: string; until: string }[];
    for (const row of cooldowns) detected.push({
      kind: "quota_wait", key: JSON.stringify([row.provider, row.model]), severity: "warn",
      detail: { provider: row.provider, model: row.model, retryAt: row.until },
    });
    let diskObserved = false;
    if (this.options.diskFreeBytes) {
      try {
        const freeBytes = this.options.diskFreeBytes();
        const { average } = this.db.prepare("SELECT AVG(size_bytes) AS average FROM renders WHERE status = 'DONE' AND deleted_at IS NULL")
          .get() as { average: number | null };
        diskObserved = true;
        const requiredBytes = Math.max(5 * 1024 ** 3, 2 * (average ?? 0));
        if (freeBytes < requiredBytes) detected.push({
          kind: "disk_low", key: "app", severity: "critical", detail: { freeBytes, requiredBytes },
        });
      } catch (error) {
        this.options.logger.warn({ err: error }, "Supervisor could not check disk space");
      }
    }
    try {
      const goals = this.db.prepare("SELECT profile_id, spec FROM operator_goals WHERE status = 'active'").all() as Array<{ profile_id: string | null; spec: string }>;
      for (const goal of goals) {
        if (!goal.profile_id || !active.has(goal.profile_id)) continue;
        const spec = JSON.parse(goal.spec) as { videosPerDay?: number };
        const planned = (spec.videosPerDay ?? 1) * 7;
        const published = (this.db.prepare(`SELECT COUNT(*) AS n FROM publications p
          JOIN projects j ON j.id = p.project_id WHERE j.profile_id = ? AND p.status = 'PUBLISHED'`).get(goal.profile_id) as { n: number }).n;
        if (published < planned - 1) detected.push({
          kind: "goal_behind", key: goal.profile_id, profileId: goal.profile_id, severity: "warn",
          detail: { published, planned },
        });
      }
    } catch {
      // The goals table arrives with the TASK-059 migration.
    }
    const gateway = this.options.gatewayHealthy;
    if (gateway && !gateway()) {
      detected.push({ kind: "gateway_unhealthy", key: "app", severity: "warn", detail: { route: "direct" } });
    } else if (gateway?.()) {
      try { setGatewayBypass(this.db, false, at); } catch { /* settings table is created with the app */ }
    }
    const failovers = this.options.llmFailovers?.() ?? 0;
    if (failovers > 10) {
      detected.push({ kind: "llm_failover_storm", key: "app", severity: "warn", detail: { failovers, windowMinutes: 10 } });
    }
    const worker = this.options.worker;
    if (worker) {
      const readySince = worker.readySince(now);
      const lastClaimAt = worker.lastClaimAt();
      if (readySince && now.getTime() - Math.max(Date.parse(readySince), lastClaimAt ? Date.parse(lastClaimAt) : 0) >= 10 * MINUTE) {
        detected.push({ kind: "worker_idle", key: "app", severity: "warn", detail: { readySince, lastClaimAt } });
      }
    }
    for (const item of this.options.governor?.starved(now) ?? []) {
      detected.push({
        kind: "resource_starved", key: item.class, severity: "warn",
        detail: {
          class: item.class, waiting: item.waiting, oldestWaitMin: Math.round(item.oldestWaitMs / MINUTE), limit: item.limit, running: item.running,
          hint: "Việc chờ hơn 15 phút vì hết chỗ chạy. Thêm một máy worker, thêm một scout, hoặc nâng mức tối đa ở Cài đặt → Tài nguyên.",
        },
      });
    }
    const queued = this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'QUEUED' AND project_id <> ?")
      .get(PROTECTED_PROJECT_ID) as { count: number };
    let nudge = false;
    const notifications: { id: string; profileId: string | null; message: string }[] = [];
    this.db.transaction(() => {
      const seen = new Set<string>();
      for (const finding of detected) {
        const prior = this.db.prepare("SELECT status, last_seen_at FROM supervisor_findings WHERE dedupe_key = ?")
          .get(`${finding.kind}:${finding.key}`) as { status: string; last_seen_at: string } | undefined;
        const key = this.saveFinding(finding, at);
        seen.add(key);
        const label = finding.kind in ALERTS ? ALERTS[finding.kind as keyof typeof ALERTS] : undefined;
        if (label && (!prior || prior.status === "resolved")) {
          notifications.push({ id: `${key}:${at}`, profileId: finding.profileId ?? null, message: label });
        }
        if (finding.kind === "worker_idle") {
          const claimed = this.db.prepare("UPDATE supervisor_findings SET status = 'healing' WHERE dedupe_key = ? AND status = 'open'")
            .run(key).changes;
          nudge ||= claimed > 0;
          if (prior?.status === "healing" && prior.last_seen_at < at) {
            this.db.prepare("UPDATE supervisor_findings SET status = 'escalated', severity = 'critical' WHERE dedupe_key = ?")
              .run(key);
            notifications.push({ id: `${key}:${at}`, profileId: null, message: "Worker chưa nhận job sau khi được đánh thức." });
          }
        }
      }
      const existing = this.db.prepare(`SELECT dedupe_key, kind FROM supervisor_findings
        WHERE kind IN (${MONITORED.map(() => "?").join(",")}) AND status != 'resolved'`)
        .all(...MONITORED) as { dedupe_key: string; kind: Finding["kind"] }[];
      const resolve = this.db.prepare("UPDATE supervisor_findings SET status = 'resolved', resolution = ? WHERE dedupe_key = ?");
      for (const finding of existing) {
        if (!seen.has(finding.dedupe_key) && !(finding.kind === "disk_low" && !diskObserved)) {
          resolve.run("Không còn phát hiện điều kiện cảnh báo.", finding.dedupe_key);
        }
      }
      this.db.prepare("INSERT INTO supervisor_heartbeats (observed_at, running_jobs, queued_jobs, finding_count) VALUES (?, ?, ?, ?)")
        .run(at, running.length, queued.count, detected.length);
      this.db.prepare("DELETE FROM supervisor_heartbeats WHERE observed_at < ?")
        .run(new Date(now.getTime() - RETENTION).toISOString());
    }).immediate();
    if (this.options.tempRoot && detected.some((finding) => finding.kind === "disk_low")) {
      cleanupTempCache(this.options.tempRoot, now);
    }
    if (nudge) worker?.nudge();
    try {
      runPlaybooks(this.db, detected, { now: at, suggestTopics: this.options.suggestTopics });
    } catch (error) {
      this.options.logger.warn({ err: error }, "Supervisor playbook failed");
    }
    try {
      const plans = runStandingPlans(this.db, now);
      if (plans.digest) {
        const digest = buildDigest(this.db, () => now);
        const fallback = `Bản tin ${digest.day}: ${digest.requests.length} việc cần bạn, ${digest.goals.length} mục tiêu.`;
        const summarize = this.options.summarize;
        if (summarize) {
          void summarize(fallback).then((line) => {
            this.options.notify?.({ id: `digest:${digest.day}`, profileId: null, message: line || fallback });
          }).catch(() => {
            this.options.notify?.({ id: `digest:${digest.day}`, profileId: null, message: fallback });
          });
        } else {
          this.options.notify?.({ id: `digest:${digest.day}`, profileId: null, message: fallback });
        }
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "Standing plan failed");
    }
    for (const finding of notifications) this.options.notify?.(finding);
    for (const profileId of [undefined, ...active]) {
      if (!hasAutonomySpendLimit(this.db, profileId)) continue;
      const status = autonomyBudgetStatus(this.db, this.options.usage, profileId, now);
      for (const finding of recordBudgetFindings(this.db, status, now)) this.options.notify?.(finding);
    }
  }

  private safePass(): void {
    try { this.runPass(); } catch (error) { this.options.logger.error({ err: error }, "Autonomy supervisor pass failed"); }
  }

  private saveFinding(finding: Finding, at: string): string {
    const key = `${finding.kind}:${finding.key}`;
    this.db.prepare(`INSERT INTO supervisor_findings
      (id, profile_id, kind, severity, dedupe_key, detail, first_seen_at, last_seen_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open') ON CONFLICT(dedupe_key) DO UPDATE SET
      detail = excluded.detail, severity = CASE WHEN status = 'escalated' THEN severity ELSE excluded.severity END,
      last_seen_at = excluded.last_seen_at,
      first_seen_at = CASE WHEN status = 'resolved' THEN excluded.first_seen_at ELSE first_seen_at END,
      status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
      resolution = CASE WHEN status IN ('healing', 'escalated') THEN resolution ELSE NULL END`)
      .run(randomUUID(), finding.profileId ?? null, finding.kind, finding.severity, key, JSON.stringify(finding.detail), at, at);
    return key;
  }
}
