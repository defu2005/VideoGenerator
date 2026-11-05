import type Database from "better-sqlite3";
import {
  CostKindSchema,
  RevenueKindSchema,
} from "@vg/shared";
import { getAppCurrency, listCurrencyRates } from "../finance/currencySettings.js";
import {
  allocateRevenue,
  buildRateTable,
  computeVideoProfits,
  type CostRowInput,
  type RevenueRowInput,
  type VideoViewsInput,
} from "../finance/profit.js";
import {
  buildFeatureRows,
  firstSentence,
  type FeatureRow,
  type LearningSource,
  type MetricSnapshot,
} from "./features.js";

type PubRow = {
  id: string;
  platform: string;
  published_at: string;
  project_id: string;
  account_id: string;
  topic: string;
  title: string;
  settings: string;
  duration_sec: number | null;
  latest_metrics: string | null;
  automation: string | null;
  profile_voice: string | null;
  profile_language: string;
};

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function hookFromScript(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const script = data as { hook?: unknown; sections?: Array<{ narration?: unknown }> };
  if (typeof script.hook === "string" && script.hook.trim()) return firstSentence(script.hook);
  const narration = script.sections?.find((section) => typeof section.narration === "string")?.narration;
  return typeof narration === "string" ? firstSentence(narration) : "";
}

function timeZoneOf(automation: string | null): string {
  const parsed = parseJson<{ timezone?: string }>(automation);
  return parsed?.timezone?.trim() || "Asia/Ho_Chi_Minh";
}

export function loadFeatureRows(sqlite: Database.Database, profileId: string): FeatureRow[] {
  const pubs = sqlite.prepare(
    `SELECT pub.id, a.platform, pub.published_at, pub.project_id, pub.account_id,
            pr.topic, pr.title, pr.settings, pr.duration_sec, pub.latest_metrics,
            pf.automation, pf.voice AS profile_voice, pf.language AS profile_language
     FROM publications pub
     JOIN platform_accounts a ON a.id = pub.account_id
     JOIN projects pr ON pr.id = pub.project_id
     JOIN profiles pf ON pf.id = a.profile_id
     WHERE a.profile_id = ? AND pub.status = 'PUBLISHED' AND pub.published_at IS NOT NULL`,
  ).all(profileId) as PubRow[];
  if (pubs.length === 0) return [];

  const ids = pubs.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const snaps = sqlite.prepare(
    `SELECT publication_id, fetched_at, views, likes, comments, shares, avg_view_pct, subscribers_gained
     FROM publication_metrics_snapshots
     WHERE publication_id IN (${placeholders})`,
  ).all(...ids) as Array<{
    publication_id: string;
    fetched_at: string;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    avg_view_pct: number | null;
    subscribers_gained: number | null;
  }>;
  const byPub = new Map<string, MetricSnapshot[]>();
  for (const snap of snaps) {
    const list = byPub.get(snap.publication_id) ?? [];
    list.push({
      fetchedAt: snap.fetched_at,
      views: snap.views,
      likes: snap.likes,
      comments: snap.comments,
      shares: snap.shares,
      avgViewPct: snap.avg_view_pct,
      subscribersGained: snap.subscribers_gained,
    });
    byPub.set(snap.publication_id, list);
  }

  const projectIds = [...new Set(pubs.map((row) => row.project_id))];
  const projectPlaceholders = projectIds.map(() => "?").join(",");
  const scripts = sqlite.prepare(
    `SELECT project_id, data FROM scripts WHERE project_id IN (${projectPlaceholders})`,
  ).all(...projectIds) as Array<{ project_id: string; data: string }>;
  const hooks = new Map<string, string>();
  for (const row of scripts) hooks.set(row.project_id, hookFromScript(parseJson(row.data)));

  const sceneCounts = sqlite.prepare(
    `SELECT project_id, COUNT(*) AS n FROM scenes WHERE project_id IN (${projectPlaceholders}) GROUP BY project_id`,
  ).all(...projectIds) as Array<{ project_id: string; n: number }>;
  const scenes = new Map(sceneCounts.map((row) => [row.project_id, row.n]));

  const timelines = sqlite.prepare(
    `SELECT project_id, total_duration_sec FROM timelines WHERE project_id IN (${projectPlaceholders})`,
  ).all(...projectIds) as Array<{ project_id: string; total_duration_sec: number }>;
  const durations = new Map(timelines.map((row) => [row.project_id, row.total_duration_sec]));

  const music = sqlite.prepare(
    `SELECT project_id, status FROM music_selections WHERE project_id IN (${projectPlaceholders})`,
  ).all(...projectIds) as Array<{ project_id: string; status: string }>;
  const musicOn = new Map(music.map((row) => [row.project_id, row.status !== "NONE"]));

  const metadata = sqlite.prepare(
    `SELECT project_id, draft, edited FROM video_metadata WHERE project_id IN (${projectPlaceholders})`,
  ).all(...projectIds) as Array<{ project_id: string; draft: string; edited: string | null }>;
  const titles = new Map<string, { title: string; hashtags: number }>();
  for (const row of metadata) {
    const edited = parseJson<{ titles?: string[]; hashtags?: string[] }>(row.edited);
    const draft = parseJson<{ titles?: string[]; hashtags?: string[] }>(row.draft);
    const chosen = edited?.titles?.length ? edited : draft;
    const title = chosen?.titles?.find((item) => item.trim()) ?? "";
    titles.set(row.project_id, { title, hashtags: chosen?.hashtags?.length ?? 0 });
  }

  const profits = profitByPublication(sqlite, profileId, pubs);
  const zone = timeZoneOf(pubs[0]?.automation ?? null);

  const sources: LearningSource[] = pubs.map((row) => {
    const settings = parseJson<{
      language?: string;
      aspectRatio?: string;
      style?: string;
      targetDurationSec?: number;
      voice?: { voice?: string };
    }>(row.settings) ?? {};
    const profileVoice = parseJson<{ voice?: string }>(row.profile_voice);
    const meta = titles.get(row.project_id);
    const title = meta?.title || row.title || row.topic;
    return {
      publicationId: row.id,
      platform: row.platform,
      publishedAt: row.published_at,
      timeZone: zone,
      topicTitle: row.topic || row.title,
      hook: hooks.get(row.project_id) ?? "",
      durationSec: durations.get(row.project_id) ?? row.duration_sec ?? settings.targetDurationSec ?? null,
      sceneCount: scenes.get(row.project_id) ?? null,
      voice: settings.voice?.voice ?? profileVoice?.voice ?? null,
      musicOn: musicOn.has(row.project_id) ? musicOn.get(row.project_id)! : null,
      aspect: settings.aspectRatio ?? null,
      language: settings.language ?? row.profile_language ?? null,
      template: settings.style ?? null,
      title,
      hashtagCount: meta?.hashtags ?? 0,
      snapshots: byPub.get(row.id) ?? [],
      profit: profits.get(row.id) ?? null,
    };
  });
  return buildFeatureRows(sources);
}

