import { describe, expect, it } from "vitest";
import {
  ProfileAutomationSchema,
  alignCuesToCut,
  buildClipFfmpegArgs,
  fallbackClipPicks,
  hookOverlayWindow,
  isVerticalClipAccount,
  parseSrt,
  reframeSegments,
  shiftSubtitleCues,
  spreadClipSlots,
  startsMidThought,
  validateClipPicks,
  type TranscriptSentence,
} from "../src/index.js";

const sentences: TranscriptSentence[] = [
  { start: 0, end: 15, text: "Mở đầu rõ ràng cho người xem." },
  { start: 15, end: 35, text: "Sự kiện chính diễn ra với chi tiết." },
  { start: 35, end: 55, text: "Một ý độc lập đủ dài ở đây." },
  { start: 55, end: 75, text: "Kết thúc gọn và rõ ý chính." },
];

describe("clip validation", () => {
  it("snaps start and end to sentence edges", () => {
    const [clip] = validateClipPicks({
      clips: [{ start: 16, end: 50, hook: "Sự kiện", title: "Sự kiện chính", reason: "Rõ", score: 80 }],
      sentences,
      minSec: 20,
      maxSec: 45,
      limit: 3,
    });
    expect(clip).toMatchObject({ start: 15, end: 55 });
  });

  it("drops a clip that cannot fit the length range", () => {
    const clips = validateClipPicks({
      clips: [{ start: 1, end: 8, hook: "Ngắn", title: "Ngắn", reason: "Ngắn", score: 50 }],
      sentences: [{ start: 0, end: 10, text: "Mở đầu rõ." }],
      minSec: 20,
      maxSec: 45,
      limit: 3,
    });
    expect(clips).toEqual([]);
  });

  it("drops the lower-score clip when overlap is above 20 percent", () => {
    const clips = validateClipPicks({
      clips: [
        { start: 1, end: 34, hook: "Mở", title: "Đoạn đầu", reason: "Điểm cao", score: 90 },
        { start: 20, end: 50, hook: "Giữa", title: "Đoạn giữa", reason: "Điểm thấp", score: 40 },
      ],
      sentences,
      minSec: 20,
      maxSec: 45,
      limit: 4,
    });
    expect(clips.map((clip) => clip.title)).toEqual(["Đoạn đầu"]);
  });

  it("rejects a mid-thought opening unless the hook covers it", () => {
    const mid: TranscriptSentence[] = [
      { start: 0, end: 25, text: "và câu này nối từ ý trước khá dài." },
      { start: 25, end: 55, text: "Ý mới bắt đầu rõ ràng ở đây." },
    ];
    const rejected = validateClipPicks({
      clips: [{ start: 1, end: 24, hook: "", title: "Nối", reason: "Nối", score: 70 }],
      sentences: mid,
      minSec: 20,
      maxSec: 45,
      limit: 2,
    });
    expect(rejected).toEqual([]);
    expect(startsMidThought("và tiếp")).toBe(true);
    expect(startsMidThought("hello")).toBe(true);
    expect(startsMidThought("Mở đầu")).toBe(false);
    const kept = validateClipPicks({
      clips: [{ start: 1, end: 24, hook: "Nối ý", title: "Nối", reason: "Có hook", score: 70 }],
      sentences: mid,
      minSec: 20,
      maxSec: 45,
      limit: 2,
    });
    expect(kept[0]?.hook).toBe("Nối ý");
  });
});

describe("fallback clip picker", () => {
  it("picks high-density sentences near scene starts without an LLM", () => {
    const clips = fallbackClipPicks({
      sentences: [
        { start: 0, end: 24, text: "Kính thiên văn Hubble phát hiện thiên hà xa." },
        { start: 24, end: 30, text: "và tiếp tục ý cũ." },
        { start: 40, end: 68, text: "Tinh vân Orion phát sáng màu xanh lam." },
      ],
      sceneStarts: [0, 40],
      minSec: 20,
      maxSec: 45,
      count: 3,
    });
    expect(clips).toHaveLength(2);
    expect(clips[0]?.start).toBe(0);
    expect(clips[1]?.start).toBe(40);
    expect(clips.every((clip) => clip.end - clip.start >= 20 && clip.end - clip.start <= 45)).toBe(true);
  });
});

