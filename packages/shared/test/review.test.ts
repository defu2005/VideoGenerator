import { describe, expect, it } from "vitest";
import { ReviewAssistantOutputSchema, ReviewProposalSchema, ReviewSendSchema } from "../src/index.js";

const sceneId = "11111111-1111-4111-8111-111111111111";
const sceneId2 = "22222222-2222-4222-8222-222222222222";

describe("review schemas", () => {
  it("parses every proposal type", () => {
    const proposals = [
      { type: "EDIT_NARRATION", sceneId, text: "New narration." },
      { type: "EDIT_DURATION", sceneId, durationSec: 12 },
      { type: "EDIT_DURATION", sceneId, durationSec: null },
      { type: "EDIT_VISUAL_QUERY", sceneId, query: "roman forum photograph" },
      {
        type: "SET_MOTION",
        sceneId,
        slot: 0,
        motion: { type: "kenburns", from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.1, x: 0.5, y: 0.5 } },
      },
      { type: "MUSIC_MIX", volume: 0.2, duckingDb: -14 },
      { type: "MUSIC_QUERY", query: "calm piano" },
      { type: "REORDER_SCENES", sceneIds: [sceneId2, sceneId] },
      { type: "EDIT_METADATA", title: "New title", tags: ["rome"] },
      { type: "NOTE", text: "Consider a stronger hook." },
    ];
    for (const proposal of proposals) {
      expect(ReviewProposalSchema.parse(proposal)).toEqual(proposal);
    }
    expect(ReviewAssistantOutputSchema.parse({
      reply: "Here are a few ideas.",
      proposals,
    }).proposals).toHaveLength(proposals.length);
  });

  it("rejects invalid proposals and send payloads", () => {
    expect(ReviewProposalSchema.safeParse({ type: "EDIT_NARRATION", sceneId: "nope", text: "x" }).success).toBe(false);
    expect(ReviewProposalSchema.safeParse({ type: "EDIT_DURATION", sceneId, durationSec: 0 }).success).toBe(false);
    expect(ReviewProposalSchema.safeParse({ type: "EDIT_DURATION", sceneId, durationSec: 61 }).success).toBe(false);
    expect(ReviewProposalSchema.safeParse({ type: "MUSIC_MIX", volume: 2 }).success).toBe(false);
    expect(ReviewProposalSchema.safeParse({ type: "NOTE", text: "" }).success).toBe(false);
    expect(ReviewProposalSchema.safeParse({ type: "UNKNOWN", text: "x" }).success).toBe(false);
    expect(ReviewSendSchema.safeParse({ text: "" }).success).toBe(false);
    expect(ReviewSendSchema.parse({ text: "Hello", attachImages: true })).toEqual({
      text: "Hello",
      attachImages: true,
    });
  });
});
