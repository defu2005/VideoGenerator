import type Database from "better-sqlite3";
import {
  AppCurrencySchema,
  type AppCurrency,
  type CurrencyRate,
} from "@vg/shared";
import { buildRateTable, type RateTable } from "./profit.js";

const APP_CURRENCY_KEY = "finance.appCurrency";

export function getAppCurrency(sqlite: Database.Database): AppCurrency {
  const row = sqlite.prepare("SELECT value FROM app_settings WHERE key = ?").get(APP_CURRENCY_KEY) as
    | { value: string }
    | undefined;
  if (!row) return "VND";
  const value = typeof row.value === "string" ? JSON.parse(row.value) as unknown : row.value;
  const parsed = AppCurrencySchema.safeParse(value);
  return parsed.success ? parsed.data : "VND";
}

export function saveAppCurrency(sqlite: Database.Database, currency: AppCurrency): AppCurrency {
  const parsed = AppCurrencySchema.parse(currency);
  sqlite.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(APP_CURRENCY_KEY, JSON.stringify(parsed), new Date().toISOString());
  return parsed;
}

export function listCurrencyRates(sqlite: Database.Database): CurrencyRate[] {
  const rows = sqlite.prepare(
    "SELECT currency, rate_to_app_currency AS rateToAppCurrency, updated_at AS updatedAt FROM currency_rates ORDER BY currency",
  ).all() as Array<{ currency: string; rateToAppCurrency: number; updatedAt: string }>;
  return rows.map((r) => ({
    currency: r.currency,
    rateToAppCurrency: r.rateToAppCurrency,
    updatedAt: r.updatedAt,
  }));
}

export function upsertCurrencyRate(
  sqlite: Database.Database,
  currency: string,
  rateToAppCurrency: number,
  now = new Date(),
): CurrencyRate {
  const code = currency.toUpperCase();
  const updatedAt = now.toISOString();
  sqlite.prepare(
    `INSERT INTO currency_rates (currency, rate_to_app_currency, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(currency) DO UPDATE SET
       rate_to_app_currency = excluded.rate_to_app_currency,
       updated_at = excluded.updated_at`,
  ).run(code, rateToAppCurrency, updatedAt);
  return { currency: code, rateToAppCurrency, updatedAt };
}

export function deleteCurrencyRate(sqlite: Database.Database, currency: string): void {
  sqlite.prepare("DELETE FROM currency_rates WHERE currency = ?").run(currency.toUpperCase());
}

/** Seed USD→VND from config when the rates table is empty. */
export function ensureDefaultRates(
  sqlite: Database.Database,
  usdVndRate: number,
  now = new Date(),
): void {
  const appCurrency = getAppCurrency(sqlite);
  const existing = listCurrencyRates(sqlite);
  if (existing.length > 0) return;
  if (appCurrency === "VND" && usdVndRate > 0) {
    upsertCurrencyRate(sqlite, "USD", usdVndRate, now);
  } else if (appCurrency === "USD" && usdVndRate > 0) {
    upsertCurrencyRate(sqlite, "VND", 1 / usdVndRate, now);
  }
}

export function loadRateTable(sqlite: Database.Database, usdVndFallback?: number): {
  appCurrency: AppCurrency;
  rates: RateTable;
} {
  const appCurrency = getAppCurrency(sqlite);
  let rows = listCurrencyRates(sqlite);
  if (rows.length === 0 && usdVndFallback && usdVndFallback > 0) {
    ensureDefaultRates(sqlite, usdVndFallback);
    rows = listCurrencyRates(sqlite);
  }
  return {
    appCurrency,
    rates: buildRateTable(rows, appCurrency),
  };
}
