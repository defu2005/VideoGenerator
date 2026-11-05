import { describe, expect, it } from "vitest";
import {
  featureForPathname,
  featureMap,
  helpHref,
  searchUserGuide,
  type GuideSection,
} from "../src/index.js";

const sections: GuideSection[] = [
  {
    page: "mo-hinh-ai",
    anchor: "quota",
    title: "Quota",
    text: "Hết hạn mức miễn phí thì chờ reset. Chính sách mặc định là Chờ reset.",
  },
  {
    page: "tro-ly-va-telegram",
    anchor: "telegram",
    title: "Kết nối Telegram",
    text: "Mở Thông báo, dán token bot, bấm Ghép nối rồi Gửi thử.",
  },
  {
    page: "dang-bai",
    anchor: "tai-khoan",
    title: "Tài khoản nền tảng",
    text: "Bấm Kết nối để OAuth. Không dán token vào ô chat.",
  },
];

describe("searchUserGuide", () => {
  it("ranks the matching section first", () => {
    const hits = searchUserGuide(sections, "làm sao để kết nối Telegram");
    expect(hits[0]?.anchor).toBe("telegram");
    expect(hits[0]?.href).toBe("/help/tro-ly-va-telegram#telegram");
    expect(hits[0]?.title).toBe("Kết nối Telegram");
  });

  it("ranks a title match above a passing mention", () => {
    const hits = searchUserGuide(sections, "quota");
    expect(hits[0]?.anchor).toBe("quota");
  });
});

describe("feature help links", () => {
  it("resolves a help href for every routed feature", () => {
    for (const feature of featureMap) {
      for (const route of feature.webRoutes) {
        const sample = route.replace(/:[A-Za-z]+/g, "x");
        const match = featureForPathname(sample);
        expect(match, route).toBeTruthy();
        expect(helpHref(match!)).toMatch(/^\/help\/[A-Za-z0-9-]+#[A-Za-z0-9-]+$/);
      }
    }
  });

  it("keeps the primary section when several features share a route", () => {
    expect(featureForPathname("/settings/ai")?.key).toBe("ai-routes");
    expect(featureForPathname("/profiles/x/automation")?.key).toBe("automation");
    expect(helpHref(featureForPathname("/settings/ai")!)).toBe("/help/mo-hinh-ai#dinh-tuyen");
  });
});
