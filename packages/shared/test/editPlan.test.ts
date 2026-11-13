import { describe, expect, it } from "vitest";
import {
  alternateMotions,
  buildXfadeFilter,
  calloutAssLines,
  calloutMarginV,
  clampEmphasis,
  closeSubtitleGaps,
  defaultRhythm,
  fallbackEditPlan,
  fallbackEmphasis,
  karaokeAssText,
  popAssText,
  previewWindow,
  resolveEditSettings,
  SFX_GAIN,
  sfxMixFilter,
  validateEditPlan,
  zoompanExprs,
} from "../src/index.js";
import { toAss } from "../src/subtitles/index.js";

describe("edit plan", () => {
  it("keeps at most two identical non-cut transitions and alternates pans", () => {
    const scenes = Array.from({ length: 6 }, (_, index) => ({ sceneId: `s${index}`, topicChange: index > 0 }));
    const rhythm = defaultRhythm(scenes, "calm");
    let run = 1;
    for (let index = 1; index < rhythm.length; index += 1) {
      run = rhythm[index].type !== "cut" && rhythm[index].type === rhythm[index - 1].type ? run + 1 : 1;
      expect(run).toBeLessThanOrEqual(2);
    }
    const motions = alternateMotions(scenes.map((scene) => scene.sceneId)).map((item) => item.preset);
    for (let index = 1; index < motions.length; index += 1) {
      const pan = motions[index].startsWith("pan_");
      if (pan) expect(motions[index]).not.toBe(motions[index - 1]);
    }
  });

  it("builds xfade offsets from timeline starts, extends the tail, and groups past 12 clips", () => {
    const clips = Array.from({ length: 13 }, (_, index) => ({
      sceneId: `s${index}`,
      startSec: index * 4,
      durationSec: 4,
      transitionOut: index === 12 ? null : { type: index === 0 ? "zoomin" as const : "cut" as const, durationSec: 0.4 },
    }));
    const plan = buildXfadeFilter(clips, { xfadeAvailable: true, fps: 30 });
    expect(plan.groups).toBe(2);
    expect(plan.filter).toContain("xfade=transition=zoomin:duration=0.4:offset=4");
    expect(plan.filter).toContain("tpad=stop_mode=clone:stop_duration=0.4");
    expect(plan.outputStarts[1].startSec).toBe(4);
    expect(Math.abs(plan.outputStarts[1].startSec - clips[1].startSec)).toBeLessThan(1 / 30);
    const fallback = buildXfadeFilter(clips.slice(0, 2), { xfadeAvailable: false });
    expect(fallback.warning).toMatch(/xfade/);
    expect(fallback.filter).toContain("concat=");
  });

  it("uses ease-out for punch-in and holds after the burst", () => {
    const expr = zoompanExprs(
      { type: "zoom", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.5 } },
      30,
      { easing: "easeOut", easeFrames: 8 },
    );
    expect(expr.z).toContain("1-");
    expect(expr.z).toContain("/7");
  });

  it("closes a short subtitle gap and keeps a real pause", () => {
    const closed = closeSubtitleGaps([
      { startSec: 19.5, endSec: 20.03, text: "a" },
      { startSec: 20.03, endSec: 21, text: "b" },
    ]);
    expect(closed[0].endSec).toBe(20.03);
    const kept = closeSubtitleGaps([
      { startSec: 0, endSec: 1, text: "a" },
      { startSec: 1.6, endSec: 2, text: "b" },
    ]);
    expect(kept[0].endSec).toBe(1);
    const gap = closeSubtitleGaps([
      { startSec: 19.5, endSec: 19.5, text: "trước" },
      { startSec: 20.03, endSec: 21, text: "sau" },
    ]);
    expect(gap[0].endSec).toBe(20.03);
  });

  it("writes karaoke, pop, box and a callout that stays above the subtitle margin", () => {
    const words = [
      { text: "Xin", startSec: 0, endSec: 0.4 },
      { text: "chào", startSec: 0.4, endSec: 1 },
    ];
    const karaoke = karaokeAssText(words, 0, 1);
    const durations = [...karaoke.matchAll(/\\kf(\d+)/g)].map((match) => Number(match[1]));
    expect(durations.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(popAssText(words)).toContain("\\fscx105");
    const box = toAss([{ startSec: 0, endSec: 1, text: "Xin chào {nháy}" }], { subtitleStyle: "box", aspectRatio: "16:9" });
    expect(box).toMatch(/Style: Default,[^\n]*3,3,/);
    expect(box).toContain("\\{nháy\\}");
    expect(box).toContain("Style: Callout");
    const margin = calloutMarginV(1080, 86);
    expect(margin).toBeLessThan(1080 - 86);
  });

  it("limits emphasis and mixes SFX at the word start", () => {
    const scenes = [
      { sceneId: "a", startSec: 0, durationSec: 10, incomingTransition: "dissolve" as const },
      { sceneId: "b", startSec: 10, durationSec: 70 },
    ];
    const clamped = clampEmphasis([
      { sceneId: "a", wordIndexStart: 0, wordIndexEnd: 0, effects: ["flash"], startSec: 0.2 },
      { sceneId: "a", wordIndexStart: 1, wordIndexEnd: 1, effects: ["callout"], startSec: 2 },
      { sceneId: "a", wordIndexStart: 2, wordIndexEnd: 2, effects: ["callout"], startSec: 4 },
      { sceneId: "b", wordIndexStart: 0, wordIndexEnd: 0, effects: ["flash"], startSec: 12 },
    ], scenes);
    expect(clamped.map((item) => item.startSec)).toEqual([2, 12]);
    const later = clampEmphasis([
      { sceneId: "b", wordIndexStart: 0, wordIndexEnd: 0, effects: ["flash"], startSec: 12 },
      { sceneId: "b", wordIndexStart: 1, wordIndexEnd: 1, effects: ["flash"], startSec: 40 },
    ], scenes);
    expect(later).toHaveLength(1);
    expect(sfxMixFilter(1.25, 3)).toContain(`volume=${Math.round(SFX_GAIN * 10000) / 10000}`);
    expect(sfxMixFilter(1.25, 3)).toContain("adelay=delays=1250");
  });

  it("falls back to numbers and title words, and lets project overrides win", () => {
    const picked = fallbackEmphasis({
      sceneId: "s",
      title: "Hố đen",
      words: [
        { text: "Một", startSec: 0 },
        { text: "hố", startSec: 1 },
        { text: "đen", startSec: 1.4 },
        { text: "nặng", startSec: 2 },
        { text: "3", startSec: 8 },
        { text: "lần", startSec: 8.4 },
      ],
    });
    expect(picked.some((item) => item.calloutText === "3")).toBe(true);
    expect(picked.some((item) => item.wordIndexStart === 1 || item.wordIndexStart === 2)).toBe(true);
    const plan = validateEditPlan({
      transitions: [{ afterSceneId: "s", type: "nope", durationSec: 9 }],
      motions: [{ sceneId: "missing", preset: "static" }],
      emphasis: [{ sceneId: "s", wordIndexStart: 0, wordIndexEnd: 0, effects: ["callout"], startSec: 0 }],
    }, [{ sceneId: "s", startSec: 0, durationSec: 4 }, { sceneId: "t", startSec: 4, durationSec: 4 }]);
    expect(plan.transitions[0].type).not.toBe("nope");
    expect(plan.transitions[0].durationSec === 0 || plan.transitions[0].durationSec <= 0.8).toBe(true);
    expect(plan.motions.every((item) => item.sceneId === "s" || item.sceneId === "t")).toBe(true);
    const resolved = resolveEditSettings({
      aspect: "9:16",
      profile: { preset: "calm", sfx: false },
      project: { subtitleStyle: "pop", sfx: true },
    });
    expect(resolved).toMatchObject({ preset: "calm", subtitleStyle: "pop", sfx: true });
    const fallback = fallbackEditPlan({
      title: "Hố đen",
      preset: "news",
      scenes: [{ sceneId: "s", startSec: 0, durationSec: 6, words: [{ text: "năm", startSec: 1 }, { text: "1990", startSec: 1.5 }] }],
    });
    expect(fallback.subtitleStyle).toBe("box");
    const wide = fallbackEditPlan({
      title: "Số",
      emphasisEverySec: 20,
      scenes: [{ sceneId: "s", startSec: 0, durationSec: 30, words: [{ text: "3", startSec: 1 }, { text: "4", startSec: 9 }] }],
    });
    const tight = fallbackEditPlan({
      title: "Số",
      emphasisEverySec: 6,
      scenes: [{ sceneId: "s", startSec: 0, durationSec: 30, words: [{ text: "3", startSec: 1 }, { text: "4", startSec: 9 }] }],
    });
    expect(tight.emphasis.length).toBeGreaterThan(wide.emphasis.length);
    expect(fallback.emphasis.some((item) => item.calloutText === "1990")).toBe(true);
    expect(previewWindow(12, 40).endSec - previewWindow(12, 40).startSec).toBeLessThanOrEqual(10);
  });

  it("keeps an ASS callout when the kinetic graphic fails and drops it when the graphic is ready", () => {
    const input = {
      points: [{ sceneId: "s", wordIndexStart: 0, effects: ["callout" as const], calloutText: "1990" }],
      scenes: [{ sceneId: "s", startSec: 2 }],
      wordsByScene: { s: [{ text: "1990", startSec: 0.5, endSec: 1.1 }] },
    };
    expect(calloutAssLines({ ...input, motionEnabled: true, kineticFailed: true })).toContain("Callout");
    expect(calloutAssLines({ ...input, motionEnabled: true, kineticFailed: false })).toBe("");
    expect(calloutAssLines({ ...input, motionEnabled: false, kineticFailed: false })).toContain("1990");
  });
});
