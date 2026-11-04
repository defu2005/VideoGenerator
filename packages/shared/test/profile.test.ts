import { describe, expect, it } from "vitest";
import {
  PlatformAccountInputSchema,
  PublishSettingsSchema,
  ProfileDefaultBriefSchema,
  ProfileInputSchema,
  appendChannelDirection,
  channelDirectionBlock,
  defaultFormatForPlatform,
  mainAspectFromFormats,
  resolveAccountFormat,
} from "../src/index.js";

describe("profile schemas", () => {
  it("defaults account format by platform", () => {
    expect(defaultFormatForPlatform("youtube")).toBe("landscape");
    expect(defaultFormatForPlatform("tiktok")).toBe("vertical");
    expect(defaultFormatForPlatform("facebook_reels")).toBe("vertical");
    expect(defaultFormatForPlatform("instagram_reels")).toBe("vertical");
    expect(resolveAccountFormat("youtube")).toBe("landscape");
    expect(resolveAccountFormat("tiktok", "landscape")).toBe("landscape");
  });

  it("defaults autoPublish to false in publish settings", () => {
    expect(PublishSettingsSchema.parse({})).toMatchObject({
      visibility: "public",
      autoPublish: false,
    });
  });

  it("parses platform account input and profile defaults", () => {
    const account = PlatformAccountInputSchema.parse({
      platform: "youtube",
      displayName: "Lịch sử 5 phút",
    });
    expect(account.platform).toBe("youtube");
    expect(account.displayName).toBe("Lịch sử 5 phút");

    const brief = ProfileDefaultBriefSchema.parse({});
    expect(brief.mode).toBe("ASSISTED");
    expect(brief.autoRender).toBe(false);
    expect(brief.language).toBe("vi");

    expect(ProfileInputSchema.parse({ name: "Kênh A" }).name).toBe("Kênh A");
  });

  it("picks main aspect from account formats", () => {
    expect(mainAspectFromFormats([])).toBeUndefined();
    expect(mainAspectFromFormats(["vertical"])).toBe("9:16");
    expect(mainAspectFromFormats(["vertical", "landscape"])).toBe("16:9");
  });

  it("builds a truncated Định hướng kênh block", () => {
    expect(channelDirectionBlock(null)).toBe("");
    expect(channelDirectionBlock("  ")).toBe("");
    expect(channelDirectionBlock("Kênh lịch sử ngắn")).toBe("Định hướng kênh:\nKênh lịch sử ngắn");
    const long = "x".repeat(900);
    expect(channelDirectionBlock(long)!.length).toBe("Định hướng kênh:\n".length + 800);
    expect(appendChannelDirection("Topic: a", "Góc nhìn dân gian")).toContain("Định hướng kênh:\nGóc nhìn dân gian");
    expect(appendChannelDirection("Topic: a")).toBe("Topic: a");
  });
});
