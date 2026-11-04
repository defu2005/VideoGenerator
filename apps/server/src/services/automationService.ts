import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import {
  AutomationLogEntrySchema,
  AutomationStatusSchema,
  DEFAULT_PROFILE_AUTOMATION,
  ProfileAutomationSchema,
  ProfileAutomationViewSchema,
  countFreeFutureSlots,
  enumerateSlots,
  localDateString,
  normalizeIso,
  pickNextFreePublishSlot,
  pickNextProductionSlot,
  type AutomationLogEntry,
  type AutomationLogLevel,
  type AutomationStatus,
  type ProfileAutomation,
  type ProfileAutomationView,
} from "@vg/shared";
import type { AppDatabase } from "../db/client.js";
import type { ProfileService } from "./profileService.js";
import type { ProjectService } from "./projectService.js";
import type { TopicService } from "./topicService.js";
import {
  countApprovedTopicsSync,
  countInProductionSync,
  countTopicSupplySync,
  listApprovedTopicsSync,
  listInProductionSync,
  listTopicsWithScheduleSync,
  updateTopicProductionSync,
} from "./topicService.js";
import { getAutomationPaused } from "./automationSettings.js";
import type { PipelineOrchestrator } from "../pipeline/orchestrator.js";
import type { PublishService } from "../publishing/publishService.js";
import type { RenderService } from "./renderService.js";

const LOG_RETENTION_DAYS = 30;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const PUBLISH_MIN_AHEAD_MS = 5 * 60 * 1000;

/** In-memory cooldown ends (ms); log is the source of truth across restarts. */
const cooldownUntilMs = new Map<string, number>();

type CooldownKind = "autoSuggest" | "noApprovedTopics";

function cooldownKey(profileId: string, kind: CooldownKind): string {
  return `${profileId}:${kind}`;
}

function lastCooldownLogAt(
  sqlite: Database.Database,
  profileId: string,
  kind: CooldownKind,
): number | null {
  const rows = sqlite.prepare(
    `SELECT at, data FROM automation_log WHERE profile_id = ? ORDER BY at DESC LIMIT 100`,
  ).all(profileId) as Array<{ at: string; data: string | null }>;
  for (const row of rows) {
    if (!row.data) continue;
    try {
      const parsed = JSON.parse(row.data) as { kind?: string };
      if (parsed.kind === kind) return Date.parse(row.at);
    } catch {
      // ignore malformed rows
    }
  }
  return null;
}

function inCooldown(
  sqlite: Database.Database,
  profileId: string,
  kind: CooldownKind,
  now: Date,
): boolean {
  const key = cooldownKey(profileId, kind);
  const mem = cooldownUntilMs.get(key);
  if (mem != null && now.getTime() < mem) return true;
  const last = lastCooldownLogAt(sqlite, profileId, kind);
  if (last == null || Number.isNaN(last)) return false;
  if (now.getTime() - last < COOLDOWN_MS) {
    cooldownUntilMs.set(key, last + COOLDOWN_MS);
    return true;
  }
  return false;
}

function markCooldown(profileId: string, kind: CooldownKind, now: Date): void {
  cooldownUntilMs.set(cooldownKey(profileId, kind), now.getTime() + COOLDOWN_MS);
}

type AutomationNotify = (event: {
  kind: "automation_warning";
  profileId?: string | null;
  profile: string;
  message: string;
  logId?: string;
}) => void;

let automationNotify: AutomationNotify | null = null;

/** Wire notification service after construction (avoids circular init). */
export function setAutomationNotify(handler: AutomationNotify | null): void {
  automationNotify = handler;
}

