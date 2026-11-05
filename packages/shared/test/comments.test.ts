import { describe, expect, it } from "vitest";
import {
  AUTO_REPLY_MAX_AGE_MS,
  autoReplyDenial,
  commentSyncDue,
  commentSyncIntervalMs,
  normalizeCommentText,
  spamReason,
  youtubeReplyQuotaBlocked,
} from "../src/comments/index.js";

const now = new Date("2026-11-05T12:00:00.000Z");

describe("comment spam pre-filter", () => {
  it("catches links, phones, repeats and phrases", () => {
    expect(spamReason("xem http://spam.test/a", [])).toBe("link");
    expect(spamReason("gọi 0901 234 567 ngay", [])).toBe("phone");
    expect(spamReason("tuyệt vời!!!!!!", [])).toBe("repeat");
    expect(spamReason("mua mua mua mua ngay", [])).toBe("repeat");
    expect(spamReason("Kiếm Tiền Nhanh hôm nay", ["kiếm tiền nhanh"])).toBe("phrase");
    expect(spamReason("Video rất hay", ["kiếm tiền nhanh"])).toBeNull();
  });

  it("normalizes duplicate text", () => {
    expect(normalizeCommentText("  Xin   Chào  ")).toBe("xin chào");
  });
});

describe("comment auto-reply policy", () => {
  const base = {
    mode: "auto_reply" as const,
    classification: "praise" as const,
    toxic: false,
    confidence: "high" as const,
    priority: 30,
    publishedAtMs: now.getTime() - 60_000,
    nowMs: now.getTime(),
    repliesTodayForVideo: 0,
    repliesTodayForAccount: 0,
    perVideoLimit: 10,
    perAccountLimit: 30,
    authorAlreadyReplied: false,
    replyTextUsed: false,
    replyText: "Cảm ơn bạn!",
  };

  it("allows a fresh high-confidence praise", () => {
    expect(autoReplyDenial(base)).toBeNull();
  });

  it("blocks limits, age, author, duplicate text, complaint and toxic", () => {
    expect(autoReplyDenial({ ...base, repliesTodayForVideo: 10 })).toBe("video_limit");
    expect(autoReplyDenial({ ...base, repliesTodayForAccount: 30 })).toBe("account_limit");
    expect(autoReplyDenial({ ...base, authorAlreadyReplied: true })).toBe("author");
    expect(autoReplyDenial({ ...base, replyTextUsed: true })).toBe("duplicate");
    expect(autoReplyDenial({ ...base, publishedAtMs: now.getTime() - AUTO_REPLY_MAX_AGE_MS - 1000 })).toBe("age");
    expect(autoReplyDenial({ ...base, classification: "complaint" })).toBe("classification");
    expect(autoReplyDenial({ ...base, classification: "request" })).toBe("classification");
    expect(autoReplyDenial({ ...base, toxic: true })).toBe("toxic");
    expect(autoReplyDenial({ ...base, classification: "question", priority: 80 })).toBe("classification");
    expect(autoReplyDenial({ ...base, mode: "off" })).toBe("mode");
  });
});

describe("comment sync interval", () => {
  it("is 30 minutes, 6 hours, then daily", () => {
    expect(commentSyncIntervalMs(new Date(now.getTime() - 2 * 24 * 3600_000), now)).toBe(30 * 60 * 1000);
    expect(commentSyncIntervalMs(new Date(now.getTime() - 10 * 24 * 3600_000), now)).toBe(6 * 3600_000);
    expect(commentSyncIntervalMs(new Date(now.getTime() - 40 * 24 * 3600_000), now)).toBe(24 * 3600_000);
    expect(commentSyncDue(now, null, now)).toBe(true);
    expect(commentSyncDue(now, new Date(now.getTime() - 10 * 60 * 1000), now)).toBe(false);
  });

  it("stops YouTube replies under 20% quota", () => {
    expect(youtubeReplyQuotaBlocked(1999, 10_000)).toBe(true);
    expect(youtubeReplyQuotaBlocked(2000, 10_000)).toBe(false);
  });
});
