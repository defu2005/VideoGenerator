import { describe, expect, it } from "vitest";
import { activeGuidelines } from "../src/guidelines/resolve.js";
import { listMarkets, marketDefaults, marketPack, marketVoiceLocale, upcomingEvents } from "../src/markets/index.js";
import { MarketPackSchema } from "../src/markets/schema.js";
import { ProjectSettingsSchema } from "../src/schemas/project.js";

describe("market packs", () => {
  it("validates each market and derives defaults from platform hours", () => {
    const markets = listMarkets();
    expect(markets).toHaveLength(17);
    for (const { code } of markets) expect(MarketPackSchema.safeParse(marketPack(code)).success, code).toBe(true);
    expect(listMarkets([{ ...marketPack("GB")!, name: { en: "United Kingdom" } }])[0]?.name).toBeTruthy();
    expect(marketDefaults("GB", ["tiktok"], 2)).toMatchObject({
      language: "en", timezone: "Europe/London", publishTimes: ["15:00", "23:00"],
      trendSettings: { region: "GB", language: "en" }, voiceLocale: "en-GB", guidelinePackId: "market:GB",
    });
    expect(marketDefaults("GB", ["tiktok"], 1)?.publishTimes).toEqual(["15:00"]);
    expect(marketDefaults("GB", ["youtube"])?.publishTimes).toBeNull();
    expect(marketDefaults("ZZ")).toBeNull();
    expect(marketVoiceLocale(marketPack("GB"), "en")).toBe("en-GB");
    expect(marketVoiceLocale(marketPack("GB"), "vi")).toBe("vi");
    expect(marketVoiceLocale(marketPack("GB"), "en-US")).toBe("en-US");
  });

  it("resolves exact dates, recurring month/day and weekday rules across a year boundary", () => {
    const pack = { ...marketPack("GB")!, seasonalEvents: [
      { name: "Exact", type: "holiday", date: "2026-12-25" },
      { name: "Annual", type: "holiday", date: "01-01" },
      { name: "Nth", type: "holiday", date: "1st Monday of January" },
      { name: "Last", type: "holiday", date: "last Thursday of December" },
      { name: "Old", type: "holiday", date: "2025-12-25" },
      { name: "Invalid", type: "holiday", date: "02-30" },
    ] };
    expect(upcomingEvents(pack, new Date("2026-12-25"), 10).map(({ name, date }) => [name, date])).toEqual([
      ["Exact", "2026-12-25"], ["Last", "2026-12-31"], ["Annual", "2027-01-01"], ["Nth", "2027-01-04"],
    ]);
    expect(upcomingEvents(pack, new Date("2027-02-20"), 20)).toEqual([]);
  });

  it("inserts market rules after the platform and honours user packs", () => {
    const settings = ProjectSettingsSchema.parse({ platform: "youtube", market: "GB" });
    const without = activeGuidelines({ settings: { ...settings, market: undefined } });
    const withMarket = activeGuidelines({ settings });
    expect(withMarket.packs.slice(0, 2).map(({ id }) => id)).toEqual(["youtube", "market:GB"]);
    expect(without.packs.some(({ kind }) => kind === "MARKET")).toBe(false);
    const marketRules = withMarket.packs[1]!;
    expect(marketRules.rules.map(({ id }) => id)).toEqual(marketPack("GB")!.rules.map(({ id }) => id));
    expect(activeGuidelines({ settings }, [{ ...marketRules, kind: "CUSTOM", rules: [] }]).packs[1]?.rules).toEqual([]);
  });
});