export function writeAutomationLog(
  sqlite: Database.Database,
  entry: {
    profileId?: string | null;
    level: AutomationLogLevel;
    message: string;
    data?: Record<string, unknown> | null;
    at?: Date;
  },
): void {
  const at = (entry.at ?? new Date()).toISOString();
  const id = randomUUID();
  sqlite.prepare(
    `INSERT INTO automation_log (id, profile_id, at, level, message, data) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.profileId ?? null,
    at,
    entry.level,
    entry.message,
    entry.data ? JSON.stringify(entry.data) : null,
  );
  pruneAutomationLog(sqlite, entry.at ?? new Date());
  if ((entry.level === "warn" || entry.level === "error") && automationNotify) {
    let profileName = entry.profileId ?? "app";
    if (entry.profileId) {
      const row = sqlite.prepare("SELECT name FROM profiles WHERE id = ?").get(entry.profileId) as
        | { name: string }
        | undefined;
      if (row) profileName = row.name;
    }
    try {
      automationNotify({
        kind: "automation_warning",
        profileId: entry.profileId ?? null,
        profile: profileName,
        message: entry.message,
        logId: id,
      });
    } catch {
      // never break automation for notifications
    }
  }
}

export function pruneAutomationLog(sqlite: Database.Database, now = new Date()): void {
  const cutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  sqlite.prepare(`DELETE FROM automation_log WHERE at < ?`).run(cutoff);
}

export function listAutomationLogSync(
  sqlite: Database.Database,
  opts: { profileId?: string; limit?: number; level?: AutomationLogLevel } = {},
): AutomationLogEntry[] {
  const limit = opts.limit ?? 50;
  let rows: Array<Record<string, unknown>>;
  if (opts.profileId && opts.level) {
    rows = sqlite.prepare(
      `SELECT * FROM automation_log WHERE profile_id = ? AND level = ? ORDER BY at DESC LIMIT ?`,
    ).all(opts.profileId, opts.level, limit) as Array<Record<string, unknown>>;
  } else if (opts.profileId) {
    rows = sqlite.prepare(
      `SELECT * FROM automation_log WHERE profile_id = ? ORDER BY at DESC LIMIT ?`,
    ).all(opts.profileId, limit) as Array<Record<string, unknown>>;
  } else if (opts.level) {
    rows = sqlite.prepare(
      `SELECT * FROM automation_log WHERE level = ? ORDER BY at DESC LIMIT ?`,
    ).all(opts.level, limit) as Array<Record<string, unknown>>;
  } else {
    rows = sqlite.prepare(
      `SELECT * FROM automation_log ORDER BY at DESC LIMIT ?`,
    ).all(limit) as Array<Record<string, unknown>>;
  }
  return rows.map((row) => AutomationLogEntrySchema.parse({
    id: row.id,
    profileId: row.profile_id ?? null,
    at: row.at,
    level: row.level,
    message: row.message,
    data: typeof row.data === "string" ? JSON.parse(row.data) as Record<string, unknown> : row.data ?? null,
  }));
}

function parseProfileAutomation(raw: unknown): ProfileAutomation {
  return ProfileAutomationSchema.parse(raw ?? DEFAULT_PROFILE_AUTOMATION);
}

function countProductionsStartedToday(
  sqlite: Database.Database,
  profileId: string,
  timezone: string,
  now: Date,
): number {
  const today = localDateString(now, timezone);
  const rows = sqlite.prepare(
    `SELECT p.created_at AS created_at
     FROM profile_topics t
     INNER JOIN projects p ON p.id = t.project_id
     WHERE t.profile_id = ? AND t.project_id IS NOT NULL`,
  ).all(profileId) as Array<{ created_at: string }>;
  return rows.filter((row) => localDateString(new Date(row.created_at), timezone) === today).length;
}

export function createAutomationService(deps: {
  db: AppDatabase;
  sqlite: Database.Database;
  profiles: ProfileService;
  projects: ProjectService;
  topics: TopicService;
  orchestrator: PipelineOrchestrator;
  publish: PublishService;
  render: RenderService;
  logger: FastifyBaseLogger;
  now?: () => Date;
}) {
  const nowFn = deps.now ?? (() => new Date());

  async function getProfileView(profileId: string): Promise<ProfileAutomationView> {
    const profile = await deps.profiles.getDetail(profileId);
    const automation = profile.automation;
    const now = nowFn();
    const assigned = listTopicsWithScheduleSync(deps.sqlite, profileId);
    const assignedByIso = new Map(
      assigned
        .filter((topic) => topic.scheduledFor)
        .map((topic) => [normalizeIso(topic.scheduledFor!), topic]),
    );
    const slots = enumerateSlots(now, automation, 7).map((slot) => {
      const topic = assignedByIso.get(normalizeIso(slot.at.toISOString())) ?? null;
      let publicationStatus: string | null = null;
      if (topic?.projectId) {
        const pub = deps.sqlite.prepare(
          `SELECT status FROM publications WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
        ).get(topic.projectId) as { status?: string } | undefined;
        publicationStatus = pub?.status ?? null;
      }
      return {
        publishAt: slot.at.toISOString(),
        localDate: slot.localDate,
        topic,
        productionStatus: topic?.status ?? null,
        publicationStatus,
      };
    });
    const logs = listAutomationLogSync(deps.sqlite, { profileId, limit: 30 });
    return ProfileAutomationViewSchema.parse({
      automation,
      slots,
      todayCount: countProductionsStartedToday(deps.sqlite, profileId, automation.timezone, now),
      approvedCount: countApprovedTopicsSync(deps.sqlite, profileId),
      logs,
    });
  }

  async function getStatus(): Promise<AutomationStatus> {
    const paused = getAutomationPaused(deps.sqlite);
    const list = await deps.profiles.listProfiles({ includeArchived: false });
    const now = nowFn();
    const profilesStatus = [];
    for (const item of list.items) {
      const detail = await deps.profiles.getDetail(item.id);
      const automation = detail.automation;
      const assigned = listTopicsWithScheduleSync(deps.sqlite, item.id)
        .map((topic) => topic.scheduledFor)
        .filter((iso): iso is string => Boolean(iso));
      const pick = automation.enabled
        ? pickNextProductionSlot({
          now,
          automation,
          assignedSlotIsos: assigned,
          productionsStartedToday: countProductionsStartedToday(
            deps.sqlite,
            item.id,
            automation.timezone,
            now,
          ),
        })
        : null;
      const inProd = listInProductionSync(deps.sqlite).find((topic) => topic.profileId === item.id) ?? null;
      const nextApproved = listApprovedTopicsSync(deps.sqlite, item.id)[0] ?? null;
      profilesStatus.push({
        profileId: item.id,
        profileName: item.name,
        enabled: automation.enabled,
        todayCount: countProductionsStartedToday(deps.sqlite, item.id, automation.timezone, now),
        approvedCount: countApprovedTopicsSync(deps.sqlite, item.id),
        nextSlot: pick?.slot.at.toISOString() ?? null,
        nextTopic: nextApproved?.topic ?? null,
        inProduction: inProd,
      });
    }
    return AutomationStatusSchema.parse({
      paused,
      profiles: profilesStatus,
      recentErrors: listAutomationLogSync(deps.sqlite, { level: "error", limit: 20 }),
    });
  }

  async function finishCompletedProductions(): Promise<void> {
    for (const topic of listInProductionSync(deps.sqlite)) {
      if (!topic.projectId) continue;
      const project = await deps.projects.getProject(topic.projectId);
      if (!project) {
        updateTopicProductionSync(deps.sqlite, topic.id, {
          status: "FAILED",
          error: "Project missing",
        });
        writeAutomationLog(deps.sqlite, {
          profileId: topic.profileId,
          level: "error",
          message: `Chủ đề thất bại: project không tồn tại`,
          data: { topicId: topic.id },
        });
        continue;
      }
      if (project.status === "FAILED") {
        updateTopicProductionSync(deps.sqlite, topic.id, {
          status: "FAILED",
          error: "Pipeline failed",
        });
        writeAutomationLog(deps.sqlite, {
          profileId: topic.profileId,
          level: "error",
          message: `Pipeline thất bại cho «${topic.topic}»`,
          data: { topicId: topic.id, projectId: topic.projectId },
        });
        continue;
      }

      const doneRender = deps.sqlite.prepare(
        `SELECT id FROM renders WHERE project_id = ? AND status = 'DONE' AND deleted_at IS NULL LIMIT 1`,
      ).get(topic.projectId) as { id?: string } | undefined;
      if (!doneRender?.id) continue;

      try {
        const profile = await deps.profiles.getDetail(topic.profileId);
        try {
          await deps.render.renderMissingVariants(project, new AbortController().signal);
        } catch (variantError) {
          // Main render already exists; missing timeline/variants should not block publish.
          writeAutomationLog(deps.sqlite, {
            profileId: topic.profileId,
            level: "warn",
            message: `Render variants bỏ qua: ${variantError instanceof Error ? variantError.message : String(variantError)}`,
            data: { topicId: topic.id, projectId: topic.projectId },
          });
        }

        const accounts = profile.accounts.filter((account) => {
          if (!account.enabled) return false;
          if (!account.publishSettings.autoPublish) return false;
          if (profile.automation.accountIds && profile.automation.accountIds.length > 0) {
            return profile.automation.accountIds.includes(account.id);
          }
          return true;
        }).filter((account) => account.connection === "CONNECTED");

        const now = nowFn();
        let scheduledFor = topic.scheduledFor;
        if (scheduledFor) {
          const slotMs = Date.parse(scheduledFor);
          if (!Number.isNaN(slotMs) && slotMs <= now.getTime() + PUBLISH_MIN_AHEAD_MS) {
            const assigned = listTopicsWithScheduleSync(deps.sqlite, topic.profileId)
              .filter((row) => row.id !== topic.id && row.scheduledFor)
              .map((row) => row.scheduledFor!);
            const next = pickNextFreePublishSlot({
              now,
              automation: profile.automation,
              assignedSlotIsos: assigned,
              minAheadMs: PUBLISH_MIN_AHEAD_MS,
            });
            if (next) {
              const oldSlot = scheduledFor;
              scheduledFor = next.at.toISOString();
              updateTopicProductionSync(deps.sqlite, topic.id, { scheduledFor });
              writeAutomationLog(deps.sqlite, {
                profileId: topic.profileId,
                level: "warn",
                message: `Dời lịch đăng «${topic.topic}» từ ${oldSlot} sang ${scheduledFor}`,
                data: { topicId: topic.id, oldSlot, newSlot: scheduledFor },
                at: now,
              });
            } else {
              // Never publish into the past / too-soon window.
              scheduledFor = null;
              writeAutomationLog(deps.sqlite, {
                profileId: topic.profileId,
                level: "warn",
                message: `Không tìm được slot đăng tương lai cho «${topic.topic}»`,
                data: { topicId: topic.id, oldSlot: topic.scheduledFor },
                at: now,
              });
            }
          }
        }

        if (accounts.length > 0 && scheduledFor) {
          await deps.publish.createForProject(topic.projectId, {
            accountIds: accounts.map((account) => account.id),
            scheduledFor,
          });
        }

        updateTopicProductionSync(deps.sqlite, topic.id, { status: "DONE", error: null });
        writeAutomationLog(deps.sqlite, {
          profileId: topic.profileId,
          level: "info",
          message: `Hoàn tất «${topic.topic}» — đã xếp lịch đăng`,
          data: {
            topicId: topic.id,
            projectId: topic.projectId,
            scheduledFor,
            accountCount: accounts.length,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateTopicProductionSync(deps.sqlite, topic.id, { status: "FAILED", error: message });
        writeAutomationLog(deps.sqlite, {
          profileId: topic.profileId,
          level: "error",
          message: `Lỗi sau render cho «${topic.topic}»: ${message}`,
          data: { topicId: topic.id, projectId: topic.projectId },
        });
      }
    }
  }

  async function startDueProductions(): Promise<void> {
    if (getAutomationPaused(deps.sqlite)) return;
    if (countInProductionSync(deps.sqlite) > 0) return; // one pipeline at a time

    const list = await deps.profiles.listProfiles({ includeArchived: false });
    const now = nowFn();

    for (const item of list.items) {
      if (countInProductionSync(deps.sqlite) > 0) return;
      const detail = await deps.profiles.getDetail(item.id);
      const automation = detail.automation;
      if (!automation.enabled) continue;

      const assigned = listTopicsWithScheduleSync(deps.sqlite, item.id)
        .map((topic) => topic.scheduledFor)
        .filter((iso): iso is string => Boolean(iso));
      const startedToday = countProductionsStartedToday(
        deps.sqlite,
        item.id,
        automation.timezone,
        now,
      );
      const pick = pickNextProductionSlot({
        now,
        automation,
        assignedSlotIsos: assigned,
        productionsStartedToday: startedToday,
      });
      if (!pick) continue;

      const nextTopic = listApprovedTopicsSync(deps.sqlite, item.id)[0];
      if (!nextTopic) {
        if (!inCooldown(deps.sqlite, item.id, "noApprovedTopics", now)) {
          writeAutomationLog(deps.sqlite, {
            profileId: item.id,
            level: "warn",
            message: "Có slot trống nhưng hết chủ đề APPROVED",
            data: { kind: "noApprovedTopics", slot: pick.slot.at.toISOString() },
            at: now,
          });
          markCooldown(item.id, "noApprovedTopics", now);
        }
        continue;
      }

      try {
        const project = await deps.projects.createProject({
          topic: nextTopic.topic,
          title: nextTopic.topic.slice(0, 120),
          profileId: item.id,
          mode: "AUTO",
          settings: { autoRender: true },
        });
        updateTopicProductionSync(deps.sqlite, nextTopic.id, {
          status: "IN_PRODUCTION",
          projectId: project.id,
          scheduledFor: pick.slot.at.toISOString(),
          error: null,
        });
        deps.orchestrator.runAll(project.id);
        writeAutomationLog(deps.sqlite, {
          profileId: item.id,
          level: "info",
          message: `Bắt đầu sản xuất «${nextTopic.topic}»`,
          data: {
            topicId: nextTopic.id,
            projectId: project.id,
            scheduledFor: pick.slot.at.toISOString(),
            rescheduled: pick.rescheduled,
          },
        });
        return; // one at a time globally
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateTopicProductionSync(deps.sqlite, nextTopic.id, {
          status: "FAILED",
          error: message,
        });
        writeAutomationLog(deps.sqlite, {
          profileId: item.id,
          level: "error",
          message: `Không tạo được project cho «${nextTopic.topic}»: ${message}`,
          data: { topicId: nextTopic.id },
        });
      }
    }
  }

  async function maybeAutoSuggest(): Promise<void> {
    if (getAutomationPaused(deps.sqlite)) return;
    const list = await deps.profiles.listProfiles({ includeArchived: false });
    const now = nowFn();
    for (const item of list.items) {
      const detail = await deps.profiles.getDetail(item.id);
      const automation = detail.automation;
      if (!automation.enabled || !automation.autoSuggest) continue;
      const assigned = listTopicsWithScheduleSync(deps.sqlite, item.id)
        .map((topic) => topic.scheduledFor)
        .filter((iso): iso is string => Boolean(iso));
      const free = countFreeFutureSlots({
        now,
        automation,
        assignedSlotIsos: assigned,
        days: 3,
      });
      // PENDING + APPROVED count as supply — stuck PENDING must not re-trigger LLM every minute.
      const supply = countTopicSupplySync(deps.sqlite, item.id);
      if (supply >= free) continue;
      if (inCooldown(deps.sqlite, item.id, "autoSuggest", now)) continue;
      const need = Math.max(1, Math.min(5, free - supply));
      try {
        const result = await deps.topics.suggestTopics(item.id, { count: need });
        writeAutomationLog(deps.sqlite, {
          profileId: item.id,
          level: "info",
          message: `Tự gợi ý ${result.items.length} chủ đề`,
          data: { kind: "autoSuggest", rejectedDuplicates: result.rejectedDuplicates },
          at: now,
        });
      } catch (error) {
        writeAutomationLog(deps.sqlite, {
          profileId: item.id,
          level: "warn",
          message: `Gợi ý chủ đề thất bại: ${error instanceof Error ? error.message : String(error)}`,
          data: { kind: "autoSuggest" },
          at: now,
        });
      }
      // Cooldown on success or failure so a flaky LLM cannot burn budget every tick.
      markCooldown(item.id, "autoSuggest", now);
    }
  }

  /** One automation pass — called from the publish ticker. */
  async function tick(): Promise<void> {
    try {
      await finishCompletedProductions();
      await startDueProductions();
      await maybeAutoSuggest();
    } catch (error) {
      deps.logger.warn({ err: error }, "Automation tick failed");
      writeAutomationLog(deps.sqlite, {
        level: "error",
        message: `Automation tick lỗi: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  function dashboardCard() {
    const paused = getAutomationPaused(deps.sqlite);
    const inProd = listInProductionSync(deps.sqlite)[0] ?? null;
    let runningProfileName: string | null = null;
    if (inProd) {
      const row = deps.sqlite.prepare(`SELECT name FROM profiles WHERE id = ?`).get(inProd.profileId) as
        | { name?: string }
        | undefined;
      runningProfileName = row?.name ?? null;
    }
    const statusSync = (() => {
      // Lightweight next production scan
      const rows = deps.sqlite.prepare(
        `SELECT id, name, automation FROM profiles WHERE archived_at IS NULL`,
      ).all() as Array<{ id: string; name: string; automation: string | ProfileAutomation | null }>;
      const now = nowFn();
      let nextProductionAt: string | null = null;
      let todayCount = 0;
      for (const row of rows) {
        const automation = parseProfileAutomation(
          typeof row.automation === "string" ? JSON.parse(row.automation) : row.automation,
        );
        todayCount += countProductionsStartedToday(deps.sqlite, row.id, automation.timezone, now);
        if (!automation.enabled) continue;
        const assigned = listTopicsWithScheduleSync(deps.sqlite, row.id)
          .map((topic) => topic.scheduledFor)
          .filter((iso): iso is string => Boolean(iso));
        const pick = pickNextProductionSlot({
          now,
          automation,
          assignedSlotIsos: assigned,
          productionsStartedToday: countProductionsStartedToday(
            deps.sqlite,
            row.id,
            automation.timezone,
            now,
          ),
        });
        if (pick) {
          const iso = pick.slot.at.toISOString();
          if (!nextProductionAt || iso < nextProductionAt) nextProductionAt = iso;
        }
      }
      return { nextProductionAt, todayCount };
    })();

    return {
      paused,
      runningProfileName,
      nextProductionAt: statusSync.nextProductionAt,
      todayCount: statusSync.todayCount,
      recentErrors: listAutomationLogSync(deps.sqlite, { level: "error", limit: 5 }),
    };
  }

  return {
    getProfileView,
    getStatus,
    tick,
    dashboardCard,
    writeLog: (entry: Parameters<typeof writeAutomationLog>[1]) => writeAutomationLog(deps.sqlite, entry),
  };
}

export type AutomationService = ReturnType<typeof createAutomationService>;