describe("clip ffmpeg plan", () => {
  it("builds a center crop command and a blur-fill command", () => {
    const center = buildClipFfmpegArgs({
      inputPath: "in.mp4",
      outputPath: "out.mp4",
      clipStart: 10,
      clipEnd: 40,
      mode: "center",
    });
    expect(center.cutStart).toBeCloseTo(9.85);
    expect(center.cutEnd).toBeCloseTo(40.25);
    expect(center.args).toEqual([
      "-y",
      "-ss", "9.850",
      "-to", "40.250",
      "-i", "in.mp4",
      "-filter_complex", "[0:v]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920,setsar=1[base];[base]null[vout]",
      "-map", "[vout]",
      "-map", "0:a?",
      "-af", "afade=t=in:st=0:d=0.150,afade=t=out:st=30.250:d=0.150,loudnorm=I=-14:TP=-1.5:LRA=11",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "out.mp4",
    ]);
    const blur = buildClipFfmpegArgs({
      inputPath: "in.mp4",
      outputPath: "out.mp4",
      clipStart: 10,
      clipEnd: 40,
      mode: "blur-fill",
      subtitlePath: "C:/proj/clip.ass",
      hookTextPath: "C:/proj/hook.txt",
      fontFile: "C:/Windows/Fonts/arial.ttf",
    });
    expect(blur.filter).toContain("gblur=sigma=24");
    expect(blur.filter).toContain("scale=1080:-2");
    expect(blur.filter).toContain("ass='C\\:/proj/clip.ass'");
    expect(blur.filter).toContain("enable='between(t,0,2)'");
    expect(hookOverlayWindow()).toEqual({ startSec: 0, endSec: 2 });
  });

  it("uses blur-fill only on the infographic portion", () => {
    const segments = reframeSegments({
      clipStart: 0,
      clipEnd: 30,
      mode: "center",
      scenes: [
        { start: 0, end: 10, blurFill: false },
        { start: 10, end: 20, blurFill: true },
        { start: 20, end: 30, blurFill: false },
      ],
    });
    expect(segments.map((segment) => segment.mode)).toEqual(["center", "blur-fill", "center"]);
  });
});

describe("subtitle shift and srt", () => {
  it("shifts cue times by the clip start and then by the lead pad", () => {
    const cues = [{ startSec: 10, endSec: 12, text: "Xin chào" }];
    expect(shiftSubtitleCues(cues, 10, 40)).toEqual([{ startSec: 0, endSec: 2, text: "Xin chào" }]);
    expect(alignCuesToCut(cues, 10, 40)).toEqual([{ startSec: 0.15, endSec: 2.15, text: "Xin chào" }]);
  });

  it("parses an SRT file", () => {
    const parsed = parseSrt("1\n00:00:01,200 --> 00:00:03,500\nXin chào bạn\n\n");
    expect(parsed).toEqual([{ start: 1.2, end: 3.5, text: "Xin chào bạn" }]);
  });
});

describe("clip schedule", () => {
  it("spreads clips after the parent publish time onto vertical accounts only", () => {
    const automation = ProfileAutomationSchema.parse({
      timezone: "Asia/Ho_Chi_Minh",
      publishTimes: ["19:00"],
      videosPerDay: 1,
    });
    const slots = spreadClipSlots({
      now: new Date("2026-11-04T00:00:00.000Z"),
      after: new Date("2026-11-04T12:00:00.000Z"),
      count: 2,
      automation,
      assignedSlotIsos: ["2026-11-04T12:00:00.000Z"],
    });
    expect(slots.map((slot) => slot.at.toISOString())).toEqual([
      "2026-11-05T12:00:00.000Z",
      "2026-11-06T12:00:00.000Z",
    ]);
    const accounts = [
      { platform: "youtube", format: "landscape", enabled: true },
      { platform: "youtube", format: "vertical", enabled: true },
      { platform: "tiktok", format: "vertical", enabled: true },
      { platform: "facebook_reels", format: "landscape", enabled: true },
    ];
    expect(accounts.filter(isVerticalClipAccount).map((account) => account.platform)).toEqual(["youtube", "tiktok"]);
  });
});
