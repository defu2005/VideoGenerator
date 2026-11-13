import { driftCategory, metricDrift, KNOWLEDGE_VALUES, type MetricPoint, type KnowledgeEntry } from "@vg/shared";
import type Database from "better-sqlite3";
import { AccountHealth } from "./accountHealth.js";
import type { ChannelRevenuePoint } from "./metricInputs.js";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

const ManualMetric = z.object({
  accountId: z.string().min(1), date: z.iso.date(), metric: z.enum(["views48h", "ctr", "avgViewPct", "impressions", "rpm"]),
  trafficSource: z.string().trim().min(1).max(80).optional(), format: z.string().trim().min(1).max(80).default("*"),
  value: z.number().nonnegative().finite(), samples: z.number().int().min(1).max(1_000_000_000),
  sourceUrl: z.url({ protocol: /^https?$/ }),
}).strict().refine(x => x.metric !== "ctr" || x.value <= 1, "CTR dùng tỉ lệ 0–1.")
  .refine(x => x.metric !== "impressions" || Boolean(x.trafficSource), "Ghi nguồn traffic của impressions.");

type Series = { accountId: string; platform: string; metric: string; format: string; points: MetricPoint[] };
type Sample = Omit<Series, "points"> & { point: MetricPoint };
type Snapshot = { account_id: string; platform: string; publication_id: string; fetched_at: string; published_at: string;
  views: number | null; avg_view_pct: number | null; raw: string; settings: string };
const object = (x: unknown): Record<string, unknown> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const numeric = (x: unknown): number | null => typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null;

