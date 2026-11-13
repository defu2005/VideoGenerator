import { randomUUID } from "node:crypto";
import { currentWorkspaceId } from "../auth/requestContext.js";
import type Database from "better-sqlite3";
import {
  YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE,
  type TokenSet,
} from "@vg/shared";
import { missingScopes } from "../analytics/scopes.js";
import { recordChannelRevenue } from "../knowledge/metricInputs.js";

const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2";

export type YoutubeRevenueDayRow = {
  date: string;
  estimatedRevenue: number;
  estimatedAdRevenue: number;
  estimatedRedPartnerRevenue: number;
};

export type YoutubeVideoRevenueRow = {
  videoId: string;
  date: string;
  estimatedRevenue: number;
};

export class YoutubeRevenueHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly notMonetized = false,
  ) {
    super(message);
    this.name = "YoutubeRevenueHttpError";
  }
}

function isNotMonetizedError(status: number, body: string): boolean {
  if (status === 403 || status === 400) {
    const lower = body.toLowerCase();
    return (
      lower.includes("monetiz")
      || lower.includes("not enabled")
      || lower.includes("partner")
      || lower.includes("forbidden")
      || lower.includes("insufficientpermissions")
      || lower.includes("insufficient permissions")
      || lower.includes("yt-analytics-monetary")
    );
  }
  return false;
}

export async function fetchChannelRevenueByDay(opts: {
  accessToken: string;
  from: string;
  to: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<YoutubeRevenueDayRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${ANALYTICS_API}/reports`);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", opts.from);
  url.searchParams.set("endDate", opts.to);
  url.searchParams.set("metrics", "estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue");
  url.searchParams.set("currency", "USD");
  url.searchParams.set("dimensions", "day");

  const response = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    signal: opts.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new YoutubeRevenueHttpError(
      `YouTube revenue day query failed (${response.status})`,
      response.status,
      text,
      isNotMonetizedError(response.status, text),
    );
  }
  const json = JSON.parse(text) as { rows?: Array<Array<string | number>>; columnHeaders?: Array<{ name: string }> };
  const headers = (json.columnHeaders ?? []).map((h) => h.name);
  const dayIdx = headers.indexOf("day");
  const revIdx = headers.indexOf("estimatedRevenue");
  const adIdx = headers.indexOf("estimatedAdRevenue");
  const redIdx = headers.indexOf("estimatedRedPartnerRevenue");
  const rows: YoutubeRevenueDayRow[] = [];
  for (const row of json.rows ?? []) {
    const revenue = row[revIdx];
    // An absent/invalid monetary column is missing data, not an explicit zero observation.
    if ((typeof revenue !== "number" && typeof revenue !== "string") || String(revenue).trim() === "" || !Number.isFinite(Number(revenue))) continue;
    const dateRaw = String(row[dayIdx] ?? "");
    const date = dateRaw.length === 8
      ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
      : dateRaw;
    rows.push({
      date,
      estimatedRevenue: Number(revenue),
      estimatedAdRevenue: Number(row[adIdx] ?? 0) || 0,
      estimatedRedPartnerRevenue: Number(row[redIdx] ?? 0) || 0,
    });
  }
  return rows;
}

export async function fetchVideoRevenueByDay(opts: {
  accessToken: string;
  from: string;
  to: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<YoutubeVideoRevenueRow[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${ANALYTICS_API}/reports`);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", opts.from);
  url.searchParams.set("endDate", opts.to);
  url.searchParams.set("metrics", "estimatedRevenue");
  url.searchParams.set("dimensions", "day,video");

  const response = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    signal: opts.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new YoutubeRevenueHttpError(
      `YouTube revenue video query failed (${response.status})`,
      response.status,
      text,
      isNotMonetizedError(response.status, text),
    );
  }
  const json = JSON.parse(text) as { rows?: Array<Array<string | number>>; columnHeaders?: Array<{ name: string }> };
  const headers = (json.columnHeaders ?? []).map((h) => h.name);
  const dayIdx = headers.indexOf("day");
  const videoIdx = headers.indexOf("video");
  const revIdx = headers.indexOf("estimatedRevenue");
  const rows: YoutubeVideoRevenueRow[] = [];
  for (const row of json.rows ?? []) {
    const dateRaw = String(row[dayIdx] ?? "");
    const date = dateRaw.length === 8
      ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
      : dateRaw;
    rows.push({
      videoId: String(row[videoIdx] ?? ""),
      date,
      estimatedRevenue: Number(row[revIdx] ?? 0) || 0,
    });
  }
  return rows;
}

export function monetaryScopesMissing(granted: string[] | undefined): string[] {
  return missingScopes(granted ?? [], [YOUTUBE_ANALYTICS_MONETARY_READONLY_SCOPE]);
}

export type UpsertRevenueResult = { inserted: number; updated: number };

