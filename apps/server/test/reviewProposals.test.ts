import { describe, expect, it } from "vitest";
import { TimelineSchema, applyTimelineProposal, type ReviewProposal } from "@vg/shared";
import { validateReviewOutput } from "../src/review/validate.js";

const sceneA = "11111111-1111-4111-8111-111111111111";
const sceneB = "22222222-2222-4222-8222-222222222222";
const missing = "33333333-3333-4333-8333-333333333333";

function timeline() {
  return TimelineSchema.parse({
    formatVersion: 1,
    target: { width: 1080, height: 1920, fps: 30 },
    totalDurationSec: 8,
    revision: 1,
    scenes: [sceneA, sceneB].map((sceneId, order) => ({
      sceneId,
      order,
      label: order === 0 ? "Mở" : "Chốt",
      startSec: order * 4,
      endSec: order * 4 + 4,
      durationSec: 4,
      durationFrames: 120,
      voice: { trackId: "t", path: "voices/a.wav", startSec: order * 4, durationSec: 4 },
      visuals: [{
        kind: "PLACEHOLDER",
        candidateId: null,
        path: null,
        startSec: 0,
        endSec: 4,
        motion: { type: "kenburns", from: {}, to: {} },
        licenseKind: null,
      }],
      fadeInSec: 0,
      fadeOutSec: 0,
    })),
    music: null,
    subtitles: null,
    warnings: [],
    licenseSummary: {},
  });
}

const context = { sceneIds: new Set([sceneA, sceneB]), sceneCount: 2, graphicIds: new Set(["g1"]) };

describe("new review proposals", () => {
  it("drops an unknown scene or graphic with a Vietnamese note", () => {
    const invalid: ReviewProposal[] = [
      { type: "SET_TRANSITION", afterSceneId: missing, transitionType: "fade", durationSec: 0.4 },
      { type: "SET_EMPHASIS", sceneId: missing, wordIndexStart: 0, wordIndexEnd: 1, effects: ["flash"] },
      { type: "REMOVE_EMPHASIS", sceneId: missing, wordIndexStart: 0 },
      { type: "ADD_GRAPHIC", sceneId: missing, templateId: "title_card", variables: { title: "A" } },
      { type: "EDIT_GRAPHIC", graphicId: "missing" },
      { type: "REMOVE_GRAPHIC", graphicId: "missing" },
      { type: "DELETE_SCENE", sceneId: missing },
      { type: "SPLIT_SCENE", sceneId: missing, atWordIndex: 2 },
      { type: "REGENERATE_SCENE_VOICE", sceneId: missing },
    ];
    const checked = validateReviewOutput({ reply: "Xong", proposals: invalid }, context);
    expect(checked.proposals).toHaveLength(0);
    expect(checked.droppedNotes.join(" ")).toMatch(/không hợp lệ|không thấy đồ họa/);
    expect(checked.reply).toContain("Một số đề xuất đã bỏ");
  });

  it("applies each new proposal type", () => {
    let current = timeline();
    const steps: ReviewProposal[] = [
      { type: "SET_TRANSITION", afterSceneId: sceneA, transitionType: "zoomin", durationSec: 0.4 },
      { type: "SET_EMPHASIS", sceneId: sceneA, wordIndexStart: 0, wordIndexEnd: 1, effects: ["flash"] },
      { type: "REMOVE_EMPHASIS", sceneId: sceneA, wordIndexStart: 0 },
      { type: "ADD_GRAPHIC", sceneId: sceneA, templateId: "title_card", variables: { title: "Hố đen" } },
      { type: "SET_SUBTITLE_STYLE", style: "box" },
      { type: "SPLIT_SCENE", sceneId: sceneB, atWordIndex: 3 },
      { type: "REGENERATE_SCENE_VOICE", sceneId: sceneA },
    ];
    for (const proposal of steps) {
      const applied = applyTimelineProposal(current, proposal);
      expect("timeline" in applied).toBe(true);
      if ("timeline" in applied) current = applied.timeline;
    }
    const graphic = current.graphics?.[0];
    expect(graphic?.templateId).toBe("title_card");
    const edited = applyTimelineProposal(current, {
      type: "EDIT_GRAPHIC",
      graphicId: graphic!.id,
      variables: { title: "Mới" },
    });
    expect("timeline" in edited && edited.timeline.graphics?.[0]?.variables.title).toBe("Mới");
    const removed = "timeline" in edited
      ? applyTimelineProposal(edited.timeline, { type: "REMOVE_GRAPHIC", graphicId: graphic!.id })
      : edited;
    expect("timeline" in removed && (removed.timeline.graphics ?? [])).toHaveLength(0);
    const deleted = "timeline" in removed
      ? applyTimelineProposal(removed.timeline, { type: "DELETE_SCENE", sceneId: sceneA })
      : removed;
    expect("timeline" in deleted && deleted.timeline.scenes.some((scene) => scene.sceneId === sceneA)).toBe(false);
  });
});
