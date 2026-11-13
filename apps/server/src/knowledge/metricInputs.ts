import type Database from "better-sqlite3";
import { ChangeInbox } from "./changeInbox.js";

export type ChannelRevenuePoint = { date: string; revenueUsd: number; fetchedAt: string };

/** Full-channel observations, including explicit zero rows, kept apart from the financial ledger. */
export function recordChannelRevenue(db: Database.Database, accountId: string, rows: Array<{ date: string; estimatedRevenue: number }>, fetchedAt: string) {
  const inbox = new ChangeInbox(db, () => new Date(fetchedAt)), key = `change.channelRevenue:${accountId}`;
  const prior = JSON.parse(inbox.setting(key) ?? "[]") as ChannelRevenuePoint[];
  const byDate = new Map(prior.map(x => [x.date, x]));
  for (const row of rows) if (Number.isFinite(row.estimatedRevenue) && row.estimatedRevenue >= 0) {
    byDate.set(row.date, { date: row.date, revenueUsd: row.estimatedRevenue, fetchedAt });
  }
  inbox.putSetting(key, JSON.stringify([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180)));
}
