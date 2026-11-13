import { localDateString, zonedLocalToUtc, type InsightRecommendations } from "@vg/shared";

const HOUR_MS = 60 * 60 * 1000;
export const SNAPSHOT_72H_MS = 72 * HOUR_MS;
export const SNAPSHOT_7D_MS = 7 * 24 * HOUR_MS;
export const MIN_SCORED_VIDEOS = 8;
export const MIN_NEW_SCORED = 3;
export const HOUR_BUCKET_MIN = 3;
const LEARNED_NOTES_MAX = 600;

export type MetricSnapshot = {
  fetchedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  avgViewPct: number | null;
  subscribersGained: number | null;
};

export type LearningSource = {
  publicationId: string;
  platform: string;
  publishedAt: string;
  timeZone: string;
  topicTitle: string;
  hook: string;
  durationSec: number | null;
  sceneCount: number | null;
  voice: string | null;
  musicOn: boolean | null;
  aspect: string | null;
  language: string | null;
  template: string | null;
  format: string | null;
  title: string;
  hashtagCount: number;
  snapshots: MetricSnapshot[];
  profit: number | null;
  engine?: "compose" | "legacy" | null;
  shotsPerMin?: number | null;
  stillShare?: number | null;
  graphicShare?: number | null;
  beatCutPct?: number | null;
  hookShotKind?: string | null;
  kindEntropyBits?: number | null;
};

export type FeatureRow = {
  publicationId: string;
  platform: string;
  topicTitle: string;
  hook: string;
  durationSec: number | null;
  sceneCount: number | null;
  voice: string | null;
  musicOn: boolean | null;
  aspect: string | null;
  language: string | null;
  template: string | null;
  format: string | null;
  title: string;
  titleLength: number;
  hashtagCount: number;
  weekday: string;
  hour: number;
  postingTime: string;
  views72h: number | null;
  views7d: number | null;
  avgViewPct: number | null;
  engagementPer1k: number | null;
  followersGained: number | null;
  profit: number | null;
  score: number | null;
  engine: string | null;
  shotsPerMin: number | null;
  stillShare: number | null;
  graphicShare: number | null;
  beatCutPct: number | null;
  hookShotKind: string | null;
  kindEntropyBits: number | null;
};

export type HourStat = { hour: number; count: number; medianScore: number };
export type DurationStat = { bucket: string; count: number; medianScore: number };
export type TopicStat = { label: string; count: number; medianScore: number };

export type InsightStats = {
  hourBuckets: HourStat[];
  supportedHours: number[];
  durationBuckets: DurationStat[];
  observedDuration: { min: number; max: number } | null;
  topicClusters: TopicStat[];
  overallMedian: number | null;
  composeNotes: string[];
};

export function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^.*?[.!?…](?=\s|$)/);
  return (match?.[0] ?? trimmed).slice(0, 400);
}

export function closestSnapshot(snapshots: MetricSnapshot[], targetMs: number): MetricSnapshot | null {
  let best: MetricSnapshot | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const snap of snapshots) {
    const at = Date.parse(snap.fetchedAt);
    if (!Number.isFinite(at)) continue;
    const dist = Math.abs(at - targetMs);
    if (dist < bestDist) {
      best = snap;
      bestDist = dist;
    }
  }
  return best;
}

function hasMetricsAfter72h(publishedMs: number, snapshots: MetricSnapshot[]): boolean {
  return snapshots.some((snap) => {
    const at = Date.parse(snap.fetchedAt);
    return Number.isFinite(at) && at >= publishedMs + SNAPSHOT_72H_MS;
  });
}

function engagementPer1k(snap: MetricSnapshot | null): number | null {
  if (!snap || snap.views == null) return null;
  if (snap.views <= 0) return 0;
  const likes = snap.likes ?? 0;
  const comments = snap.comments ?? 0;
  const shares = snap.shares ?? 0;
  return ((likes + comments + shares) / snap.views) * 1000;
}

function zonedHourWeekday(iso: string, timeZone: string): { hour: number; weekday: string; postingTime: string } {
  const date = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour ?? "0");
  if (hour === 24) hour = 0;
  const minute = String(map.minute ?? "00").padStart(2, "0");
  return {
    hour,
    weekday: map.weekday ?? "",
    postingTime: `${String(hour).padStart(2, "0")}:${minute}`,
  };
}

