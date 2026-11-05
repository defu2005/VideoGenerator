import { describe, expect, it } from "vitest";
import {
  ProfileAutomationSchema,
  TopicSuggestOutputSchema,
  countFreeFutureSlots,
  dedupeTopicSuggestions,
  enumerateSlots,
  localDateString,
  normalizeTopicText,
  pickNextFreePublishSlot,
  pickNextProductionSlot,
  topicSimilarity,
  zonedLocalToUtc,
} from "../src/index.js";

const automation = ProfileAutomationSchema.parse({
  enabled: true,
  timezone: "Asia/Ho_Chi_Minh",
  videosPerDay: 2,
  publishTimes: ["09:00", "19:00"],
  leadTimeHours: 6,
});

describe("profile automation schemas", () => {
  it("defaults automation and topicSuggest payload shapes", () => {
    expect(ProfileAutomationSchema.parse({})).toMatchObject({
      enabled: false,
      timezone: "Asia/Ho_Chi_Minh",
      videosPerDay: 1,
      publishTimes: ["19:00"],
      leadTimeHours: 6,
      autoSuggest: false,
      autoApproveTopics: false,
      accountIds: null,
      autoShorts: false,
      shortsPerVideo: 3,
    });
    expect(TopicSuggestOutputSchema.parse({
      topics: [{ topic: "Ai cập cổ đại", angle: "kim tự tháp" }],
    }).topics).toHaveLength(1);
  });
});

describe("topic dedupe", () => {
  it("normalises text and rejects high token overlap", () => {
    expect(normalizeTopicText("  Ai-Cập  Cổ Đại!!! ")).toBe("ai cap co đai");
    expect(topicSimilarity("kim tu thap ai cap", "kim tu thap o ai cap")).toBeGreaterThan(0.7);
    const { kept, rejected } = dedupeTopicSuggestions(
      [
        { topic: "Kim tự tháp Ai Cập" },
        { topic: "Kim tu thap Ai Cap" },
        { topic: "Vũ trụ xa xôi" },
        { topic: "Ai Cập — góc 1" },
        { topic: "Ai Cập — góc 2" },
      ],
      ["Kim tự tháp Ai Cập thời cổ"],
    );
    expect(kept.map((item) => item.topic)).toEqual([
      "Vũ trụ xa xôi",
      "Ai Cập — góc 1",
      "Ai Cập — góc 2",
    ]);
    expect(rejected).toBe(2);
  });
});

describe("slot planning", () => {
  it("converts Asia/Ho_Chi_Minh local times to UTC", () => {
    // 19:00 ICT = 12:00 UTC
    const at = zonedLocalToUtc("2026-11-04", "19:00", "Asia/Ho_Chi_Minh");
    expect(at.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(localDateString(at, "Asia/Ho_Chi_Minh")).toBe("2026-11-04");
  });

  it("enumerates sorted slots for the next days", () => {
    const now = new Date("2026-11-04T01:00:00.000Z"); // 08:00 ICT
    const slots = enumerateSlots(now, automation, 2);
    expect(slots.map((slot) => slot.at.toISOString())).toEqual([
      "2026-11-04T02:00:00.000Z", // 09:00 ICT
      "2026-11-04T12:00:00.000Z", // 19:00 ICT
      "2026-11-05T02:00:00.000Z",
      "2026-11-05T12:00:00.000Z",
    ]);
  });

  it("starts production within lead time and respects the daily cap", () => {
    // 14:00 ICT — 19:00 slot is within 6h lead; 09:00 already passed.
    const now = new Date("2026-11-04T07:00:00.000Z");
    const pick = pickNextProductionSlot({
      now,
      automation,
      assignedSlotIsos: [],
      productionsStartedToday: 0,
    });
    expect(pick?.slot.at.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(pick?.rescheduled).toBe(true);

    expect(pickNextProductionSlot({
      now,
      automation,
      assignedSlotIsos: [],
      productionsStartedToday: 2,
    })).toBeNull();
  });

  it("does not start before the lead window", () => {
    // 08:00 ICT — next free is 09:00 but lead is 6h; 09:00 - 6h = 03:00, so we ARE in window for 09:00.
    // Use early morning before lead for 09:00: 02:00 ICT = previous day 19:00+7h... 
    // 09:00 - 6h = 03:00 ICT. At 02:30 ICT we should wait.
    const now = new Date("2026-11-03T19:30:00.000Z"); // 02:30 ICT on Nov 4
    expect(localDateString(now, "Asia/Ho_Chi_Minh")).toBe("2026-11-04");
    expect(pickNextProductionSlot({
      now,
      automation,
      assignedSlotIsos: [],
      productionsStartedToday: 0,
    })).toBeNull();
  });

  it("skips assigned slots and never picks a past publish time", () => {
    const now = new Date("2026-11-04T10:00:00.000Z"); // 17:00 ICT
    const assigned = ["2026-11-04T12:00:00.000Z"]; // tonight 19:00 already taken
    const pick = pickNextProductionSlot({
      now,
      automation,
      assignedSlotIsos: assigned,
      productionsStartedToday: 0,
    });
    // Next free is tomorrow 09:00, but lead for that is 03:00 tomorrow — not yet due.
    expect(pick).toBeNull();

    const later = new Date("2026-11-04T22:00:00.000Z"); // 05:00 ICT Nov 5 — within lead for 09:00
    const next = pickNextProductionSlot({
      now: later,
      automation,
      assignedSlotIsos: assigned,
      productionsStartedToday: 0,
    });
    expect(next?.slot.at.toISOString()).toBe("2026-11-05T02:00:00.000Z");
  });

  it("counts free future slots for autoSuggest", () => {
    const now = new Date("2026-11-04T07:00:00.000Z");
    expect(countFreeFutureSlots({
      now,
      automation,
      assignedSlotIsos: ["2026-11-04T12:00:00.000Z"],
      days: 3,
    })).toBe(4); // 3 days × 2 slots − past 09:00 − assigned 19:00 = 4 future free
  });

  it("picks the next free future publish slot (≥5 min ahead, videosPerDay)", () => {
    const now = new Date("2026-11-04T12:10:00.000Z"); // 19:10 ICT — tonight 19:00 missed
    const next = pickNextFreePublishSlot({
      now,
      automation,
      assignedSlotIsos: [],
      minAheadMs: 5 * 60 * 1000,
    });
    expect(next?.at.toISOString()).toBe("2026-11-05T02:00:00.000Z"); // tomorrow 09:00 ICT

    const capped = pickNextFreePublishSlot({
      now: new Date("2026-11-04T07:00:00.000Z"),
      automation: { ...automation, videosPerDay: 1 },
      assignedSlotIsos: ["2026-11-04T12:00:00.000Z"], // tonight already full for the day
      minAheadMs: 5 * 60 * 1000,
    });
    // Same local day already at videosPerDay → jump to tomorrow 09:00
    expect(capped?.at.toISOString()).toBe("2026-11-05T02:00:00.000Z");
  });
});