function profitByPublication(
  sqlite: Database.Database,
  profileId: string,
  pubs: PubRow[],
): Map<string, number> {
  const out = new Map<string, number>();
  const revenuesRaw = sqlite.prepare(
    `SELECT id, account_id, publication_id, profile_id, kind, period_start, period_end, amount, currency
     FROM revenue_entries
     WHERE profile_id = ? OR account_id IN (SELECT id FROM platform_accounts WHERE profile_id = ?)`,
  ).all(profileId, profileId) as Array<Record<string, unknown>>;
  const costsRaw = sqlite.prepare(
    `SELECT id, profile_id, project_id, kind, date, amount, currency, source
     FROM cost_entries
     WHERE profile_id = ? OR project_id IN (SELECT id FROM projects WHERE profile_id = ?)`,
  ).all(profileId, profileId) as Array<Record<string, unknown>>;
  if (revenuesRaw.length === 0 && costsRaw.length === 0) return out;

  const revenues: RevenueRowInput[] = [];
  for (const row of revenuesRaw) {
    const kind = RevenueKindSchema.safeParse(row.kind);
    if (!kind.success) continue;
    revenues.push({
      id: String(row.id),
      accountId: row.account_id ? String(row.account_id) : null,
      publicationId: row.publication_id ? String(row.publication_id) : null,
      profileId: row.profile_id ? String(row.profile_id) : null,
      kind: kind.data,
      periodStart: String(row.period_start),
      periodEnd: String(row.period_end),
      amount: Number(row.amount),
      currency: String(row.currency),
    });
  }
  const costs: CostRowInput[] = [];
  for (const row of costsRaw) {
    const kind = CostKindSchema.safeParse(row.kind);
    if (!kind.success) continue;
    const source = row.source === "usage_auto" ? "usage_auto" : "manual";
    costs.push({
      id: String(row.id),
      profileId: row.profile_id ? String(row.profile_id) : null,
      projectId: row.project_id ? String(row.project_id) : null,
      kind: kind.data,
      date: String(row.date),
      amount: Number(row.amount),
      currency: String(row.currency),
      source,
    });
  }
  if (revenues.length === 0 && costs.length === 0) return out;

  const appCurrency = getAppCurrency(sqlite);
  let rates;
  try {
    rates = buildRateTable(listCurrencyRates(sqlite), appCurrency);
  } catch {
    return out;
  }
  const videos: VideoViewsInput[] = pubs.map((row) => {
    const metrics = parseJson<{ views?: number | null }>(row.latest_metrics);
    return {
      publicationId: row.id,
      accountId: row.account_id,
      projectId: row.project_id,
      profileId,
      title: row.title,
      platform: row.platform,
      views: metrics?.views ?? null,
    };
  });
  try {
    const allocated = allocateRevenue(
      revenues,
      videos,
      { from: "2000-01-01", to: "2999-12-31" },
      appCurrency,
      rates,
    );
    const profits = computeVideoProfits(allocated, costs, videos, appCurrency, rates);
    for (const item of profits) {
      if (item.publicationId) out.set(item.publicationId, item.profit);
    }
  } catch {
    return new Map();
  }
  return out;
}

/** Scores for analytics. Profiles with fewer than 8 scored videos contribute nothing. */
export function scoreMapForProfiles(sqlite: Database.Database, profileIds: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const profileId of new Set(profileIds)) {
    const rows = loadFeatureRows(sqlite, profileId);
    const scored = rows.filter((row) => row.score != null);
    if (scored.length < 8) continue;
    for (const row of scored) scores.set(row.publicationId, row.score!);
  }
  return scores;
}