function percentileRanks(values: Array<number | null>): Array<number | null> {
  const present = values
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => item.value != null && Number.isFinite(item.value));
  const out: Array<number | null> = values.map(() => null);
  const n = present.length;
  if (n === 0) return out;
  if (n === 1) {
    out[present[0]!.index] = 50;
    return out;
  }
  for (const item of present) {
    const below = present.filter((other) => other.value < item.value).length;
    const equal = present.filter((other) => other.value === item.value).length;
    out[item.index] = ((below + (equal - 1) / 2) / (n - 1)) * 100;
  }
  return out;
}

function roundScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** One row per publication that already has a snapshot at least 72h after publish. Scores are per platform. */
export function buildFeatureRows(sources: LearningSource[]): FeatureRow[] {
  const rows: FeatureRow[] = [];
  for (const source of sources) {
    const publishedMs = Date.parse(source.publishedAt);
    if (!Number.isFinite(publishedMs)) continue;
    if (!hasMetricsAfter72h(publishedMs, source.snapshots)) continue;
    const at72 = closestSnapshot(source.snapshots, publishedMs + SNAPSHOT_72H_MS);
    const at7 = closestSnapshot(source.snapshots, publishedMs + SNAPSHOT_7D_MS);
    const when = zonedHourWeekday(source.publishedAt, source.timeZone || "Asia/Ho_Chi_Minh");
    rows.push({
      publicationId: source.publicationId,
      platform: source.platform,
      topicTitle: source.topicTitle,
      hook: source.hook,
      durationSec: source.durationSec,
      sceneCount: source.sceneCount,
      voice: source.voice,
      musicOn: source.musicOn,
      aspect: source.aspect,
      language: source.language,
      template: source.template,
      format: source.format,
      title: source.title,
      titleLength: source.title.length,
      hashtagCount: source.hashtagCount,
      weekday: when.weekday,
      hour: when.hour,
      postingTime: when.postingTime,
      views72h: at72?.views ?? null,
      views7d: at7?.views ?? null,
      avgViewPct: at7?.avgViewPct ?? null,
      engagementPer1k: engagementPer1k(at7),
      followersGained: at7?.subscribersGained ?? null,
      profit: source.profit,
      score: null,
      engine: source.engine === "compose" ? "compose" : null,
      shotsPerMin: source.engine === "compose" ? source.shotsPerMin ?? null : null,
      stillShare: source.engine === "compose" ? source.stillShare ?? null : null,
      graphicShare: source.engine === "compose" ? source.graphicShare ?? null : null,
      beatCutPct: source.engine === "compose" ? source.beatCutPct ?? null : null,
      hookShotKind: source.engine === "compose" ? source.hookShotKind ?? null : null,
      kindEntropyBits: source.engine === "compose" ? source.kindEntropyBits ?? null : null,
    });
  }

  const byPlatform = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const list = byPlatform.get(row.platform) ?? [];
    list.push(index);
    byPlatform.set(row.platform, list);
  });

  for (const indexes of byPlatform.values()) {
    const views = indexes.map((index) => rows[index]!.views7d);
    const avgs = indexes.map((index) => rows[index]!.avgViewPct);
    const engs = indexes.map((index) => rows[index]!.engagementPer1k);
    const pViews = percentileRanks(views);
    const pAvgs = percentileRanks(avgs);
    const pEngs = percentileRanks(engs);
    indexes.forEach((index, local) => {
      const row = rows[index]!;
      if (row.views7d == null) return;
      const parts: Array<{ value: number; weight: number }> = [];
      if (pViews[local] != null) parts.push({ value: pViews[local]!, weight: 0.5 });
      if (pAvgs[local] != null) parts.push({ value: pAvgs[local]!, weight: 0.3 });
      if (pEngs[local] != null) parts.push({ value: pEngs[local]!, weight: 0.2 });
      if (parts.length === 0) return;
      const weight = parts.reduce((sum, part) => sum + part.weight, 0);
      row.score = roundScore(parts.reduce((sum, part) => sum + part.value * part.weight, 0) / weight);
    });
  }
  return rows;
}

