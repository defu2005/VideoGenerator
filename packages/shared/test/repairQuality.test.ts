import { describe, expect, it } from "vitest";
import {
  REPAIR_ISSUE_KINDS, defaultRepairSettings, nextLadderAction, orderRepairLadder, repairActionsFor, scriptGateDecision,
} from "../src/index.js";

describe("quality repair vocabulary", () => {
  it("has a ladder for every issue kind", () => {
    for (const kind of REPAIR_ISSUE_KINDS) expect(repairActionsFor(kind, { hasPassingCandidate: true, webAllowed: true }).length).toBeGreaterThan(0);
  });
  it("lists pick_next_candidate only with a passing candidate and web search only when allowed", () => {
    expect(repairActionsFor("scene_source_risk")).not.toContain("pick_next_candidate");
    expect(repairActionsFor("scene_vision_reject", { hasPassingCandidate: true })).toContain("pick_next_candidate");
    expect(repairActionsFor("scene_vision_reject", { hasPassingCandidate: true })).not.toContain("web_search_scene");
    expect(repairActionsFor("scene_source_risk", { hasPassingCandidate: true, webAllowed: true })).not.toContain("web_search_scene");
    expect(repairActionsFor("scene_vision_missing")[0]).toBe("vision_recheck");
  });
  it("walks the ladder and moves a proven action to the front", () => {
    const actions = repairActionsFor("script_score");
    expect(nextLadderAction("script_score", actions, [])).toBe("revise_script");
    expect(nextLadderAction("script_score", actions, ["revise_script"])).toBe("revise_script_stronger_model");
    expect(nextLadderAction("script_score", actions, actions)).toBeNull();
    const stats = { script_score: { new_angle: { tries: 5, passed: 4 } } };
    expect(orderRepairLadder("script_score", actions, stats)[0]).toBe("new_angle");
    expect(orderRepairLadder("script_score", actions, { script_score: { new_angle: { tries: 4, passed: 4 } } })[0]).toBe("revise_script");
  });
  it("raises the script revise cap only when asked", () => {
    const input = { score: 4, minQualityScore: 7, guidelinePass: true, blockingFacts: 0, reviseRound: 3 };
    expect(scriptGateDecision(input)).toBe("hold");
    expect(scriptGateDecision(input, 6)).toBe("revise");
  });
  it("defaults to shelve only for autonomous", () => {
    expect(defaultRepairSettings("autonomous").onExhausted).toBe("shelve");
    expect(defaultRepairSettings("supervised").onExhausted).toBe("ask");
  });
});
