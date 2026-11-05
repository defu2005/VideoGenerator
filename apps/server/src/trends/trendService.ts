import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  AddTrendTopicBodySchema,
  DEFAULT_PROFILE_TREND_SETTINGS,
  ProfileTopicSchema,
  ProfileTrendSettingsSchema,
  TrendMatchOutputSchema,
  acceptTrendIdeas,
  buildTrendMatchPrompt,
  directionCoversNews,
  directionKeywords,
  isSensitiveText,
  isTrendCacheFresh,
  keywordPrefilter,
  planTodaySlot,
  resolveBudget,
  trendTopicStatus,
  urgencyFromNotes,
  type ProfileTopic,
  type TrendIdea,
  type TrendItem,
  type TrendRefreshResponse,
} from "@vg/shared";
import { getProfilePromptContext, type ProfileService } from "../services/profileService.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { getAppLlmSettings } from "../providers/llm/settings.js";
import { generateRoutedStructured } from "../providers/llm/structured.js";
import { LlmCache } from "../providers/llm/cache.js";
import { writeAutomationLog } from "../services/automationService.js";
import type { TokenVault } from "../publishing/tokenVault.js";
import { AppError } from "../lib/errors.js";
import {
  YOUTUBE_API_KEY_SECRET,
  fetchRssFeed,
  fetchWikimediaTop,
  fetchYoutubePopular,
  type TrendHttp,
} from "./sources.js";

type CacheRow = { fetched_at: string; json: string };

