import { describe, expect, it } from "vitest";
import { isDue, syncIntervalMs } from "../src/analytics/freshness.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe("syncIntervalMs", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");

  it("returns 2h for publications younger than 48h", () => {
    expect(syncIntervalMs(new Date(now.getTime() - 1 * HOUR), now)).toBe(2 * HOUR);
    expect(syncIntervalMs(new Date(now.getTime() - 47 * HOUR), now)).toBe(2 * HOUR);
  });

  it("returns 12h for age in [48h, 14d)", () => {
    expect(syncIntervalMs(new Date(now.getTime() - 48 * HOUR), now)).toBe(12 * HOUR);
    expect(syncIntervalMs(new Date(now.getTime() - 13 * DAY), now)).toBe(12 * HOUR);
  });

  it("returns 1d for age in [14d, 90d)", () => {
    expect(syncIntervalMs(new Date(now.getTime() - 14 * DAY), now)).toBe(DAY);
    expect(syncIntervalMs(new Date(now.getTime() - 89 * DAY), now)).toBe(DAY);
  });

  it("returns 7d for age >= 90d", () => {
    expect(syncIntervalMs(new Date(now.getTime() - 90 * DAY), now)).toBe(7 * DAY);
    expect(syncIntervalMs(new Date(now.getTime() - 400 * DAY), now)).toBe(7 * DAY);
  });

  it("treats future publishedAt as age 0 (2h cadence)", () => {
    expect(syncIntervalMs(new Date(now.getTime() + DAY), now)).toBe(2 * HOUR);
  });
});

describe("isDue", () => {
  const now = new Date("2026-11-05T12:00:00.000Z");
  const publishedRecent = new Date(now.getTime() - 3 * HOUR); // 2h cadence

  it("is due when never synced", () => {
    expect(isDue(publishedRecent, null, now)).toBe(true);
    expect(isDue(publishedRecent, undefined, now)).toBe(true);
  });

  it("is not due when last sync is within the interval", () => {
    const last = new Date(now.getTime() - 1 * HOUR);
    expect(isDue(publishedRecent, last, now)).toBe(false);
  });

  it("is due when elapsed >= interval for young pubs", () => {
    const last = new Date(now.getTime() - 2 * HOUR);
    expect(isDue(publishedRecent, last, now)).toBe(true);
  });

  it("uses weekly interval for old pubs", () => {
    const publishedOld = new Date(now.getTime() - 100 * DAY);
    const lastFresh = new Date(now.getTime() - 3 * DAY);
    const lastStale = new Date(now.getTime() - 7 * DAY);
    expect(isDue(publishedOld, lastFresh, now)).toBe(false);
    expect(isDue(publishedOld, lastStale, now)).toBe(true);
  });

  it("boundary: exactly at interval is due", () => {
    const publishedMid = new Date(now.getTime() - 20 * DAY); // daily cadence
    const last = new Date(now.getTime() - DAY);
    expect(isDue(publishedMid, last, now)).toBe(true);
  });
});