export function scoredRows(rows: FeatureRow[]): FeatureRow[] {
  return rows.filter((row) => row.score != null);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function durationBucket(sec: number): string {
  if (sec < 60) return "0-59s";
  if (sec < 180) return "60-179s";
  if (sec < 600) return "180-599s";
  return "600s+";
}

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const word of a) if (b.has(word)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function composeNotes(rows: FeatureRow[]): string[] {
  const compose = rows.filter((row) => row.shotsPerMin != null && row.avgViewPct != null);
  if (compose.length < 4) return [];
  const ordered = [...compose].sort((a, b) => (a.avgViewPct ?? 0) - (b.avgViewPct ?? 0));
  const quarter = Math.max(1, Math.floor(ordered.length / 4));
  const bottom = ordered.slice(0, quarter);
  const top = ordered.slice(-quarter);
  const topShots = median(top.flatMap((row) => row.shotsPerMin == null ? [] : [row.shotsPerMin]));
  const bottomShots = median(bottom.flatMap((row) => row.shotsPerMin == null ? [] : [row.shotsPerMin]));
  if (topShots == null || bottomShots == null || !(topShots >= 20) || !(topShots > bottomShots)) return [];
  return ["video có ≥ 20 cảnh/phút giữ người xem tốt hơn"];
}

export function computeInsightStats(rows: FeatureRow[]): InsightStats {
  const scored = scoredRows(rows);
  const scores = scored.map((row) => row.score!);
  const overallMedian = median(scores);
  const hourMap = new Map<number, number[]>();
  for (const row of scored) {
    const list = hourMap.get(row.hour) ?? [];
    list.push(row.score!);
    hourMap.set(row.hour, list);
  }
  const hourBuckets: HourStat[] = [...hourMap.entries()]
    .map(([hour, list]) => ({ hour, count: list.length, medianScore: median(list) ?? 0 }))
    .sort((a, b) => a.hour - b.hour);
  const supportedHours = hourBuckets
    .filter((bucket) => bucket.count >= HOUR_BUCKET_MIN && overallMedian != null && bucket.medianScore > overallMedian)
    .map((bucket) => bucket.hour);

  const durationMap = new Map<string, number[]>();
  const durations: number[] = [];
  for (const row of scored) {
    if (row.durationSec == null) continue;
    durations.push(row.durationSec);
    const key = durationBucket(row.durationSec);
    const list = durationMap.get(key) ?? [];
    list.push(row.score!);
    durationMap.set(key, list);
  }
  const durationBuckets: DurationStat[] = [...durationMap.entries()].map(([bucket, list]) => ({
    bucket,
    count: list.length,
    medianScore: median(list) ?? 0,
  }));

  type Cluster = { label: string; words: Set<string>; scores: number[] };
  const clusters: Cluster[] = [];
  for (const row of scored) {
    const words = keywords(row.topicTitle || row.title);
    let best = -1;
    let bestScore = 0;
    clusters.forEach((cluster, index) => {
      const overlap = jaccard(words, cluster.words);
      if (overlap >= 0.34 && overlap > bestScore) {
        best = index;
        bestScore = overlap;
      }
    });
    if (best >= 0) {
      const cluster = clusters[best]!;
      for (const word of words) cluster.words.add(word);
      cluster.scores.push(row.score!);
      if ((row.topicTitle || row.title).length < cluster.label.length) {
        cluster.label = row.topicTitle || row.title;
      }
    } else {
      clusters.push({
        label: (row.topicTitle || row.title || "khác").slice(0, 80),
        words,
        scores: [row.score!],
      });
    }
  }

  return {
    hourBuckets,
    supportedHours,
    durationBuckets,
    observedDuration: durations.length
      ? { min: Math.min(...durations), max: Math.max(...durations) }
      : null,
    topicClusters: clusters.map((cluster) => ({
      label: cluster.label,
      count: cluster.scores.length,
      medianScore: median(cluster.scores) ?? 0,
    })),
    overallMedian,
    composeNotes: composeNotes(scored),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Drop publish times the stats do not support, and clamp duration onto the observed range. */
export function validateRecommendations(
  raw: InsightRecommendations,
  stats: InsightStats,
): InsightRecommendations {
  const out: InsightRecommendations = {};
  if (raw.directionAddendum?.trim()) {
    out.directionAddendum = raw.directionAddendum.trim().slice(0, LEARNED_NOTES_MAX);
  }
  const times = (raw.publishTimes ?? [])
    .map((time) => time.trim())
    .filter((time) => HHMM.test(time) && stats.supportedHours.includes(Number(time.slice(0, 2))));
  if (times.length > 0) out.publishTimes = [...new Set(times)];

  if (raw.preferredDurationSec && stats.observedDuration) {
    const observed = stats.observedDuration;
    let min = raw.preferredDurationSec.min;
    let max = raw.preferredDurationSec.max;
    if (min > max) [min, max] = [max, min];
    const overlapMin = Math.max(min, observed.min);
    const overlapMax = Math.min(max, observed.max);
    if (overlapMin <= overlapMax) {
      min = overlapMin;
      max = overlapMax;
    } else if (max < observed.min) {
      min = observed.min;
      max = observed.min;
    } else {
      min = observed.max;
      max = observed.max;
    }
    out.preferredDurationSec = {
      min: clamp(min, 30, 1800),
      max: clamp(max, 30, 1800),
    };
    if (out.preferredDurationSec.min > out.preferredDurationSec.max) {
      out.preferredDurationSec = {
        min: out.preferredDurationSec.max,
        max: out.preferredDurationSec.min,
      };
    }
  }

  const angles = (raw.topicAngles ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  if (angles.length > 0) out.topicAngles = angles;
  const avoid = (raw.avoid ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 5);
  if (avoid.length > 0) out.avoid = avoid;
  return out;
}

export function limitSummaryBullets(summary: string, max = 5): string {
  const lines = summary.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^[-•*]/.test(line) || /^\d+[.)]/.test(line));
  const chosen = (bullets.length > 0 ? bullets : lines).slice(0, max);
  return chosen.join("\n").slice(0, 2000);
}

export function extremes(rows: FeatureRow[], fraction = 0.25): { top: FeatureRow[]; bottom: FeatureRow[] } {
  const scored = [...scoredRows(rows)].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const count = Math.max(1, Math.ceil(scored.length * fraction));
  return {
    top: scored.slice(0, count),
    bottom: scored.slice(-count).reverse(),
  };
}

function weekdayIndex(date: Date, timeZone: string): number | null {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[name] ?? null;
}

/** Monday 08:00 in the profile timezone, only once that local time has been reached. */
export function isWeeklyInsightDue(input: {
  now: Date;
  timeZone: string;
  lastInsightAt: string | null;
  economy: boolean;
}): boolean {
  if (weekdayIndex(input.now, input.timeZone) !== 1) return false;
  const localDate = localDateString(input.now, input.timeZone);
  const slot = zonedLocalToUtc(localDate, "08:00", input.timeZone);
  if (input.now.getTime() < slot.getTime()) return false;
  if (input.lastInsightAt && Date.parse(input.lastInsightAt) >= slot.getTime()) return false;
  if (input.economy && input.lastInsightAt) {
    const elapsed = input.now.getTime() - Date.parse(input.lastInsightAt);
    if (elapsed < 14 * 24 * HOUR_MS) return false;
  }
  return true;
}

export function viewsPerHour(views: number, publishedAt: string, now: Date): number {
  const hours = Math.max((now.getTime() - Date.parse(publishedAt)) / HOUR_MS, 1 / 60);
  return views / hours;
}

/** Switch only after 48h, only when below the profile median, and never twice. */
export function shouldSwitchTitle(input: {
  ageMs: number;
  viewsPerHour: number | null;
  medianViewsPerHour: number | null;
  alreadyChecked: boolean;
}): "switch" | "keep" | "wait" {
  if (input.alreadyChecked) return "keep";
  if (input.ageMs < 48 * HOUR_MS) return "wait";
  if (input.viewsPerHour == null || input.medianViewsPerHour == null) return "wait";
  return input.viewsPerHour < input.medianViewsPerHour ? "switch" : "keep";
}
