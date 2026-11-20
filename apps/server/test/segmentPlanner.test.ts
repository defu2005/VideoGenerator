import { describe, expect, it } from "vitest";
import { GATES } from "@vg/shared";
import { planProjectSegment, type SegmentPlanInput } from "../src/node/segmentPlanner.js";

const input: SegmentPlanInput = {
  states: {}, automaticGates: new Set(GATES), executors: {},
  capabilities: new Set(["project", "llm:mock", "tts:edge-tts", "render"]),
  stageNeeds: { RESEARCH: ["llm:mock"], VOICE: ["tts:edge-tts"], RENDER: ["render"] },
};

describe("project segment planner", () => {
  it("reaches render when the node and automation can handle each stage", () => {
    const plan = planProjectSegment(input);
    expect(plan.fromStage).toBe("RESEARCH");
    expect(plan.stages.at(-1)).toBe("RENDER");
    expect(plan.stopBefore).toEqual([]);
    expect(plan.needs).toEqual(["llm:mock", "project", "render", "tts:edge-tts"]);
    expect(plan.stages).not.toContain("PUBLISH");
  });

  it("stops before human gates and keeps independent voice work in the segment", () => {
    const plan = planProjectSegment({ ...input, automaticGates: new Set() });
    expect(plan.stopBefore[0]).toBe("VISUAL_REVIEW");
    expect(plan.stages).toEqual(expect.arrayContaining(["VISUAL_SEARCH", "VOICE", "SUBTITLE"]));
    expect(plan.stages).not.toContain("TIMELINE");
    expect(plan.blockedBy.VISUAL_REVIEW).toBe("human_gate");
  });

  it.each([
    ["VISUAL_SEARCH", { executors: { VISUAL_SEARCH: "agent" } }, "executor"],
    ["VOICE", { capabilities: new Set(["project", "llm:mock", "render"]) }, "capability"],
    ["VOICE", { executors: { VOICE: "USER" } }, "executor"],
  ] as const)("keeps %s on control when required", (stage, override, reason) => {
    const plan = planProjectSegment({ ...input, ...override });
    expect(plan.stopBefore).toContain(stage);
    expect(plan.stages).not.toContain(stage);
    expect(plan.stages).not.toContain("RENDER");
    expect(plan.blockedBy[stage]).toBe(reason);
  });

  it("resumes from the first unfinished stage after a control gate", () => {
    const plan = planProjectSegment({ ...input, states: {
      RESEARCH: "SKIPPED", SCRIPT: "DONE", SCENE_PLAN: "DONE", VISUAL_SEARCH: "DONE", VISUAL_REVIEW: "DONE",
    }, automaticGates: new Set() });
    expect(plan.fromStage).toBe("VOICE");
    expect(plan.stopBefore).toEqual(["MUSIC_REVIEW"]);
  });
});
