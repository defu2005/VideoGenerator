import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  NOT_ENOUGH_LEARNING_DATA,
  PerformanceInsightOutputSchema,
  ProfileAutomationSchema,
  ProfileDefaultBriefSchema,
  ProfileInsightSchema,
  TITLE_AB_UNAVAILABLE_REASON,
  YOUTUBE_FULL_SCOPE,
  resolveBudget,
  type InsightApplyField,
  type InsightPattern,
  type InsightRecommendations,
  type InsightRunResult,
  type LearningMode,
  type LearningView,
  type NotificationEvent,
  type ProfileInsight,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";
import { LlmCache } from "../providers/llm/cache.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { writeAutomationLog } from "../services/automationService.js";
import {
  computeInsightStats,
  extremes,
  isWeeklyInsightDue,
  limitSummaryBullets,
  MIN_NEW_SCORED,
  MIN_SCORED_VIDEOS,
  scoredRows,
  shouldSwitchTitle,
  validateRecommendations,
  viewsPerHour,
  type FeatureRow,
  type InsightStats,
} from "./features.js";
import { loadFeatureRows } from "./loadRows.js";

const HOUR_MS = 60 * 60 * 1000;
const MANUAL_COOLDOWN_MS = HOUR_MS;

type StoredInsight = {
  summary: string;
  patterns: InsightPattern[];
  recommendations: InsightRecommendations;
  appliedFields: InsightApplyField[];
  dismissedFields: InsightApplyField[];
  publicationIds: string[];
  trigger: "manual" | "weekly";
  stats: InsightStats;
};

type ProfileLearningRow = {
  id: string;
  name: string;
  direction: string;
  language: string;
  learning_mode: string;
  learned_notes: string;
  learned_hints: string | { topicAngles?: string[]; avoid?: string[] } | null;
  title_ab_test: number | boolean;
  learning_undo: string | Record<string, unknown> | null;
  default_brief: string;
  automation: string | null;
  llm: string | null;
  archived_at: string | null;
};

type InsightTableRow = {
  id: string;
  profile_id: string;
  created_at: string;
  period: string;
  json: string | StoredInsight;
  status: string;
};

export type LearningServiceDeps = {
  sqlite: Database.Database;
  llm: LlmProviderRegistry;
  notifications?: { notify: (event: NotificationEvent) => Promise<void> };
  updateYoutubeTitle?: (input: {
    accountId: string;
    videoId: string;
    title: string;
    signal?: AbortSignal;
  }) => Promise<void>;
  now?: () => Date;
  logger?: { warn: (obj: unknown, msg?: string) => void };
};

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hintsOf(raw: ProfileLearningRow["learned_hints"]): { topicAngles: string[]; avoid: string[] } {
  const parsed = parseJson<{ topicAngles?: unknown; avoid?: unknown }>(raw) ?? {};
  const strings = (value: unknown) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  return { topicAngles: strings(parsed.topicAngles), avoid: strings(parsed.avoid) };
}

export class LearningService {
  private readonly now: () => Date;