/** Idempotent upsert for youtube_api rows keyed by external_key. */
export function upsertYoutubeRevenueEntries(
  sqlite: Database.Database,
  opts: {
    accountId: string;
    profileId: string;
    channelId: string;
    dayRows: YoutubeRevenueDayRow[];
    videoRows: YoutubeVideoRevenueRow[];
    publicationByExternalId: Map<string, string>;
    nowIso: string;
  },
): UpsertRevenueResult {
  recordChannelRevenue(sqlite, opts.accountId, opts.dayRows, opts.nowIso);
  let inserted = 0;
  let updated = 0;

  const find = sqlite.prepare(
    `SELECT id FROM revenue_entries WHERE source = 'youtube_api' AND external_key = ?`,
  );
  const update = sqlite.prepare(
    `UPDATE revenue_entries SET amount = ?, currency = ?, kind = ?, period_start = ?, period_end = ?,
      account_id = ?, profile_id = ?, publication_id = ?, note = ?
     WHERE id = ?`,
  );
  const insert = sqlite.prepare(
    `INSERT INTO revenue_entries (
      id, account_id, publication_id, profile_id, source, kind,
      period_start, period_end, amount, currency, note, external_key, created_at, workspace_id
    ) VALUES (?, ?, ?, ?, 'youtube_api', ?, ?, ?, ?, 'USD', ?, ?, ?,
      COALESCE((SELECT workspace_id FROM profiles WHERE id = ?), ?))`,
  );

  const upsert = (
    externalKey: string,
    amount: number,
    kind: string,
    date: string,
    publicationId: string | null,
    note: string | null,
  ) => {
    if (!(amount > 0)) return;
    const existing = find.get(externalKey) as { id: string } | undefined;
    if (existing) {
      update.run(
        amount,
        "USD",
        kind,
        date,
        date,
        opts.accountId,
        opts.profileId,
        publicationId,
        note,
        existing.id,
      );
      updated += 1;
    } else {
      insert.run(
        randomUUID(),
        opts.accountId,
        publicationId,
        opts.profileId,
        kind,
        date,
        date,
        amount,
        note,
        externalKey,
        opts.nowIso,
        opts.profileId,
        currentWorkspaceId(sqlite),
      );
      inserted += 1;
    }
  };

  // Prefer per-video rows so channel + video are not double-counted in profit.
  const datesWithVideo = new Set(opts.videoRows.map((v) => v.date));

  for (const video of opts.videoRows) {
    if (!video.videoId) continue;
    const publicationId = opts.publicationByExternalId.get(video.videoId) ?? null;
    const key = `${video.videoId}:${video.date}`;
    upsert(key, video.estimatedRevenue, "ads", video.date, publicationId, "YouTube video day revenue");
  }

  for (const day of opts.dayRows) {
    if (datesWithVideo.has(day.date)) continue;
    const channelKey = `${opts.channelId}:${day.date}`;
    const total = day.estimatedRevenue
      || (day.estimatedAdRevenue + day.estimatedRedPartnerRevenue);
    upsert(channelKey, total, "ads", day.date, null, "YouTube channel day revenue");
  }

  return { inserted, updated };
}

export async function syncAccountYoutubeRevenue(opts: {
  sqlite: Database.Database;
  accountId: string;
  profileId: string;
  channelId: string;
  tokens: TokenSet;
  from: string;
  to: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  nowIso: string;
}): Promise<{ ok: true; result: UpsertRevenueResult } | { ok: false; notMonetized: boolean; error: string }> {
  const missing = monetaryScopesMissing(opts.tokens.scopes);
  if (missing.length > 0) {
    return { ok: false, notMonetized: false, error: `Thiếu quyền: ${missing.join(", ")}` };
  }

  try {
    const [dayRows, videoRows] = await Promise.all([
      fetchChannelRevenueByDay({
        accessToken: opts.tokens.accessToken,
        from: opts.from,
        to: opts.to,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
      }),
      fetchVideoRevenueByDay({
        accessToken: opts.tokens.accessToken,
        from: opts.from,
        to: opts.to,
        signal: opts.signal,
        fetchImpl: opts.fetchImpl,
      }),
    ]);

    const pubs = opts.sqlite.prepare(
      `SELECT id, external_id FROM publications
       WHERE account_id = ? AND external_id IS NOT NULL AND status = 'PUBLISHED'`,
    ).all(opts.accountId) as Array<{ id: string; external_id: string }>;
    const publicationByExternalId = new Map(pubs.map((p) => [p.external_id, p.id]));

    const result = upsertYoutubeRevenueEntries(opts.sqlite, {
      accountId: opts.accountId,
      profileId: opts.profileId,
      channelId: opts.channelId,
      dayRows,
      videoRows,
      publicationByExternalId,
      nowIso: opts.nowIso,
    });
    return { ok: true, result };
  } catch (error) {
    if (error instanceof YoutubeRevenueHttpError) {
      return {
        ok: false,
        notMonetized: error.notMonetized,
        error: error.notMonetized
          ? "Kênh chưa bật kiếm tiền"
          : `YouTube revenue sync lỗi (${error.status})`,
      };
    }
    return {
      ok: false,
      notMonetized: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