export class DriftMonitor {
  private readonly health: AccountHealth;
  constructor(private readonly db: Database.Database, private readonly now = () => new Date(),
    private readonly evidenceUrl = "http://127.0.0.1:3001/api/knowledge/metrics") { this.health = new AccountHealth(db, now); }
  series(): Series[] {
    return JSON.parse(this.health.inbox.setting("change.metricSeries") ?? "[]") as Series[];
  }
  /** Upsert one channel/format/day with sample count; no fabricated zeros for unsupported fields. */
  record(input: Sample): void { this.recordBatch([input]); }
  recordManual(raw: unknown): void {
    const input = ManualMetric.parse(raw), day = this.now().toISOString().slice(0, 10);
    const account = this.health.accounts().find(x => x.id === input.accountId);
    if (!account) throw new AppError(404, "ACCOUNT_NOT_FOUND", "Chọn tài khoản đã kết nối.");
    if (input.date >= day || input.date < new Date(this.now().getTime() - 180 * 86_400_000).toISOString().slice(0, 10)) {
      throw new AppError(400, "METRIC_DATE", "Chọn ngày đã kết thúc trong 180 ngày gần đây.");
    }
    const metric = input.metric === "impressions" ? `impressions:${input.trafficSource}` : input.metric;
    const sample = { accountId: account.id, platform: account.platform, metric, format: input.format,
      point: { date: input.date, value: input.value, samples: input.samples, knowledgeRev: "unknown", format: input.format,
        definition: `manual-dashboard:${metric}:v1` }, sourceUrl: input.sourceUrl, checkedAt: this.now().toISOString() };
    const saved = JSON.parse(this.health.inbox.setting("change.manualMetrics") ?? "[]") as Array<Sample & { sourceUrl: string; checkedAt: string }>;
    const kept = saved.filter(x => x.point.date >= new Date(this.now().getTime() - 180 * 86_400_000).toISOString().slice(0, 10)
      && !(x.accountId === sample.accountId && x.metric === sample.metric && x.format === sample.format && x.point.date === sample.point.date));
    this.health.inbox.putSetting("change.manualMetrics", JSON.stringify([...kept, sample].slice(-30_000)));
    this.record(sample);
  }
  private recordBatch(inputs: Sample[]): void {
    const all = this.series(), index = new Map(all.map(x => [JSON.stringify([x.accountId, x.metric, x.format]), x]));
    const cutoff = new Date(this.now().getTime() - 180 * 86_400_000).toISOString().slice(0, 10);
    for (const input of inputs) {
      if (input.point.date < cutoff) continue;
      const key = JSON.stringify([input.accountId, input.metric, input.format]);
      let series = index.get(key);
      if (!series) { series = { accountId: input.accountId, platform: input.platform, metric: input.metric, format: input.format, points: [] }; all.push(series); index.set(key, series); }
      series.points = [...series.points.filter(x => x.date !== input.point.date && x.date >= cutoff), input.point].sort((a, b) => a.date.localeCompare(b.date)).slice(-180);
    }
    this.health.inbox.putSetting("change.metricSeries", JSON.stringify(all));
  }
  collect(): void {
    const today = this.now().toISOString().slice(0, 10);
    const cutoff = new Date(this.now().getTime() - (this.series().length ? 2 : 180) * 86_400_000).toISOString().slice(0, 10) + "T00:00:00.000Z";
    const rows = this.db.prepare(`SELECT a.id AS account_id, a.platform, s.publication_id, s.fetched_at, p.published_at,
      s.views, s.avg_view_pct, s.raw, j.settings FROM publication_metrics_snapshots s
      JOIN publications p ON p.id = s.publication_id JOIN platform_accounts a ON a.id = p.account_id
      JOIN projects j ON j.id = p.project_id WHERE s.fetched_at >= ? AND s.fetched_at < ? AND p.published_at IS NOT NULL ORDER BY s.fetched_at`)
      .all(cutoff, today + "T00:00:00.000Z") as Snapshot[];
    const latest = new Map<string, Snapshot>();
    for (const row of rows) latest.set(`${row.publication_id}:${row.fetched_at.slice(0, 10)}`, row);
    const groups = new Map<string, { accountId: string; platform: string; metric: string; format: string; date: string; values: number[]; revisions: Set<string>; definitions: Set<string> }>();
    const add = (row: Snapshot, metric: string, value: number | null, date = row.fetched_at.slice(0, 10)) => {
      if (date < cutoff.slice(0, 10) || date >= today) return;
      const raw = object(JSON.parse(row.raw)), settings = object(JSON.parse(row.settings));
      const format = typeof settings.format === "string" ? settings.format : "unknown";
      const definition = object(raw.metricDefinitions)[metric];
      for (const fmt of ["*", format]) {
        const key = JSON.stringify([row.account_id, metric, fmt, date]);
        const group = groups.get(key) ?? { accountId: row.account_id, platform: row.platform, metric, format: fmt, date, values: [], revisions: new Set<string>(), definitions: new Set<string>() };
        if (value !== null && Number.isFinite(value) && value >= 0) group.values.push(value);
        group.revisions.add(typeof raw.knowledgeRev === "string" ? raw.knowledgeRev : "unknown");
        group.definitions.add(typeof definition === "string" ? definition : metric === "views48h" ? "views-at-48h-tolerance-2h:v1" : `${metric}:latest-per-video-day:v1`);
        groups.set(key, group);
      }
    };
    for (const row of latest.values()) {
      const raw = object(JSON.parse(row.raw)), analytics = object(raw.analytics);
      const metrics: Record<string, number | null> = {
        ctr: numeric(raw.ctr ?? analytics.videoThumbnailImpressionsClickRate), avgViewPct: row.avg_view_pct,
        rpm: numeric(raw.rpm),
      };
      for (const [source, value] of Object.entries(object(raw.impressionsByTrafficSource))) metrics[`impressions:${source}`] = numeric(value);
      for (const [metric, value] of Object.entries(metrics)) add(row, metric, value);
    }
    // Pick the first observation in the 48–50 h window, not the last snapshot of that day.
    const at48h = new Map<string, Snapshot>(), byPublication = new Map<string, Snapshot>();
    for (const row of rows) {
      byPublication.set(row.publication_id, row);
      const age = Date.parse(row.fetched_at) - Date.parse(row.published_at);
      if (age >= 48 * 3_600_000 && age <= 50 * 3_600_000 && !at48h.has(row.publication_id)) at48h.set(row.publication_id, row);
    }
    for (const [id, latestRow] of byPublication) {
      const row = at48h.get(id), date = new Date(Date.parse(latestRow.published_at) + 48 * 3_600_000).toISOString().slice(0, 10);
      add(row ?? latestRow, "views48h", row?.views ?? null, date);
    }
    const samples: Sample[] = [...groups.values()].map(group => ({ ...group, point: {
      date: group.date, value: group.values.length && group.definitions.size === 1 ? group.values.reduce((a, b) => a + b, 0) / group.values.length : null,
      samples: group.values.length, knowledgeRev: [...group.revisions].sort().join(","), format: group.format,
      definition: [...group.definitions].sort().join("|"),
    } }));
    // Never divide partial per-video revenue by full-channel views. Both inputs must cover the same channel/day.
    for (const account of this.health.accounts()) {
      const revenue = JSON.parse(this.health.inbox.setting(`change.channelRevenue:${account.id}`) ?? "[]") as ChannelRevenuePoint[];
      for (const row of revenue) {
        if (row.date >= today) continue;
        const views = this.db.prepare("SELECT views FROM channel_metrics_daily WHERE account_id=? AND date=?").get(account.id, row.date) as { views: number | null } | undefined;
        samples.push({ accountId: account.id, platform: account.platform, metric: "rpm", format: "*", point: {
          date: row.date, value: views?.views && views.views > 0 ? 1000 * row.revenueUsd / views.views : null, samples: views?.views ?? 0,
          knowledgeRev: "unknown", format: "*", definition: "usd-revenue-per-thousand-channel-views-day:v1",
        } });
      }
    }
    // Owner-confirmed dashboard rows remain authoritative after a later automatic sync.
    const manual = JSON.parse(this.health.inbox.setting("change.manualMetrics") ?? "[]") as Sample[];
    if (samples.length || manual.length) this.recordBatch([...samples, ...manual]);
  }
  run(): number {
    this.collect();
    const series = this.series(), accounts = this.health.accounts();
    const configured = Number(this.health.inbox.setting("change.drift.minSamples") ?? 3);
    const minSamples = Number.isInteger(configured) && configured >= 1 && configured <= 1000 ? configured : 3;
    const analysed = series.map(s => {
      const reset = this.health.inbox.setting(`change.drift.reset:${s.accountId}:${s.metric}:${s.format}`);
      const recent = s.points.at(-1)?.date;
      return { series: s, shift: recent && recent >= new Date(this.now().getTime() - 2 * 86_400_000).toISOString().slice(0, 10)
        ? metricDrift(s.points.filter(p => !reset || p.date > reset), minSamples) : null };
    });
    let emitted = 0;
    this.compareIndustry(series, minSamples);
    for (const { series: s, shift } of analysed) {
      if (!shift) continue;
      const peers = accounts.filter(a => a.platform === s.platform);
      const allPlatformChannels = s.format === "*" && peers.length >= 2 && peers.every(a => analysed.some(x =>
        x.series.accountId === a.id && x.series.metric === s.metric && x.series.format === "*"
        && x.shift?.date === shift.date && x.shift.direction === shift.direction && x.series.points.at(-1)?.definition === s.points.at(-1)?.definition));
      const otherFormats = analysed.filter(x => x.series.accountId === s.accountId && x.series.metric === s.metric && x.series.format !== "*" && x.series.format !== s.format);
      const oneFormat = s.format !== "*" && s.format !== "unknown" && otherFormats.length > 0 && otherFormats.every(x => x.series.points.filter(p => p.samples >= minSamples && p.value !== null).length >= 17
        && x.series.points.at(-1)?.date === s.points.at(-1)?.date && x.series.points.at(-1)?.definition === s.points.at(-1)?.definition && !x.shift);
      const likelyCategory = driftCategory({ knowledgeChanged: shift.knowledgeChanged, allPlatformChannels, oneFormat });
      this.health.inbox.record({ category: "E4", detector: "D4", subject: { type: "metric", id: `${s.accountId}:${s.metric}:${s.format}` },
        summary: `${s.platform}: ${s.metric} ${shift.direction === "down" ? "giảm" : "tăng"} có xác nhận, cần điều tra`,
        evidence: { accountId: s.accountId, metric: s.metric, format: s.format, ...shift, likelyCategory,
          likelyCause: shift.knowledgeChanged ? "our_change" : allPlatformChannels ? "platform" : oneFormat ? "format" : "unknown",
          checks: ["So kênh khác", "So nền tảng khác", "So cùng tuần năm trước", "So knowledgeRev", "Đọc lỗi đồng bộ"] },
        severity: "high", fingerprint: `d4:${s.accountId}:${s.metric}:${s.format}:${shift.date}:${shift.direction}`, investigate: true,
      });
      this.health.inbox.putSetting(`change.drift.reset:${s.accountId}:${s.metric}:${s.format}`, this.now().toISOString().slice(0, 10));
      emitted++;
    }
    return emitted;
  }
  /** Measured evidence only creates a proposal; it never overwrites an industry prior. */
  contradicts(industry: KnowledgeEntry, measured: KnowledgeEntry, summary: string, fingerprint?: string): void {
    if (industry.id !== measured.id || industry.kind !== measured.kind
        || !industry.evidence.some(e => e.type === "industry") || !measured.evidence.some(e => e.type === "measured")) return;
    this.health.inbox.record({ category: "G1", detector: "D4", subject: { type: "knowledge", id: industry.id },
      summary, evidence: { before: industry.value, measured: measured.value, sources: measured.evidence },
      severity: "high", fingerprint: fingerprint ?? `d4:contradiction:${industry.id}:${JSON.stringify(measured.value)}`, proposal: measured, investigate: true });
  }
  private compareIndustry(series: Series[], minSamples: number): void {
    for (const { entry } of this.health.knowledge.list({ kind: "creator_tactic" })) {
      if (!entry.evidence.some(x => x.type === "industry")) continue;
      const value = KNOWLEDGE_VALUES.creator_tactic.parse(entry.value), baseline = value.metricBaseline;
      if (!baseline) continue;
      for (const s of series.filter(x => x.metric === baseline.metric && x.format === baseline.format)) {
        if (!entry.scope.platforms.some(x => x === "*" || x === s.platform.replace(/_reels$/, ""))) continue;
        const market = this.db.prepare("SELECT p.market FROM platform_accounts a JOIN profiles p ON p.id=a.profile_id WHERE a.id=?").get(s.accountId) as { market: string | null } | undefined;
        if (!entry.scope.markets.some(x => x === "*" || x === market?.market)) continue;
        const points = s.points.slice(-14);
        if (points.length !== 14 || points.at(-1)!.date < new Date(this.now().getTime() - 2 * 86_400_000).toISOString().slice(0, 10) || points.some((p, i) => p.value === null || p.samples < minSamples || p.definition !== baseline.definition
          || i > 0 && Date.parse(p.date) - Date.parse(points[i - 1]!.date) !== 86_400_000)) continue;
        const mean = points.reduce((sum, p) => sum + p.value!, 0) / points.length;
        if (mean >= baseline.min && mean <= baseline.max) continue;
        const measured: KnowledgeEntry = { ...entry, confidence: "medium",
          value: { ...value, metricBaseline: { ...baseline, observed: { accountId: s.accountId, mean,
            from: points[0]!.date, to: points.at(-1)!.date, samples: points.reduce((sum, p) => sum + p.samples, 0) } } },
          evidence: [...entry.evidence, { url: this.evidenceUrl, checkedAt: this.now().toISOString().slice(0, 10), type: "measured" }],
          notes: `${entry.notes ?? ""}\nSố đo riêng của một kênh ngoài khoảng tham khảo; cần điều tra, chưa thay khoảng chung.` };
        this.health.inbox.putSetting(`change.measured:${s.accountId}:${s.metric}:${entry.id}`, JSON.stringify(measured));
        this.contradicts(entry, measured, `${entry.id}: số đo kênh ngoài khoảng ngành; đề nghị đối chiếu`, `d4:contradiction:${entry.id}:${s.accountId}:${mean < baseline.min ? "low" : "high"}`);
      }
    }
  }
}