  constructor(private readonly deps: LearningServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  getView(profileId: string): LearningView {
    const profile = this.requireProfile(profileId);
    const rows = loadFeatureRows(this.deps.sqlite, profileId);
    const scored = scoredRows(rows);
    const insights = this.listInsights(profileId);
    const available = this.youtubeFullScope(profileId);
    return {
      learningMode: this.modeOf(profile),
      learnedNotes: profile.learned_notes ?? "",
      titleAbTest: Boolean(profile.title_ab_test),
      titleAbAvailable: available,
      titleAbReason: available ? null : TITLE_AB_UNAVAILABLE_REASON,
      scoredCount: scored.length,
      insufficient: scored.length < MIN_SCORED_VIDEOS,
      message: scored.length < MIN_SCORED_VIDEOS ? NOT_ENOUGH_LEARNING_DATA : null,
      canUndo: Boolean(profile.learning_undo),
      latest: insights[0] ?? null,
      history: insights,
    };
  }

  saveSettings(profileId: string, input: { learningMode?: LearningMode; titleAbTest?: boolean }): LearningView {
    const profile = this.requireProfile(profileId);
    if (input.titleAbTest === true && !this.youtubeFullScope(profileId)) {
      throw new AppError(400, "TITLE_AB_SCOPE", TITLE_AB_UNAVAILABLE_REASON);
    }
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [this.now().toISOString()];
    if (input.learningMode) {
      sets.push("learning_mode = ?");
      params.push(input.learningMode);
    }
    if (input.titleAbTest !== undefined) {
      sets.push("title_ab_test = ?");
      params.push(input.titleAbTest ? 1 : 0);
    }
    params.push(profile.id);
    this.deps.sqlite.prepare(`UPDATE profiles SET ${sets.join(", ")} WHERE id = ?`).run(...params);
    return this.getView(profileId);
  }

  async run(profileId: string, trigger: "manual" | "weekly", signal?: AbortSignal): Promise<InsightRunResult> {
    const profile = this.requireProfile(profileId);
    const mode = this.modeOf(profile);
    if (mode === "off") {
      return { status: "skipped", message: "Hồ sơ đang tắt bài học.", insight: null };
    }
    if (trigger === "manual") this.assertManualRate(profileId);
    const budget = this.budgetOf(profile);
    const features = resolveBudget({
      mode: budget.mode ?? "BALANCED",
      features: budget.features as never,
    });
    if (!features.performanceInsight) {
      return { status: "skipped", message: "Chế độ ngân sách đang tắt bài học hiệu suất.", insight: null };
    }
    const rows = loadFeatureRows(this.deps.sqlite, profileId);
    const scored = scoredRows(rows);
    if (scored.length < MIN_SCORED_VIDEOS) {
      return { status: "insufficient", message: NOT_ENOUGH_LEARNING_DATA, insight: null };
    }
    const last = this.latestStored(profileId);
    if (trigger === "weekly") {
      const due = isWeeklyInsightDue({
        now: this.now(),
        timeZone: this.timeZoneOf(profile),
        lastInsightAt: last?.created_at ?? null,
        economy: budget.mode === "ECO",
      });
      if (!due) return { status: "skipped", message: null, insight: null };
      const previousIds = new Set(last ? this.stored(last).publicationIds : []);
      const fresh = scored.filter((row) => !previousIds.has(row.publicationId)).length;
      if (fresh < MIN_NEW_SCORED) return { status: "skipped", message: null, insight: null };
    }

    const stats = computeInsightStats(rows);
    const ends = extremes(scored);
    const titleTests = this.titleTestResults(profileId);
    const hints = hintsOf(profile.learned_hints);
    let generated: { summary: string; patterns: InsightPattern[]; recommendations: InsightRecommendations };
    try {
      generated = await this.callLlm(profile, budget, {
        direction: profile.direction,
        learnedNotes: profile.learned_notes,
        top: ends.top.map(compactRow),
        bottom: ends.bottom.map(compactRow),
        stats: {
          supportedHours: stats.supportedHours,
          hourBuckets: stats.hourBuckets,
          durationBuckets: stats.durationBuckets,
          topicClusters: stats.topicClusters,
          observedDuration: stats.observedDuration,
          overallMedian: stats.overallMedian,
        },
        titleTests,
        topicAngles: hints.topicAngles,
        avoid: hints.avoid,
      }, signal);
    } catch (error) {
      this.deps.logger?.warn({ err: error instanceof Error ? error.message : String(error) }, "performanceInsight failed");
      if (trigger === "weekly") {
        return { status: "skipped", message: "Không tạo được bài học.", insight: null };
      }
      throw new AppError(502, "INSIGHT_FAILED", "Không tạo được bài học từ số liệu.");
    }
    const recommendations = validateRecommendations(generated.recommendations, stats);
    const patterns = [...generated.patterns];
    for (const test of titleTests) {
      patterns.push({
        kind: "hook",
        finding: `Tiêu đề ${test.winner} thắng thử nghiệm A/B.`,
        evidence: `A: ${test.titleA}. B: ${test.titleB}.`,
        confidence: "medium",
      });
    }
    const period = this.periodOf(profile, scored);
    const stored: StoredInsight = {
      summary: limitSummaryBullets(generated.summary),
      patterns: patterns.slice(0, 12),
      recommendations,
      appliedFields: [],
      dismissedFields: [],
      publicationIds: scored.map((row) => row.publicationId),
      trigger,
      stats,
    };
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    this.deps.sqlite.prepare(
      `INSERT INTO profile_insights (id, profile_id, created_at, period, json, status)
       VALUES (?, ?, ?, ?, ?, 'new')`,
    ).run(id, profileId, createdAt, period, JSON.stringify(stored));

    if (mode === "auto") {
      const fields = this.autoFields(profileId, recommendations);
      if (fields.length > 0) {
        const insight = await this.apply(profileId, id, fields, { auto: true });
        return { status: "applied", message: null, insight };
      }
    }
    return { status: "stored", message: null, insight: this.toInsight(this.requireInsight(profileId, id)) };
  }

  async apply(
    profileId: string,
    insightId: string,
    fields: InsightApplyField[],
    options: { auto?: boolean } = {},
  ): Promise<ProfileInsight> {
    const profile = this.requireProfile(profileId);
    const row = this.requireInsight(profileId, insightId);
    if (row.status === "dismissed") {
      throw new AppError(409, "INSIGHT_DISMISSED", "Bài học này đã được bỏ qua.");
    }
    const stored = this.stored(row);
    const requested = [...new Set(fields)].filter((field) => this.fieldHasValue(field, stored.recommendations));
    if (requested.length === 0) {
      throw new AppError(400, "NOTHING_TO_APPLY", "Không có đề xuất nào để áp dụng.");
    }
    this.writeUndo(profile, insightId);
    const hints = hintsOf(profile.learned_hints);
    let learnedNotes = profile.learned_notes ?? "";
    let automation = ProfileAutomationSchema.parse(parseJson(profile.automation) ?? {});
    let brief = ProfileDefaultBriefSchema.parse(parseJson(profile.default_brief) ?? {});
    for (const field of requested) {
      if (field === "directionAddendum" && stored.recommendations.directionAddendum) {
        learnedNotes = stored.recommendations.directionAddendum.slice(0, 600);
      }
      if (field === "publishTimes" && stored.recommendations.publishTimes?.length) {
        automation = { ...automation, publishTimes: stored.recommendations.publishTimes };
      }
      if (field === "preferredDuration" && stored.recommendations.preferredDurationSec) {
        const range = stored.recommendations.preferredDurationSec;
        const mid = Math.round((range.min + range.max) / 2);
        brief = { ...brief, targetDurationSec: Math.min(1800, Math.max(30, mid)) };
      }
      if (field === "topicAngles" && stored.recommendations.topicAngles) {
        hints.topicAngles = stored.recommendations.topicAngles;
      }
      if (field === "avoid" && stored.recommendations.avoid) {
        hints.avoid = stored.recommendations.avoid;
      }
    }
    const applied = [...new Set([...stored.appliedFields, ...requested])];
    stored.appliedFields = applied;
    const nowIso = this.now().toISOString();
    this.deps.sqlite.prepare(
      `UPDATE profiles
       SET learned_notes = ?, learned_hints = ?, automation = ?, default_brief = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      learnedNotes,
      JSON.stringify(hints),
      JSON.stringify(automation),
      JSON.stringify(brief),
      nowIso,
      profileId,
    );
    this.deps.sqlite.prepare(
      `UPDATE profile_insights SET status = 'applied', json = ? WHERE id = ?`,
    ).run(JSON.stringify(stored), insightId);

    if (options.auto) {
      const message = `Đã cập nhật bài học cho hồ sơ ${profile.name}`;
      writeAutomationLog(this.deps.sqlite, {
        profileId,
        level: "info",
        message,
        data: { insightId, fields: requested },
        at: this.now(),
      });
      try {
        await this.deps.notifications?.notify({
          kind: "automation_warning",
          profileId,
          profile: profile.name,
          message,
        });
      } catch (error) {
        this.deps.logger?.warn({ err: error instanceof Error ? error.message : String(error) }, "insight notify failed");
      }
    }
    return this.toInsight(this.requireInsight(profileId, insightId));
  }

  dismiss(profileId: string, insightId: string, fields?: InsightApplyField[]): ProfileInsight {
    this.requireProfile(profileId);
    const row = this.requireInsight(profileId, insightId);
    const stored = this.stored(row);
    if (!fields || fields.length === 0) {
      this.deps.sqlite.prepare(
        `UPDATE profile_insights SET status = 'dismissed', json = ? WHERE id = ?`,
      ).run(JSON.stringify(stored), insightId);
      const updated = this.requireInsight(profileId, insightId);
      updated.status = "dismissed";
      return this.toInsight(updated);
    }
    stored.dismissedFields = [...new Set([...stored.dismissedFields, ...fields])];
    const keys = recommendationKeys(stored.recommendations);
    const allDismissed = keys.length > 0 && keys.every((key) => stored.dismissedFields.includes(key) || stored.appliedFields.includes(key))
      && stored.appliedFields.length === 0;
    const status = allDismissed ? "dismissed" : row.status;
    this.deps.sqlite.prepare(
      `UPDATE profile_insights SET status = ?, json = ? WHERE id = ?`,
    ).run(status, JSON.stringify(stored), insightId);
    return this.toInsight(this.requireInsight(profileId, insightId));
  }

  undo(profileId: string): LearningView {
    const profile = this.requireProfile(profileId);
    const undo = parseJson<{
      learnedNotes: string;
      publishTimes: string[];
      targetDurationSec: number;
      topicAngles: string[];
      avoid: string[];
    }>(profile.learning_undo);
    if (!undo) throw new AppError(404, "NOTHING_TO_UNDO", "Không có lần áp dụng nào để hoàn tác.");
    const automation = ProfileAutomationSchema.parse(parseJson(profile.automation) ?? {});
    const brief = ProfileDefaultBriefSchema.parse(parseJson(profile.default_brief) ?? {});
    automation.publishTimes = undo.publishTimes.length > 0 ? undo.publishTimes : automation.publishTimes;
    brief.targetDurationSec = undo.targetDurationSec;
    this.deps.sqlite.prepare(
      `UPDATE profiles
       SET learned_notes = ?, learned_hints = ?, automation = ?, default_brief = ?, learning_undo = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      undo.learnedNotes,
      JSON.stringify({ topicAngles: undo.topicAngles, avoid: undo.avoid }),
      JSON.stringify(automation),
      JSON.stringify(brief),
      this.now().toISOString(),
      profileId,
    );
    return this.getView(profileId);
  }

  async tick(signal?: AbortSignal): Promise<void> {
    const profiles = this.deps.sqlite.prepare(
      `SELECT id, learning_mode, archived_at, default_brief, automation
       FROM profiles WHERE archived_at IS NULL`,
    ).all() as Array<{
      id: string;
      learning_mode: string;
      default_brief: string;
      automation: string | null;
    }>;
    for (const profile of profiles) {
      if (signal?.aborted) return;
      if (profile.learning_mode === "off") continue;
      const budget = parseJson<{ mode?: string }>(profile.default_brief);
      const last = this.latestStored(profile.id);
      const zone = this.timeZoneOf({ automation: profile.automation } as ProfileLearningRow);
      if (!isWeeklyInsightDue({
        now: this.now(),
        timeZone: zone,
        lastInsightAt: last?.created_at ?? null,
        economy: budget?.mode === "ECO",
      })) continue;
      try {
        await this.run(profile.id, "weekly", signal);
      } catch (error) {
        this.deps.logger?.warn(
          { err: error instanceof Error ? error.message : String(error), profileId: profile.id },
          "Weekly insight failed",
        );
      }
    }
    await this.tickTitleTests(signal);
  }

  private async tickTitleTests(signal?: AbortSignal): Promise<void> {
    this.ensureTitleExperiments();
    const pending = this.deps.sqlite.prepare(
      `SELECT e.id, e.publication_id, e.profile_id, e.account_id, e.external_id, e.title_a, e.title_b, e.status,
              pub.published_at, pub.latest_metrics
       FROM title_experiments e
       JOIN publications pub ON pub.id = e.publication_id
       WHERE e.status = 'pending'`,
    ).all() as Array<{
      id: string;
      publication_id: string;
      profile_id: string;
      account_id: string;
      external_id: string;
      title_a: string;
      title_b: string;
      status: string;
      published_at: string | null;
      latest_metrics: string | null;
    }>;
    for (const row of pending) {
      if (signal?.aborted) return;
      if (!row.published_at) continue;
      const metrics = parseJson<{ views?: number | null }>(row.latest_metrics);
      const views = metrics?.views;
      if (views == null) continue;
      const ageMs = this.now().getTime() - Date.parse(row.published_at);
      const current = viewsPerHour(views, row.published_at, this.now());
      const median = this.profileMedianViewsPerHour(row.profile_id, row.publication_id);
      const decision = shouldSwitchTitle({
        ageMs,
        viewsPerHour: current,
        medianViewsPerHour: median,
        alreadyChecked: false,
      });
      if (decision === "wait") continue;
      if (decision === "switch") {
        if (!this.deps.updateYoutubeTitle) continue;
        try {
          await this.deps.updateYoutubeTitle({
            accountId: row.account_id,
            videoId: row.external_id,
            title: row.title_b,
            signal,
          });
        } catch (error) {
          this.deps.logger?.warn(
            { err: error instanceof Error ? error.message : String(error) },
            "Title B update failed",
          );
          continue;
        }
        this.finishExperiment(row.id, "switched", "B", current, median);
      } else {
        this.finishExperiment(row.id, "kept", "A", current, median);
      }
    }
  }

  private finishExperiment(
    id: string,
    status: "switched" | "kept",
    winner: "A" | "B",
    views: number,
    median: number | null,
  ): void {
    this.deps.sqlite.prepare(
      `UPDATE title_experiments
       SET status = ?, winner = ?, views_per_hour = ?, median_views_per_hour = ?, checked_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).run(status, winner, views, median, this.now().toISOString(), id);
  }

  private ensureTitleExperiments(): void {
    const rows = this.deps.sqlite.prepare(
      `SELECT pub.id, pub.project_id, pub.account_id, pub.external_id, a.profile_id
       FROM publications pub
       JOIN platform_accounts a ON a.id = pub.account_id
       JOIN profiles pf ON pf.id = a.profile_id
       WHERE pub.status = 'PUBLISHED' AND a.platform = 'youtube' AND pub.external_id IS NOT NULL
         AND pf.title_ab_test = 1
         AND NOT EXISTS (SELECT 1 FROM title_experiments e WHERE e.publication_id = pub.id)`,
    ).all() as Array<{
      id: string;
      project_id: string;
      account_id: string;
      external_id: string;
      profile_id: string;
    }>;
    for (const row of rows) {
      if (!this.youtubeFullScope(row.profile_id)) continue;
      const titles = this.metadataTitles(row.project_id);
      if (titles.length < 2) continue;
      this.deps.sqlite.prepare(
        `INSERT INTO title_experiments (
          id, publication_id, profile_id, account_id, external_id, title_a, title_b, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        randomUUID(),
        row.id,
        row.profile_id,
        row.account_id,
        row.external_id,
        titles[0],
        titles[1],
        this.now().toISOString(),
      );
    }
  }

  private metadataTitles(projectId: string): string[] {
    const row = this.deps.sqlite.prepare(
      "SELECT draft, edited FROM video_metadata WHERE project_id = ?",
    ).get(projectId) as { draft: string; edited: string | null } | undefined;
    if (!row) return [];
    const edited = parseJson<{ titles?: string[] }>(row.edited);
    const draft = parseJson<{ titles?: string[] }>(row.draft);
    const titles = (edited?.titles?.length ? edited.titles : draft?.titles) ?? [];
    return titles.map((title) => title.trim()).filter(Boolean);
  }

  private profileMedianViewsPerHour(profileId: string, exceptPublicationId: string): number | null {
    const rows = this.deps.sqlite.prepare(
      `SELECT pub.id, pub.published_at, pub.latest_metrics
       FROM publications pub
       JOIN platform_accounts a ON a.id = pub.account_id
       WHERE a.profile_id = ? AND pub.status = 'PUBLISHED' AND pub.id != ?
         AND pub.published_at IS NOT NULL`,
    ).all(profileId, exceptPublicationId) as Array<{
      published_at: string;
      latest_metrics: string | null;
    }>;
    const rates: number[] = [];
    for (const row of rows) {
      const views = parseJson<{ views?: number | null }>(row.latest_metrics)?.views;
      if (views == null) continue;
      rates.push(viewsPerHour(views, row.published_at, this.now()));
    }
    if (rates.length === 0) return null;
    rates.sort((a, b) => a - b);
    const mid = Math.floor(rates.length / 2);
    return rates.length % 2 === 1 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
  }

  private titleTestResults(profileId: string): Array<{ titleA: string; titleB: string; winner: string }> {
    return this.deps.sqlite.prepare(
      `SELECT title_a AS titleA, title_b AS titleB, winner
       FROM title_experiments
       WHERE profile_id = ? AND winner IS NOT NULL`,
    ).all(profileId) as Array<{ titleA: string; titleB: string; winner: string }>;
  }

  private async callLlm(
    profile: ProfileLearningRow,
    budget: { mode?: "ECO" | "BALANCED" | "QUALITY" | "MAX" | "CUSTOM"; features?: Record<string, unknown> },
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<{ summary: string; patterns: InsightPattern[]; recommendations: InsightRecommendations }> {
    const llmSettings = parseJson(profile.llm);
    const routeProject = {
      id: profile.id,
      mode: "AUTO" as const,
      settings: {
        language: profile.language,
        budget,
        ...(llmSettings ? { llm: llmSettings } : {}),
      },
    };
    const route = this.deps.llm.resolveTask("performanceInsight", routeProject as never, getAppLlmSettings(this.deps.sqlite));
    const cache = new LlmCache(this.deps.sqlite, true);
    const generated = await generateRoutedStructured({
      registry: this.deps.llm,
      route,
      task: "performanceInsight",
      system: [
        "Bạn rút bài học từ số liệu video đã đăng của một hồ sơ.",
        "summary là tiếng Việt, tối đa 5 gạch đầu dòng.",
        "publishTimes chỉ dùng giờ có dữ liệu, dạng HH:mm.",
        "directionAddendum tối đa 600 ký tự.",
        "Reply with JSON only.",
      ].join(" "),
      prompt: JSON.stringify(payload),
      schema: PerformanceInsightOutputSchema,
      schemaName: "PerformanceInsight",
      schemaVersion: "1",
      maxOutputTokens: route.maxOutputTokens ?? 2_048,
      signal: signal ?? AbortSignal.timeout(60_000),
      cache,
    });
    const parsed = PerformanceInsightOutputSchema.parse(generated.value);
    return {
      summary: parsed.summary,
      patterns: parsed.patterns,
      recommendations: parsed.recommendations,
    };
  }

  private autoFields(profileId: string, recommendations: InsightRecommendations): InsightApplyField[] {
    const fields: InsightApplyField[] = [];
    if (recommendations.directionAddendum) fields.push("directionAddendum");
    if (recommendations.topicAngles?.length) fields.push("topicAngles");
    if (recommendations.preferredDurationSec) fields.push("preferredDuration");
    if (recommendations.publishTimes?.length && this.autoPublishOn(profileId)) fields.push("publishTimes");
    return fields;
  }

  private autoPublishOn(profileId: string): boolean {
    const rows = this.deps.sqlite.prepare(
      `SELECT publish_settings FROM platform_accounts WHERE profile_id = ? AND enabled = 1`,
    ).all(profileId) as Array<{ publish_settings: string }>;
    return rows.some((row) => Boolean(parseJson<{ autoPublish?: boolean }>(row.publish_settings)?.autoPublish));
  }

  private writeUndo(profile: ProfileLearningRow, insightId: string): void {
    const automation = ProfileAutomationSchema.parse(parseJson(profile.automation) ?? {});
    const brief = ProfileDefaultBriefSchema.parse(parseJson(profile.default_brief) ?? {});
    const hints = hintsOf(profile.learned_hints);
    const undo = {
      learnedNotes: profile.learned_notes ?? "",
      publishTimes: automation.publishTimes,
      targetDurationSec: brief.targetDurationSec,
      topicAngles: hints.topicAngles,
      avoid: hints.avoid,
      insightId,
      at: this.now().toISOString(),
    };
    this.deps.sqlite.prepare(
      "UPDATE profiles SET learning_undo = ? WHERE id = ?",
    ).run(JSON.stringify(undo), profile.id);
  }

  private fieldHasValue(field: InsightApplyField, recommendations: InsightRecommendations): boolean {
    if (field === "directionAddendum") return Boolean(recommendations.directionAddendum);
    if (field === "preferredDuration") return Boolean(recommendations.preferredDurationSec);
    if (field === "publishTimes") return Boolean(recommendations.publishTimes?.length);
    if (field === "topicAngles") return Boolean(recommendations.topicAngles?.length);
    return Boolean(recommendations.avoid?.length);
  }

  private assertManualRate(profileId: string): void {
    const rows = this.deps.sqlite.prepare(
      `SELECT created_at, json FROM profile_insights WHERE profile_id = ? ORDER BY created_at DESC`,
    ).all(profileId) as Array<{ created_at: string; json: string }>;
    for (const row of rows) {
      const stored = parseJson<StoredInsight>(row.json);
      if (stored?.trigger !== "manual") continue;
      const at = Date.parse(row.created_at);
      if (this.now().getTime() - at < MANUAL_COOLDOWN_MS) {
        throw new AppError(429, "INSIGHT_RATE_LIMITED", "Chỉ phân tích thủ công một lần mỗi giờ.");
      }
      return;
    }
  }

  private periodOf(profile: ProfileLearningRow, rows: FeatureRow[]): string {
    const zone = this.timeZoneOf(profile);
    const pubs = this.deps.sqlite.prepare(
      `SELECT published_at FROM publications WHERE id = ?`,
    );
    const dates: string[] = [];
    for (const row of rows) {
      const found = pubs.get(row.publicationId) as { published_at: string } | undefined;
      if (!found?.published_at) continue;
      dates.push(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(found.published_at)));
    }
    dates.sort();
    if (dates.length === 0) return this.now().toISOString().slice(0, 10);
    return `${dates[0]}/${dates[dates.length - 1]}`;
  }

  private youtubeFullScope(profileId: string): boolean {
    const rows = this.deps.sqlite.prepare(
      `SELECT c.scopes FROM platform_accounts a
       LEFT JOIN platform_credentials c ON c.account_id = a.id
       WHERE a.profile_id = ? AND a.platform = 'youtube' AND a.enabled = 1`,
    ).all(profileId) as Array<{ scopes: string | null }>;
    return rows.some((row) => {
      const scopes = parseJson<string[]>(row.scopes) ?? [];
      return scopes.includes(YOUTUBE_FULL_SCOPE);
    });
  }

  private listInsights(profileId: string): ProfileInsight[] {
    const rows = this.deps.sqlite.prepare(
      `SELECT * FROM profile_insights WHERE profile_id = ? ORDER BY created_at DESC LIMIT 20`,
    ).all(profileId) as InsightTableRow[];
    return rows.map((row) => this.toInsight(row));
  }

  private latestStored(profileId: string): InsightTableRow | undefined {
    return this.deps.sqlite.prepare(
      `SELECT * FROM profile_insights WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).get(profileId) as InsightTableRow | undefined;
  }

  private requireInsight(profileId: string, insightId: string): InsightTableRow {
    const row = this.deps.sqlite.prepare(
      `SELECT * FROM profile_insights WHERE id = ? AND profile_id = ?`,
    ).get(insightId, profileId) as InsightTableRow | undefined;
    if (!row) throw new AppError(404, "INSIGHT_NOT_FOUND", "Không tìm thấy bài học.");
    return row;
  }

  private stored(row: InsightTableRow): StoredInsight {
    const parsed = parseJson<StoredInsight>(row.json);
    if (!parsed) throw new AppError(500, "INSIGHT_CORRUPT", "Bài học không đọc được.");
    parsed.appliedFields ??= [];
    parsed.dismissedFields ??= [];
    parsed.patterns ??= [];
    parsed.recommendations ??= {};
    parsed.publicationIds ??= [];
    return parsed;
  }

  private toInsight(row: InsightTableRow): ProfileInsight {
    const stored = this.stored(row);
    return ProfileInsightSchema.parse({
      id: row.id,
      profileId: row.profile_id,
      createdAt: row.created_at,
      period: row.period,
      status: row.status,
      summary: stored.summary,
      patterns: stored.patterns,
      recommendations: stored.recommendations,
      appliedFields: stored.appliedFields,
      dismissedFields: stored.dismissedFields,
    });
  }

  private requireProfile(profileId: string): ProfileLearningRow {
    const row = this.deps.sqlite.prepare("SELECT * FROM profiles WHERE id = ?").get(profileId) as ProfileLearningRow | undefined;
    if (!row || row.archived_at) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found");
    return row;
  }

  private modeOf(profile: ProfileLearningRow): LearningMode {
    if (profile.learning_mode === "off" || profile.learning_mode === "auto") return profile.learning_mode;
    return "suggest";
  }

  private budgetOf(profile: ProfileLearningRow): { mode?: "ECO" | "BALANCED" | "QUALITY" | "MAX" | "CUSTOM"; features?: Record<string, unknown> } {
    const brief = parseJson<{ budget?: { mode?: "ECO" | "BALANCED" | "QUALITY" | "MAX" | "CUSTOM"; features?: Record<string, unknown> } }>(profile.default_brief);
    return brief?.budget ?? { mode: "BALANCED" };
  }

  private timeZoneOf(profile: Pick<ProfileLearningRow, "automation">): string {
    const automation = parseJson<{ timezone?: string }>(profile.automation);
    return automation?.timezone?.trim() || "Asia/Ho_Chi_Minh";
  }
}

function compactRow(row: FeatureRow): {
  hook: string;
  title: string;
  durationSec: number | null;
  postingTime: string;
  score: number | null;
} {
  return {
    hook: row.hook,
    title: row.title,
    durationSec: row.durationSec,
    postingTime: row.postingTime,
    score: row.score,
  };
}

function recommendationKeys(recommendations: InsightRecommendations): InsightApplyField[] {
  const keys: InsightApplyField[] = [];
  if (recommendations.directionAddendum) keys.push("directionAddendum");
  if (recommendations.preferredDurationSec) keys.push("preferredDuration");
  if (recommendations.publishTimes?.length) keys.push("publishTimes");
  if (recommendations.topicAngles?.length) keys.push("topicAngles");
  if (recommendations.avoid?.length) keys.push("avoid");
  return keys;
}
