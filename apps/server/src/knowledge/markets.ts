import {
  MarketPackSchema, listMarkets, marketDefaults, marketName, marketPlatform, type PlatformId,
} from "@vg/shared";
import type Database from "better-sqlite3";
import { KnowledgeService } from "./service.js";
import { AppError } from "../lib/errors.js";

export function resolveMarket(sqlite: Database.Database, code?: string | null) {
  if (!code) return null;
  const resolved = new KnowledgeService(sqlite).get(`market.${code}`);
  if (resolved?.entry.kind !== "market") return null;
  return { ...resolved, pack: MarketPackSchema.parse(resolved.entry.value) };
}

export function requireMarket(sqlite: Database.Database, code: string) {
  const market = resolveMarket(sqlite, code);
  if (!market) throw new AppError(400, "UNKNOWN_MARKET", "Thị trường này chưa có dữ kiện đang áp dụng.");
  return market;
}

export function listResolvedMarkets(sqlite: Database.Database) {
  const entries = new KnowledgeService(sqlite).list({ kind: "market" });
  return listMarkets(entries.map(({ entry }) => MarketPackSchema.parse(entry.value)));
}

export function getMarketInfo(sqlite: Database.Database, code: string) {
  const { pack, freshness, reviewAfter } = requireMarket(sqlite, code);
  return { pack, freshness, reviewAfter, defaults: marketDefaults(pack, ["youtube", "tiktok", "facebook_reels", "instagram_reels"]) };
}

export function marketAccountWarning(sqlite: Database.Database, code: string | null | undefined, platform: PlatformId) {
  const market = resolveMarket(sqlite, code);
  if (!market) return null;
  const availability = marketPlatform(market.pack, platform);
  if (availability?.available !== false) return null;
  return `Theo dữ kiện thị trường ${marketName(market.pack)}, nền tảng này chưa khả dụng. ${availability.note ?? ""}`.trim();
}
