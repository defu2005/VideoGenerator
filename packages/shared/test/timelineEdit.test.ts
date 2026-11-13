import { describe, expect, it } from "vitest";
import { ReviewProposalSchema, TimelineSchema } from "../src/index.js";
import { applyTimelineProposal, markMissingVoices } from "../src/review/timelineEdit.js";

const sceneA = "11111111-1111-4111-8111-111111111111";
const sceneB = "22222222-2222-4222-8222-222222222222";

function timeline() {
  return TimelineSchema.parse({
    formatVersion: 1,
    target: { width: 1080, height: 1920, fps: 30 },
    totalDurationSec: 8,
    revision: 2,
    scenes: [
      scene(sceneA, 0, 4),
      scene(sceneB, 1, 4),
    ],
    music: null,
    subtitles: null,
    warnings: [],
    licenseSummary: {},
  });
}

function scene(sceneId: string, order: number, startSec: number) {
  return {
    sceneId,
    order,
    label: order === 0 ? "A" : "B",
    startSec,
    endSec: startSec + 4,
    durationSec: 4,
    durationFrames: 120,
    voice: { trackId: "t", path: "voices/a.wav", startSec, durationSec: 4 },
    visuals: [{
      kind: "PLACEHOLDER" as const,
      candidateId: null,
      path: null,
      startSec: 0,
      endSec: 4,
      motion: { type: "kenburns" as const, from: {}, to: {} },
      licenseKind: null,
    }],
    fadeInSec: 0,
    fadeOutSec: 0,
  };
}

describe("timeline proposals", () => {
  it("accepts the new proposal types", () => {
    expect(ReviewProposalSchema.parse({
      type: "SET_TRANSITION",
      afterSceneId: sceneA,
      transitionType: "fade",
      durationSec: 0.4,
      baseRevision: 2,
    }).type).toBe("SET_TRANSITION");
    expect(ReviewProposalSchema.safeParse({ type: "ADD_GRAPHIC", sceneId: sceneA, templateId: "nope", variables: {} }).success).toBe(false);
  });

  it("bumps revision and rejects a stale base", () => {
    const current = timeline();
    const applied = applyTimelineProposal(current, {
      type: "SET_SUBTITLE_STYLE",
      style: "karaoke",
      baseRevision: 2,
    });
    expect("timeline" in applied && applied.timeline.revision).toBe(3);
    const stale = applyTimelineProposal(current, {
      type: "DELETE_SCENE",
      sceneId: sceneA,
      baseRevision: 1,
    });
    expect(stale).toEqual({ error: "Timeline đã thay đổi, tạo lại đề xuất?" });
  });

  it("deletes a scene and marks a missing voice", () => {
    const applied = applyTimelineProposal(timeline(), { type: "DELETE_SCENE", sceneId: sceneA });
    expect("timeline" in applied && applied.timeline.scenes).toHaveLength(1);
    expect("timeline" in applied && applied.timeline.totalDurationSec).toBe(4);
    const marked = markMissingVoices(timeline(), () => false);
    expect(marked.scenes[0]?.voice).toBeNull();
  });

  it("adds a graphic", () => {
    const applied = applyTimelineProposal(timeline(), {
      type: "ADD_GRAPHIC",
      sceneId: sceneA,
      templateId: "title_card",
      variables: { title: "Hố đen" },
    });
    expect("timeline" in applied && applied.timeline.graphics?.[0]?.templateId).toBe("title_card");
  });
});
