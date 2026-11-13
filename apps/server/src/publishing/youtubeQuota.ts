import type Database from "better-sqlite3";
import { ApiContractSchema, snapshotKnowledge } from "@vg/shared";
import type { KnowledgeService } from "../knowledge/service.js";

const SETTINGS_KEY = "youtubeQuota";
const contracts = {
  general: "youtube.data.quota",
  "videos.insert": "youtube.data.videos_insert",
  "search.list": "youtube.data.search_list",
} as const;
type Bucket = keyof typeof contracts;

export type YoutubeQuotaState = { date: string; used: number };

export function pacificDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function nextPacificMidnightIso(now: Date = new Date()): string {
  const today = pacificDateKey(now);
  let lo = now.getTime();
  let hi = lo + 36 * 3600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDateKey(new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi).toISOString();
}

export class YoutubeQuotaTracker {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly dailyLimit: number,
    private readonly now: () => Date = () => new Date(),
    private readonly knowledge?: KnowledgeService,
  ) {}

  private contract(bucket: Bucket) {
    const id = contracts[bucket];
    const fallback = ApiContractSchema.parse(snapshotKnowledge(id)!.value);
    const value = ApiContractSchema.safeParse(this.knowledge?.value(id, fallback));
    return value.data?.quota ? value.data : fallback;
  }

  getLimit(bucket: Bucket = "general"): number {
    const limit = this.contract(bucket).quota!.limit;
    return bucket === "general" ? Math.min(limit, this.dailyLimit) : limit;
  }

  cost(method: string, bucket: Bucket = "general"): number {
    const contract = this.contract(bucket);
    return contract.methodCosts?.[method] ?? contract.quota!.cost;
  }

  getState(bucket: Bucket = "general"): YoutubeQuotaState {
    return this.read(bucket, pacificDateKey(this.now()));
  }

  wouldExceed(units: number, bucket: Bucket = "general"): boolean {
    return units > this.remaining(bucket);
  }

  remaining(bucket: Bucket = "general"): number {
    return Math.max(0, this.getLimit(bucket) - this.getState(bucket).used);
  }

  /** Reserve before issuing the request so concurrent jobs cannot spend the same last slot. */
  charge(method: string, bucket: Bucket = "general"): boolean {
    return this.sqlite.transaction(() => {
      const units = this.cost(method, bucket);
      const now = this.now();
      const today = pacificDateKey(now);
      const { used } = this.read(bucket, today);
      if (used + units > this.getLimit(bucket)) return false;
      this.save({ date: today, used: used + units }, bucket, now);
      return true;
    }).immediate();
  }

  record(units: number, bucket: Bucket = "general"): void {
    this.sqlite.transaction(() => {
      const now = this.now();
      const date = pacificDateKey(now);
      this.save({ date, used: this.read(bucket, date).used + units }, bucket, now);
    }).immediate();
  }

  setUsed(used: number, date = pacificDateKey(this.now()), bucket: Bucket = "general"): void {
    this.save({ date, used }, bucket, this.now());
  }

  private key(bucket: Bucket): string {
    const name = this.contract(bucket).quota!.bucket;
    return name === "general" ? SETTINGS_KEY : `${SETTINGS_KEY}.${name}`;
  }

  private read(bucket: Bucket, date: string): YoutubeQuotaState {
    const row = this.sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(this.key(bucket)) as { value: string } | undefined;
    if (row) {
      try {
        const value = JSON.parse(row.value) as YoutubeQuotaState;
        if (value.date === date && Number.isFinite(value.used)) return { date, used: value.used };
      } catch {
        // A stale/corrupt local counter has no usable observation for this bucket.
      }
    }
    return { date, used: 0 };
  }

  private save(value: YoutubeQuotaState, bucket: Bucket, now: Date): void {
    this.sqlite.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(this.key(bucket), JSON.stringify(value), now.toISOString());
  }
}