export function createTrendService(deps: {
  sqlite: Database.Database;
  profiles: ProfileService;
  llm: LlmProviderRegistry;
  vault: TokenVault;
  fetchImpl?: TrendHttp;
  now?: () => Date;
}) {
  const fetchImpl: TrendHttp = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = deps.now ?? (() => new Date());

  function readCache(source: string, region: string, language: string, cacheKey: string): TrendItem[] | null {
    const row = deps.sqlite.prepare(
      `SELECT fetched_at, json FROM trend_cache
       WHERE source = ? AND region = ? AND language = ? AND cache_key = ?`,
    ).get(source, region, language, cacheKey) as CacheRow | undefined;
    if (!row || !isTrendCacheFresh(row.fetched_at, now())) return null;
    const parsed = JSON.parse(row.json) as TrendItem[];
    return Array.isArray(parsed) ? parsed : null;
  }

  function writeCache(source: string, region: string, language: string, cacheKey: string, items: TrendItem[]): void {
    deps.sqlite.prepare(
      `INSERT INTO trend_cache (source, region, language, cache_key, fetched_at, json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source, region, language, cache_key) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         json = excluded.json`,
    ).run(source, region, language, cacheKey, now().toISOString(), JSON.stringify(items));
  }

  async function loadSettings(profileId: string) {
    const profile = await deps.profiles.getDetail(profileId);
    const row = deps.sqlite.prepare(
      "SELECT trend_settings, learned_notes, learned_hints FROM profiles WHERE id = ?",
    ).get(profileId) as { trend_settings: string | null; learned_notes: string; learned_hints: string | null } | undefined;
    const settings = ProfileTrendSettingsSchema.parse(
      row?.trend_settings ? JSON.parse(row.trend_settings) : DEFAULT_PROFILE_TREND_SETTINGS,
    );
    return { profile, settings };
  }

  function youtubeAccess(profileId: string): { accessToken: string | null; apiKey: string | null } {
    const account = deps.sqlite.prepare(
      `SELECT id FROM platform_accounts
       WHERE profile_id = ? AND platform = 'youtube' AND connection = 'CONNECTED'
       ORDER BY created_at ASC LIMIT 1`,
    ).get(profileId) as { id: string } | undefined;
    const tokens = account ? deps.vault.loadTokens(account.id) : null;
    return {
      accessToken: tokens?.accessToken ?? null,
      apiKey: deps.vault.loadSecret(YOUTUBE_API_KEY_SECRET),
    };
  }

  async function collectItems(
    profileId: string,
    signal: AbortSignal,
  ): Promise<{ items: TrendItem[]; settingsLanguage: string; settingsRegion: string }> {
    const { settings } = await loadSettings(profileId);
    const region = settings.region;
    const language = settings.language;
    const items: TrendItem[] = [];

    if (settings.youtubePopular) {
      const cacheKey = settings.youtubeCategoryId || "";
      const cached = readCache("youtube_popular", region, language, cacheKey);
      if (cached) items.push(...cached);
      else {
        const auth = youtubeAccess(profileId);
        const fetched = await fetchYoutubePopular({
          region,
          categoryId: settings.youtubeCategoryId,
          accessToken: auth.accessToken,
          apiKey: auth.apiKey,
          fetchImpl,
          signal,
        });
        writeCache("youtube_popular", region, language, cacheKey, fetched);
        items.push(...fetched);
      }
    }

    if (settings.wikimediaTop) {
      const cached = readCache("wikimedia_top", region, language, "");
      if (cached) items.push(...cached);
      else {
        const fetched = await fetchWikimediaTop({
          language,
          metaPages: settings.metaPages,
          now: now(),
          fetchImpl,
          signal,
        });
        writeCache("wikimedia_top", region, language, "", fetched);
        items.push(...fetched);
      }
    }

    if (settings.rss) {
      for (const feedUrl of settings.feeds.slice(0, 20)) {
        const cached = readCache("rss", region, language, feedUrl);
        if (cached) {
          items.push(...cached);
          continue;
        }
        const fetched = await fetchRssFeed({ feedUrl, fetchImpl, signal });
        writeCache("rss", region, language, feedUrl, fetched);
        items.push(...fetched);
      }
    }

    return { items, settingsLanguage: language, settingsRegion: region };
  }

  function logSkip(profileId: string, title: string, reason: string): void {
    writeAutomationLog(deps.sqlite, {
      profileId,
      level: "warn",
      message: `Bỏ qua xu hướng nhạy cảm: ${title}`,
      data: { title, reason },
      at: now(),
    });
  }

  function storeIdeas(profileId: string, ideas: TrendIdea[]): void {
    deps.sqlite.prepare("DELETE FROM trend_ideas WHERE profile_id = ?").run(profileId);
    const insert = deps.sqlite.prepare(
      `INSERT INTO trend_ideas
        (id, profile_id, title, angle, why_now, source_titles, urgency, fit_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const at = now().toISOString();
    for (const idea of ideas) {
      insert.run(
        randomUUID(),
        profileId,
        idea.title,
        idea.angle,
        idea.whyNow,
        JSON.stringify(idea.sourceTitles),
        idea.urgency,
        Math.round(idea.fitScore),
        at,
      );
    }
  }

  async function refresh(profileId: string, signal: AbortSignal): Promise<TrendRefreshResponse> {
    const { profile } = await loadSettings(profileId);
    const { items } = await collectItems(profileId, signal);
    const promptContext = getProfilePromptContext(deps.sqlite, profileId);
    const coversNews = directionCoversNews(profile.direction);
    const skipped: TrendRefreshResponse["skipped"] = [];
    const allowed: TrendItem[] = [];
    for (const item of items) {
      if (!coversNews && isSensitiveText(item.title)) {
        skipped.push({ title: item.title, reason: "sensitive" });
        logSkip(profileId, item.title, "sensitive");
        continue;
      }
      allowed.push(item);
    }
    const keywords = directionKeywords({
      direction: profile.direction,
      learnedNotes: promptContext.learnedNotes,
      topicAngles: promptContext.topicAngles,
    });
    const filtered = keywordPrefilter(allowed, keywords);
    const features = resolveBudget(profile.defaultBrief.budget ?? { mode: "BALANCED" });
    let ideas: TrendIdea[] = [];
    if (filtered.length > 0 && features.trendMatch) {
      const built = buildTrendMatchPrompt({
        direction: profile.direction,
        learnedNotes: promptContext.learnedNotes,
        language: profile.language,
        items: filtered,
      });
      const routeProject = {
        id: profileId,
        mode: "AUTO" as const,
        settings: {
          language: profile.language,
          llm: profile.llm ?? undefined,
          budget: profile.defaultBrief.budget,
        },
      };
      const route = deps.llm.resolveTask("trendMatch", routeProject as never, getAppLlmSettings(deps.sqlite));
      const generated = await generateRoutedStructured({
        registry: deps.llm,
        route,
        task: "trendMatch",
        system: built.system,
        prompt: built.prompt,
        schema: TrendMatchOutputSchema,
        schemaName: "TrendMatch",
        schemaVersion: "1",
        maxOutputTokens: route.maxOutputTokens ?? 2_048,
        signal,
        cache: new LlmCache(deps.sqlite, true),
      });
      const accepted = acceptTrendIdeas(generated.value.ideas, coversNews);
      ideas = accepted.kept;
      for (const skip of accepted.skipped) {
        skipped.push(skip);
        if (skip.reason === "sensitive") logSkip(profileId, skip.title, "sensitive");
      }
    }
    storeIdeas(profileId, ideas);
    return { items: filtered, ideas, skipped };
  }

  async function addIdea(profileId: string, body: unknown): Promise<ProfileTopic> {
    const { idea } = AddTrendTopicBodySchema.parse(body);
    const { profile } = await loadSettings(profileId);
    const coversNews = directionCoversNews(profile.direction);
    const accepted = acceptTrendIdeas([idea], coversNews);
    if (accepted.kept.length === 0) {
      const reason = accepted.skipped[0]?.reason ?? "fit";
      if (reason === "sensitive") logSkip(profileId, idea.title, "sensitive");
      throw new AppError(422, "TREND_REJECTED", reason === "sensitive"
        ? "Chủ đề nhạy cảm bị bỏ qua vì hồ sơ không làm tin tức."
        : "Ý tưởng không đủ sát kênh (dưới 60).");
    }
    const kept = accepted.kept[0]!;
    const status = trendTopicStatus(kept.fitScore, profile.automation.autoApproveTopics);
    const notes = JSON.stringify({
      angle: kept.angle,
      whyNow: kept.whyNow,
      urgency: kept.urgency,
      fitScore: kept.fitScore,
      sources: kept.sourceTitles,
    }).slice(0, 2000);
    const id = randomUUID();
    const at = now().toISOString();
    const maxRow = deps.sqlite.prepare(
      "SELECT COALESCE(MAX(priority), 0) AS max FROM profile_topics WHERE profile_id = ?",
    ).get(profileId) as { max: number };
    let priority = maxRow.max + 1;
    let scheduledFor: string | null = null;
    if (kept.urgency === "today") {
      const existing = deps.sqlite.prepare(
        "SELECT id, notes, scheduled_for FROM profile_topics WHERE profile_id = ?",
      ).all(profileId) as Array<{ id: string; notes: string | null; scheduled_for: string | null }>;
      const plan = planTodaySlot({
        now: now(),
        automation: profile.automation,
        existing: existing.map((row) => ({
          id: row.id,
          scheduledFor: row.scheduled_for,
          urgency: urgencyFromNotes(row.notes),
        })),
      });
      scheduledFor = plan.scheduledFor;
      if (plan.displaced) {
        deps.sqlite.prepare(
          "UPDATE profile_topics SET scheduled_for = ?, updated_at = ? WHERE id = ?",
        ).run(plan.displaced.scheduledFor, at, plan.displaced.id);
      }
      priority = maxRow.max + 10;
    }
    deps.sqlite.prepare(
      `INSERT INTO profile_topics
        (id, profile_id, topic, notes, source, status, priority, project_id, scheduled_for, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'trend', ?, ?, NULL, ?, NULL, ?, ?)`,
    ).run(id, profileId, kept.title.slice(0, 500), notes, status, priority, scheduledFor, at, at);
    const row = deps.sqlite.prepare("SELECT * FROM profile_topics WHERE id = ?").get(id) as Record<string, unknown>;
    return ProfileTopicSchema.parse({
      id: row.id,
      profileId: row.profile_id,
      topic: row.topic,
      notes: row.notes ?? null,
      source: row.source,
      status: row.status,
      priority: row.priority,
      projectId: row.project_id ?? null,
      scheduledFor: row.scheduled_for ?? null,
      error: row.error ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  function listToday(limit = 5): Array<{
    profileId: string;
    profileName: string;
    title: string;
    angle: string;
    urgency: "today" | "this_week" | "evergreen";
    fitScore: number;
  }> {
    const rows = deps.sqlite.prepare(
      `SELECT i.profile_id, p.name AS profile_name, i.title, i.angle, i.urgency, i.fit_score
       FROM trend_ideas i
       JOIN profiles p ON p.id = i.profile_id
       WHERE p.archived_at IS NULL
       ORDER BY i.fit_score DESC, i.created_at DESC
       LIMIT ?`,
    ).all(limit) as Array<{
      profile_id: string;
      profile_name: string;
      title: string;
      angle: string;
      urgency: string;
      fit_score: number;
    }>;
    return rows.flatMap((row) => {
      if (row.urgency !== "today" && row.urgency !== "this_week" && row.urgency !== "evergreen") return [];
      return [{
        profileId: row.profile_id,
        profileName: row.profile_name,
        title: row.title,
        angle: row.angle,
        urgency: row.urgency,
        fitScore: row.fit_score,
      }];
    });
  }

  function setYoutubeApiKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (trimmed.length < 8) throw new AppError(400, "YOUTUBE_KEY_INVALID", "API key quá ngắn.");
    deps.vault.storeSecret(YOUTUBE_API_KEY_SECRET, trimmed);
  }

  function youtubeKeyConfigured(): boolean {
    return deps.vault.hasSecret(YOUTUBE_API_KEY_SECRET);
  }

  return { refresh, addIdea, listToday, setYoutubeApiKey, youtubeKeyConfigured };
}

export type TrendService = ReturnType<typeof createTrendService>;
